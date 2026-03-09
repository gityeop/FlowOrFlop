import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import {
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { AttentionStateMachine } from "../../lib/attentionStateMachine";
import {
  advanceCalibrationPoint,
  computeCalibrationPatch,
  deriveCalibrationStep,
} from "../../lib/calibration";
import {
  classifyRawAttentionState,
  GazeEstimator,
  isPoseOutsideRange,
  type GazeObservation,
} from "../../lib/gazeEstimator";
import { loadSettings, patchSettings } from "../../lib/settingsStore";
import {
  type AppSettings,
  type BrowserCloseNotSupportedPayload,
  type CalibrationStartPayload,
  type CalibrationResultPayload,
  type CalibrationUiPayload,
  type CameraMode,
  type CalibrationStepType,
  type OutsideDirection,
  type RawAttentionState,
  DEFAULT_SETTINGS,
  EVENT_CALIBRATION_RESULT,
  EVENT_CALIBRATION_START,
  EVENT_CALIBRATION_UI,
  EVENT_BROWSER_CLOSE_NOT_SUPPORTED,
  EVENT_SETTINGS_UPDATED,
} from "../../lib/types";
import alertAudio1Url from "../../assets/audio/alert-1.mp3?url";
import alertAudio2Url from "../../assets/audio/alert-2.mp3?url";
import faceLandmarkerTaskUrl from "../../assets/models/face_landmarker.task?url";
import "./OverlayApp.css";

const WASM_BASE_PATH = `${window.location.origin}/mediapipe`;
const ALERT_AUDIO_URLS = [
  alertAudio1Url,
  alertAudio2Url,
];

function cameraModeLabel(mode: CameraMode): string {
  return mode === "booth" ? "Booth" : "Circle";
}

interface L2csEstimatePayload {
  hasFace: boolean;
  yawDeg: number | null;
  pitchDeg: number | null;
  confidence: number | null;
}

interface CalibrationPoint {
  id: string;
  label: string;
  xPercent: number;
  yPercent: number;
  stepType: CalibrationStepType;
  outsideDirection: OutsideDirection | null;
}

interface CalibrationAccumulator {
  active: boolean;
  pointIndex: number;
  pointStartMs: number;
  pointSamples: number;
  insideEyeAbsX: number[];
  insideEyeAbsY: number[];
  insideYawAbs: number[];
  insidePitchAbs: number[];
  outsideEyeAbsX: number[];
  outsideEyeAbsY: number[];
  outsideYawAbs: number[];
  outsidePitchAbs: number[];
}

const INSIDE_CALIBRATION_POINTS: CalibrationPoint[] = [
  {
    id: "inside-top-left",
    label: "Top-left",
    xPercent: 11,
    yPercent: 11,
    stepType: "inside",
    outsideDirection: null,
  },
  {
    id: "inside-top",
    label: "Top",
    xPercent: 50,
    yPercent: 11,
    stepType: "inside",
    outsideDirection: null,
  },
  {
    id: "inside-top-right",
    label: "Top-right",
    xPercent: 89,
    yPercent: 11,
    stepType: "inside",
    outsideDirection: null,
  },
  {
    id: "inside-left",
    label: "Left",
    xPercent: 11,
    yPercent: 50,
    stepType: "inside",
    outsideDirection: null,
  },
  {
    id: "inside-center",
    label: "Center",
    xPercent: 50,
    yPercent: 50,
    stepType: "inside",
    outsideDirection: null,
  },
  {
    id: "inside-right",
    label: "Right",
    xPercent: 89,
    yPercent: 50,
    stepType: "inside",
    outsideDirection: null,
  },
  {
    id: "inside-bottom-left",
    label: "Bottom-left",
    xPercent: 11,
    yPercent: 89,
    stepType: "inside",
    outsideDirection: null,
  },
  {
    id: "inside-bottom",
    label: "Bottom",
    xPercent: 50,
    yPercent: 89,
    stepType: "inside",
    outsideDirection: null,
  },
  {
    id: "inside-bottom-right",
    label: "Bottom-right",
    xPercent: 89,
    yPercent: 89,
    stepType: "inside",
    outsideDirection: null,
  },
];

const OUTSIDE_CALIBRATION_POINTS: CalibrationPoint[] = [
  {
    id: "outside-left",
    label: "Outside Left",
    xPercent: 50,
    yPercent: 50,
    stepType: "outside",
    outsideDirection: "left",
  },
  {
    id: "outside-top-left",
    label: "Outside Top-left",
    xPercent: 50,
    yPercent: 50,
    stepType: "outside",
    outsideDirection: "top_left",
  },
  {
    id: "outside-top",
    label: "Outside Top",
    xPercent: 50,
    yPercent: 50,
    stepType: "outside",
    outsideDirection: "top",
  },
  {
    id: "outside-top-right",
    label: "Outside Top-right",
    xPercent: 50,
    yPercent: 50,
    stepType: "outside",
    outsideDirection: "top_right",
  },
  {
    id: "outside-right",
    label: "Outside Right",
    xPercent: 50,
    yPercent: 50,
    stepType: "outside",
    outsideDirection: "right",
  },
  {
    id: "outside-bottom-right",
    label: "Outside Bottom-right",
    xPercent: 50,
    yPercent: 50,
    stepType: "outside",
    outsideDirection: "bottom_right",
  },
  {
    id: "outside-bottom",
    label: "Outside Bottom",
    xPercent: 50,
    yPercent: 50,
    stepType: "outside",
    outsideDirection: "bottom",
  },
  {
    id: "outside-bottom-left",
    label: "Outside Bottom-left",
    xPercent: 50,
    yPercent: 50,
    stepType: "outside",
    outsideDirection: "bottom_left",
  },
];

const CALIBRATION_POINTS: CalibrationPoint[] = [
  ...INSIDE_CALIBRATION_POINTS,
  ...OUTSIDE_CALIBRATION_POINTS,
];

const CALIBRATION_COUNTDOWN_MS = 2000;
const CALIBRATION_COLLECT_MS = 1000;
const CALIBRATION_MIN_SAMPLES_PER_POINT = 4;
const HIDDEN_CALIBRATION_UI_PAYLOAD: CalibrationUiPayload = {
  visible: false,
  pointIndex: 0,
  totalPoints: CALIBRATION_POINTS.length,
  pointLabel: "",
  xPercent: 50,
  yPercent: 50,
  phase: "countdown",
  countdown: null,
  stepType: "inside",
  outsideDirection: null,
  sampleCount: 0,
};

function isMediaAbortError(error: unknown): boolean {
  if (!(error instanceof DOMException)) {
    return false;
  }
  return error.name === "AbortError";
}

function encodeVideoFrameToBase64(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
): string | null {
  const frameWidth = Math.max(video.videoWidth, 1);
  const frameHeight = Math.max(video.videoHeight, 1);

  canvas.width = frameWidth;
  canvas.height = frameHeight;
  const context = canvas.getContext("2d", { willReadFrequently: false });
  if (!context) {
    return null;
  }

  context.drawImage(video, 0, 0, frameWidth, frameHeight);
  const dataUrl = canvas.toDataURL("image/jpeg", 0.78);
  const encoded = dataUrl.split(",", 2)[1];
  return encoded ?? null;
}

export function OverlayApp() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const l2csCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const gazeEstimatorRef = useRef<GazeEstimator | null>(null);
  const alertAudioRef = useRef<HTMLAudioElement | null>(null);
  const alertAudioErrorNotifiedRef = useRef(false);
  const isApplicationWindowOpenRef = useRef(false);
  const isGazeAwayTriggerActiveRef = useRef(false);
  const l2csPreviousRawStateRef = useRef<RawAttentionState>("RAW_LOOKING");
  const l2csLastFaceSeenMsRef = useRef(performance.now());
  const l2csAvailableRef = useRef(true);
  const l2csErrorNotifiedRef = useRef(false);
  const lastWebviewOpenEnsureTsRef = useRef(0);
  const previousUrlActionEnabledRef = useRef(DEFAULT_SETTINGS.urlActionEnabled);
  const dragStateRef = useRef<{
    startX: number;
    startY: number;
    pointerId: number;
    dragged: boolean;
  } | null>(null);
  const calibrationRef = useRef<CalibrationAccumulator | null>(null);
  const lastCalibrationUiKeyRef = useRef<string>("");
  const startCalibrationRef = useRef<(payload?: CalibrationStartPayload) => Promise<void>>(
    async () => {},
  );
  const machineRef = useRef(
    new AttentionStateMachine({
      awayDebounceMs: DEFAULT_SETTINGS.awayDebounceMs,
      backDebounceMs: DEFAULT_SETTINGS.backDebounceMs,
    }),
  );

  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [cameraError, setCameraError] = useState<string>("");
  const [toastMessage, setToastMessage] = useState<string>("");
  const [observation, setObservation] = useState<GazeObservation | null>(null);

  const statusText = useMemo(() => {
    if (!settings) {
      return "Loading";
    }

    if (!settings.privacyNoticeAccepted) {
      return "Consent required";
    }

    if (!settings.detectionEnabled) {
      return "Detection OFF";
    }

    return observation?.rawState === "RAW_AWAY" ? "Looking away" : "Looking at screen";
  }, [observation?.rawState, settings]);

  const updateAndBroadcastSettings = useCallback(
    async (nextSettings: AppSettings) => {
      setSettings(nextSettings);
      await emit(EVENT_SETTINGS_UPDATED, nextSettings);
    },
    [],
  );

  const resizeOverlayWindow = useCallback(
    async (mode: CameraMode, overlayScale: number) => {
      const nextMode = mode === "booth" ? "booth" : "circle";
      await invoke("set_overlay_mode_window", {
        mode: nextMode,
        scale: overlayScale,
      });
    },
    [],
  );

  const stopAlertAudio = useCallback(() => {
    const audio = alertAudioRef.current;
    if (!audio) {
      return;
    }

    audio.pause();
    audio.currentTime = 0;
    audio.src = "";
    alertAudioRef.current = null;
  }, []);

  const playRandomAlertAudio = useCallback(() => {
    if (ALERT_AUDIO_URLS.length === 0) {
      return;
    }

    stopAlertAudio();

    const randomIndex = Math.floor(Math.random() * ALERT_AUDIO_URLS.length);
    const audioUrl = ALERT_AUDIO_URLS[randomIndex];
    const audio = new Audio(audioUrl);

    audio.addEventListener(
      "ended",
      () => {
        if (alertAudioRef.current === audio) {
          alertAudioRef.current = null;
        }
      },
      { once: true },
    );

    alertAudioRef.current = audio;
    void audio.play().catch((error) => {
      if (isMediaAbortError(error)) {
        return;
      }
      if (!alertAudioErrorNotifiedRef.current) {
        alertAudioErrorNotifiedRef.current = true;
        setToastMessage(`Alert audio unavailable: ${String(error)}`);
      }
      if (alertAudioRef.current === audio) {
        alertAudioRef.current = null;
      }
    });
  }, [stopAlertAudio]);

  const syncApplicationWindowByTriggers = useCallback(
    async (allowRefocus = false) => {
      if (!settings) {
        return;
      }
      if (!settings.urlActionEnabled) {
        return;
      }

      const shouldOpen = isGazeAwayTriggerActiveRef.current;

      if (shouldOpen) {
        if (!isApplicationWindowOpenRef.current || allowRefocus) {
          await invoke("open_application_window", {
            url: settings.applicationUrl,
            mode: settings.openMode,
          });

          if (!isApplicationWindowOpenRef.current) {
            isApplicationWindowOpenRef.current = true;
          }

          lastWebviewOpenEnsureTsRef.current = performance.now();
        }
        return;
      }

      if (!isApplicationWindowOpenRef.current) {
        return;
      }

      await invoke("close_application_window", {
        mode: settings.openMode,
      });
      lastWebviewOpenEnsureTsRef.current = 0;
      isApplicationWindowOpenRef.current = false;
    },
    [settings],
  );

  const emitCalibrationResult = useCallback(
    async (payload: CalibrationResultPayload) => {
      await emit(EVENT_CALIBRATION_RESULT, payload);
    },
    [],
  );

  const emitCalibrationUi = useCallback(async (payload: CalibrationUiPayload) => {
    const key = JSON.stringify(payload);
    if (lastCalibrationUiKeyRef.current === key) {
      return;
    }
    lastCalibrationUiKeyRef.current = key;
    await emit(EVENT_CALIBRATION_UI, payload);
  }, []);

  const abortCalibrationUi = useCallback(async () => {
    calibrationRef.current = null;
    lastCalibrationUiKeyRef.current = "";
    await emitCalibrationUi(HIDDEN_CALIBRATION_UI_PAYLOAD);
    await invoke("close_calibration_window").catch(() => {
      // Ignore close failures while tearing down calibration state.
    });
  }, [emitCalibrationUi]);

  const finishCalibration = useCallback(
    async (
      ok: boolean,
      message: string,
      patch?: CalibrationResultPayload["applied"],
    ) => {
      await abortCalibrationUi();
      machineRef.current.reset("RAW_LOOKING", performance.now());
      isGazeAwayTriggerActiveRef.current = false;
      stopAlertAudio();
      await syncApplicationWindowByTriggers();

      const hasUsableThreshold =
        !!patch &&
        Object.values(patch).some((value) => value !== null && value !== undefined);
      if (!ok || !hasUsableThreshold) {
        await emitCalibrationResult({ ok, message });
        return;
      }

      try {
        const nextSettings = await patchSettings(patch);
        await updateAndBroadcastSettings(nextSettings);
        await emitCalibrationResult({
          ok: true,
          message,
          applied: patch,
        });
      } catch (error) {
        await emitCalibrationResult({
          ok: false,
          message: `Calibration save failed: ${String(error)}`,
        });
      }
    },
    [
      abortCalibrationUi,
      emitCalibrationResult,
      stopAlertAudio,
      syncApplicationWindowByTriggers,
      updateAndBroadcastSettings,
    ],
  );

  const startCalibration = useCallback(async (payload?: CalibrationStartPayload) => {
    if (!settings?.privacyNoticeAccepted) {
      await emitCalibrationResult({
        ok: false,
        message: "Accept privacy notice and camera permission before calibration.",
      });
      return;
    }

    if (!settings.detectionEnabled) {
      await emitCalibrationResult({
        ok: false,
        message: "Enable detection first, then run calibration.",
      });
      return;
    }

    await abortCalibrationUi();

    const anchorWindowLabel = payload?.anchorWindowLabel?.trim() || "main";
    try {
      await invoke("open_calibration_window", {
        anchorLabel: anchorWindowLabel,
      });
    } catch (error) {
      await emitCalibrationResult({
        ok: false,
        message: `Failed to open calibration guide window: ${String(error)}`,
      });
      return;
    }

    const nowMs = performance.now();
    machineRef.current.reset("RAW_LOOKING", nowMs);
    isGazeAwayTriggerActiveRef.current = false;
    stopAlertAudio();
    await syncApplicationWindowByTriggers();

    calibrationRef.current = {
      active: true,
      pointIndex: 0,
      pointStartMs: nowMs,
      pointSamples: 0,
      insideEyeAbsX: [],
      insideEyeAbsY: [],
      insideYawAbs: [],
      insidePitchAbs: [],
      outsideEyeAbsX: [],
      outsideEyeAbsY: [],
      outsideYawAbs: [],
      outsidePitchAbs: [],
    };

    const firstPoint = CALIBRATION_POINTS[0];
    await emitCalibrationUi({
      visible: true,
      pointIndex: 0,
      totalPoints: CALIBRATION_POINTS.length,
      pointLabel: firstPoint.label,
      xPercent: firstPoint.xPercent,
      yPercent: firstPoint.yPercent,
      phase: "countdown",
      countdown: 2,
      stepType: firstPoint.stepType,
      outsideDirection: firstPoint.outsideDirection,
      sampleCount: 0,
    });
    setCameraError("");
  }, [
    abortCalibrationUi,
    emitCalibrationResult,
    emitCalibrationUi,
    settings,
    stopAlertAudio,
    syncApplicationWindowByTriggers,
  ]);

  useEffect(() => {
    startCalibrationRef.current = startCalibration;
  }, [startCalibration]);

  const processCalibrationFrame = useCallback(
    async (
      nowMs: number,
      primaryObservation: GazeObservation,
      fallbackObservation: GazeObservation | null,
    ): Promise<boolean> => {
      const calibration = calibrationRef.current;
      if (!calibration?.active || !settings) {
        return false;
      }

      const point = CALIBRATION_POINTS[calibration.pointIndex];
      const elapsedMs = nowMs - calibration.pointStartMs;
      const step = deriveCalibrationStep(
        elapsedMs,
        CALIBRATION_COUNTDOWN_MS,
        CALIBRATION_COLLECT_MS,
      );

      const mergedOrientation =
        primaryObservation.orientation ?? fallbackObservation?.orientation ?? null;
      const mergedEye = primaryObservation.eyeGaze ?? fallbackObservation?.eyeGaze ?? null;

      if (step.phase === "collect" && !step.pointDone) {
        let captured = false;

        if (mergedOrientation) {
          if (point.stepType === "inside") {
            calibration.insideYawAbs.push(Math.abs(mergedOrientation.yawDeg));
            calibration.insidePitchAbs.push(Math.abs(mergedOrientation.pitchDeg));
          } else {
            calibration.outsideYawAbs.push(Math.abs(mergedOrientation.yawDeg));
            calibration.outsidePitchAbs.push(Math.abs(mergedOrientation.pitchDeg));
          }
          captured = true;
        }

        if (mergedEye && mergedEye.confidence >= 0.2) {
          if (point.stepType === "inside") {
            calibration.insideEyeAbsX.push(Math.abs(mergedEye.xNorm));
            calibration.insideEyeAbsY.push(Math.abs(mergedEye.yNorm));
          } else {
            calibration.outsideEyeAbsX.push(Math.abs(mergedEye.xNorm));
            calibration.outsideEyeAbsY.push(Math.abs(mergedEye.yNorm));
          }
          captured = true;
        }

        if (captured) {
          calibration.pointSamples += 1;
        }
      }

      await emitCalibrationUi({
        visible: true,
        pointIndex: calibration.pointIndex,
        totalPoints: CALIBRATION_POINTS.length,
        pointLabel: point.label,
        xPercent: point.xPercent,
        yPercent: point.yPercent,
        phase: step.phase,
        countdown: step.countdown,
        stepType: point.stepType,
        outsideDirection: point.outsideDirection,
        sampleCount: calibration.pointSamples,
      });

      if (!step.pointDone) {
        return true;
      }

      if (calibration.pointSamples < CALIBRATION_MIN_SAMPLES_PER_POINT) {
        await finishCalibration(
          false,
          `Calibration failed at ${point.label}: face/eye samples were too low. Try better lighting and keep your face inside camera frame.`,
        );
        return true;
      }

      const pointAdvance = advanceCalibrationPoint(
        calibration.pointIndex,
        CALIBRATION_POINTS.length,
      );
      calibration.pointIndex = pointAdvance.nextIndex;
      if (pointAdvance.done) {
        const patch = computeCalibrationPatch({
          insideYawAbs: calibration.insideYawAbs,
          insidePitchAbs: calibration.insidePitchAbs,
          insideEyeAbsX: calibration.insideEyeAbsX,
          insideEyeAbsY: calibration.insideEyeAbsY,
          outsideYawAbs: calibration.outsideYawAbs,
          outsidePitchAbs: calibration.outsidePitchAbs,
          outsideEyeAbsX: calibration.outsideEyeAbsX,
          outsideEyeAbsY: calibration.outsideEyeAbsY,
          minInsideEyeSampleCount: INSIDE_CALIBRATION_POINTS.length,
          minOutsideEyeSampleCount: OUTSIDE_CALIBRATION_POINTS.length,
        });

        const hasUsableThreshold = Object.values(patch).some(
          (value) => value !== null && value !== undefined,
        );
        if (!hasUsableThreshold) {
          await finishCalibration(
            false,
            "Calibration finished but no usable samples were captured.",
          );
          return true;
        }

        await finishCalibration(
          true,
          "Calibration complete. Thresholds were updated from 9-point inside + 8-direction outside gaze samples.",
          patch,
        );
        return true;
      }

      calibration.pointStartMs = nowMs;
      calibration.pointSamples = 0;
      const nextPoint = CALIBRATION_POINTS[calibration.pointIndex];
      await emitCalibrationUi({
        visible: true,
        pointIndex: calibration.pointIndex,
        totalPoints: CALIBRATION_POINTS.length,
        pointLabel: nextPoint.label,
        xPercent: nextPoint.xPercent,
        yPercent: nextPoint.yPercent,
        phase: "countdown",
        countdown: 2,
        stepType: nextPoint.stepType,
        outsideDirection: nextPoint.outsideDirection,
        sampleCount: 0,
      });
      return true;
    },
    [emitCalibrationUi, finishCalibration, settings],
  );

  const toggleCameraMode = useCallback(async () => {
    if (!settings) {
      return;
    }

    if (calibrationRef.current?.active) {
      return;
    }

    const nextMode: CameraMode =
      settings.cameraMode === "booth" ? "circle" : "booth";

    try {
      const nextSettings = await patchSettings({
        cameraMode: nextMode,
      });
      await resizeOverlayWindow(nextMode, settings.overlayScale);
      await updateAndBroadcastSettings(nextSettings);
    } catch (error) {
      setCameraError(String(error));
    }
  }, [resizeOverlayWindow, settings, updateAndBroadcastSettings]);

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) {
        return;
      }
      if (calibrationRef.current?.active) {
        return;
      }

      event.currentTarget.setPointerCapture(event.pointerId);
      dragStateRef.current = {
        startX: event.clientX,
        startY: event.clientY,
        pointerId: event.pointerId,
        dragged: false,
      };
    },
    [],
  );

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (calibrationRef.current?.active) {
        return;
      }
      const state = dragStateRef.current;
      if (!state || state.dragged || state.pointerId !== event.pointerId) {
        return;
      }

      const deltaX = event.clientX - state.startX;
      const deltaY = event.clientY - state.startY;
      const movedDistance = Math.hypot(deltaX, deltaY);

      if (movedDistance < 6) {
        return;
      }

      state.dragged = true;
      void invoke("start_overlay_drag").catch((error) => {
        setCameraError(`Overlay drag failed: ${String(error)}.`);
      });
    },
    [],
  );

  const handlePointerUp = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (calibrationRef.current?.active) {
        dragStateRef.current = null;
        return;
      }
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }

      const state = dragStateRef.current;
      dragStateRef.current = null;

      if (!state || state.pointerId !== event.pointerId || state.dragged) {
        return;
      }

      void toggleCameraMode();
    },
    [toggleCameraMode],
  );

  const handlePointerCancel = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    dragStateRef.current = null;
  }, []);

  useEffect(() => {
    document.documentElement.classList.add("overlay-window");
    document.body.classList.add("overlay-window");

    return () => {
      document.documentElement.classList.remove("overlay-window");
      document.body.classList.remove("overlay-window");
    };
  }, []);

  useEffect(() => {
    return () => {
      void abortCalibrationUi();
    };
  }, [abortCalibrationUi]);

  useEffect(() => {
    let isMounted = true;
    let unlistenSettings: (() => void) | null = null;
    let unlistenBrowserCloseNotice: (() => void) | null = null;
    let unlistenCalibrationStart: (() => void) | null = null;

    void loadSettings().then((loaded) => {
      if (!isMounted) {
        return;
      }
      setSettings(loaded);
      machineRef.current.reset("RAW_LOOKING", performance.now());
    });

    void listen<AppSettings>(EVENT_SETTINGS_UPDATED, (event) => {
      if (!isMounted) {
        return;
      }
      setSettings({
        ...DEFAULT_SETTINGS,
        ...event.payload,
      });
    }).then((unlisten) => {
      unlistenSettings = unlisten;
    });

    void listen<BrowserCloseNotSupportedPayload>(
      EVENT_BROWSER_CLOSE_NOT_SUPPORTED,
      (event) => {
        if (!isMounted) {
          return;
        }
        setToastMessage(event.payload.message);
      },
    ).then((unlisten) => {
      unlistenBrowserCloseNotice = unlisten;
    });

    void listen<CalibrationStartPayload>(EVENT_CALIBRATION_START, (event) => {
      if (!isMounted) {
        return;
      }
      void startCalibrationRef.current(event.payload);
    }).then((unlisten) => {
      unlistenCalibrationStart = unlisten;
    });

    return () => {
      isMounted = false;
      unlistenSettings?.();
      unlistenBrowserCloseNotice?.();
      unlistenCalibrationStart?.();
    };
  }, []);

  useEffect(() => {
    machineRef.current.updateConfig({
      awayDebounceMs: settings?.awayDebounceMs ?? DEFAULT_SETTINGS.awayDebounceMs,
      backDebounceMs: settings?.backDebounceMs ?? DEFAULT_SETTINGS.backDebounceMs,
    });
  }, [settings?.awayDebounceMs, settings?.backDebounceMs]);

  useEffect(() => {
    if (!settings) {
      return;
    }

    const previous = previousUrlActionEnabledRef.current;
    const current = settings.urlActionEnabled;
    if (!previous && current) {
      isGazeAwayTriggerActiveRef.current = false;
      lastWebviewOpenEnsureTsRef.current = 0;
    }
    previousUrlActionEnabledRef.current = current;
  }, [settings?.urlActionEnabled]);

  useEffect(() => {
    l2csPreviousRawStateRef.current = "RAW_LOOKING";
    l2csLastFaceSeenMsRef.current = performance.now();
    l2csAvailableRef.current = true;
    l2csErrorNotifiedRef.current = false;
    void invoke("reset_l2cs_sidecar").catch(() => {
      // Ignore reset failures because mediapipe fallback remains available.
    });
  }, [settings?.gazeProvider]);

  useEffect(() => {
    if (
      !settings?.privacyNoticeAccepted ||
      !settings.detectionEnabled ||
      settings.gazeProvider !== "l2cs_sidecar"
    ) {
      return;
    }

    let isCancelled = false;

    async function initSidecar() {
      try {
        await invoke("init_l2cs_sidecar");
        if (isCancelled) {
          return;
        }
        l2csAvailableRef.current = true;
        l2csErrorNotifiedRef.current = false;
      } catch (error) {
        if (isCancelled) {
          return;
        }
        l2csAvailableRef.current = false;
        l2csErrorNotifiedRef.current = true;
        setToastMessage(
          `L2CS sidecar unavailable, using MediaPipe instead: ${String(error)}`,
        );
        void invoke("reset_l2cs_sidecar").catch(() => {
          // Ignore reset failures because fallback is local.
        });
      }
    }

    void initSidecar();

    return () => {
      isCancelled = true;
    };
  }, [
    settings?.detectionEnabled,
    settings?.gazeProvider,
    settings?.privacyNoticeAccepted,
  ]);

  useEffect(() => {
    if (!settings?.cameraMode) {
      return;
    }
    void resizeOverlayWindow(settings.cameraMode, settings.overlayScale).catch((error) => {
      setCameraError(`Overlay resize failed: ${String(error)}.`);
    });
  }, [resizeOverlayWindow, settings?.cameraMode, settings?.overlayScale]);

  useEffect(() => {
    if (!settings?.privacyNoticeAccepted) {
      void abortCalibrationUi();
      isApplicationWindowOpenRef.current = false;
      isGazeAwayTriggerActiveRef.current = false;
      l2csPreviousRawStateRef.current = "RAW_LOOKING";
      l2csLastFaceSeenMsRef.current = performance.now();
      l2csAvailableRef.current = true;
      l2csErrorNotifiedRef.current = false;
      stopAlertAudio();
      if (mediaStreamRef.current) {
        for (const track of mediaStreamRef.current.getTracks()) {
          track.stop();
        }
      }
      mediaStreamRef.current = null;
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
      void invoke("reset_l2cs_sidecar").catch(() => {
        // Ignore reset failures because the worker may not be running yet.
      });
      return;
    }

    let isCancelled = false;

    async function startStream() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: "user",
          },
          audio: false,
        });

        if (isCancelled) {
          for (const track of stream.getTracks()) {
            track.stop();
          }
          return;
        }

        mediaStreamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        setCameraError("");
      } catch (error) {
        setCameraError(
          `Camera access failed: ${String(error)}. Check OS and browser camera permission.`,
        );
      }
    }

    void startStream();

    return () => {
      isCancelled = true;
      if (mediaStreamRef.current) {
        for (const track of mediaStreamRef.current.getTracks()) {
          track.stop();
        }
      }
      mediaStreamRef.current = null;
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }

      stopAlertAudio();
    };
  }, [abortCalibrationUi, settings?.privacyNoticeAccepted, stopAlertAudio]);

  useEffect(() => {
    if (!settings?.privacyNoticeAccepted) {
      return;
    }

    let isCancelled = false;

    async function prepareEstimator() {
      try {
        const estimator = await GazeEstimator.create(
          faceLandmarkerTaskUrl,
          WASM_BASE_PATH,
        );

        if (isCancelled) {
          estimator.close();
          return;
        }

        gazeEstimatorRef.current = estimator;
      } catch (error) {
        setCameraError(
          `Face model initialization failed: ${String(error)}.`,
        );
      }
    }

    void prepareEstimator();

    return () => {
      isCancelled = true;
      gazeEstimatorRef.current?.close();
      gazeEstimatorRef.current = null;
    };
  }, [settings?.privacyNoticeAccepted]);

  useEffect(() => {
    if (!settings) {
      return;
    }

    if (!settings.detectionEnabled) {
      void abortCalibrationUi();
      machineRef.current.reset("RAW_LOOKING", performance.now());
      lastWebviewOpenEnsureTsRef.current = 0;
      isGazeAwayTriggerActiveRef.current = false;
      stopAlertAudio();
      l2csPreviousRawStateRef.current = "RAW_LOOKING";
      l2csLastFaceSeenMsRef.current = performance.now();
      setObservation(null);
      void invoke("reset_l2cs_sidecar").catch(() => {
        // Ignore reset failures because mediapipe fallback remains available.
      });
      void syncApplicationWindowByTriggers();
      return;
    }

    if (!settings.privacyNoticeAccepted) {
      return;
    }

    let isStopped = false;
    let isProcessing = false;

    const intervalMs = Math.max(40, Math.round(1000 / Math.max(settings.fps, 1)));

    const timer = window.setInterval(() => {
      if (isStopped || isProcessing) {
        return;
      }

      const video = videoRef.current;
      if (!video) {
        return;
      }

      if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
        return;
      }

      isProcessing = true;

      void (async () => {
        try {
          const nowMs = performance.now();
          const estimator = gazeEstimatorRef.current;
          let nextObservation: GazeObservation | null = null;

          if (settings.gazeProvider === "l2cs_sidecar" && l2csAvailableRef.current) {
            try {
              if (!l2csCanvasRef.current) {
                l2csCanvasRef.current = document.createElement("canvas");
              }

              const encodedFrame = encodeVideoFrameToBase64(video, l2csCanvasRef.current);
              if (!encodedFrame) {
                throw new Error("failed to capture frame for L2CS sidecar");
              }

              const sidecarEstimate = await invoke<L2csEstimatePayload>(
                "estimate_l2cs_gaze",
                {
                  frameBase64: encodedFrame,
                },
              );

              const hasFace =
                sidecarEstimate.hasFace &&
                sidecarEstimate.yawDeg !== null &&
                sidecarEstimate.pitchDeg !== null;

              let rawState: RawAttentionState;
              let orientation: GazeObservation["orientation"] = null;

              if (hasFace) {
                orientation = {
                  yawDeg: sidecarEstimate.yawDeg ?? 0,
                  pitchDeg: sidecarEstimate.pitchDeg ?? 0,
                };

                rawState = classifyRawAttentionState(
                  orientation,
                  {
                    yawThresholdDeg: settings.yawThresholdDeg,
                    pitchThresholdDeg: settings.pitchThresholdDeg,
                  },
                  l2csPreviousRawStateRef.current,
                );
                if (
                  isPoseOutsideRange(
                    orientation,
                    settings.awayYawThresholdDeg,
                    settings.awayPitchThresholdDeg,
                  )
                ) {
                  rawState = "RAW_AWAY";
                }
                l2csLastFaceSeenMsRef.current = nowMs;
              } else {
                const noFaceElapsedMs = nowMs - l2csLastFaceSeenMsRef.current;
                rawState =
                  noFaceElapsedMs >= settings.noFaceTimeoutMs
                    ? "RAW_AWAY"
                    : l2csPreviousRawStateRef.current;
              }

              l2csPreviousRawStateRef.current = rawState;
              nextObservation = {
                rawState,
                orientation,
                eyeGaze: null,
                classificationSource: "l2cs_sidecar",
                hasFace,
              };

              if (l2csErrorNotifiedRef.current) {
                l2csErrorNotifiedRef.current = false;
              }
            } catch (error) {
              l2csAvailableRef.current = false;
              void invoke("reset_l2cs_sidecar").catch(() => {
                // Ignore reset failures because fallback is local.
              });

              if (!l2csErrorNotifiedRef.current) {
                l2csErrorNotifiedRef.current = true;
                setToastMessage(
                  `L2CS sidecar failed, falling back to MediaPipe: ${String(error)}`,
                );
              }
            }
          }

          if (!nextObservation) {
            if (!estimator) {
              return;
            }
            nextObservation = estimator.detect(video, nowMs, settings);
          }

          let calibrationFallbackObservation: GazeObservation | null = null;
          if (
            calibrationRef.current?.active &&
            estimator &&
            (!nextObservation.eyeGaze || !nextObservation.orientation)
          ) {
            calibrationFallbackObservation = estimator.detect(video, nowMs, settings);
          }

          setObservation(nextObservation);

          if (calibrationRef.current?.active) {
            await processCalibrationFrame(
              nowMs,
              nextObservation,
              calibrationFallbackObservation,
            );
            return;
          }

          const event = machineRef.current.process(nextObservation.rawState, nowMs);

          if (event === "LOOK_AWAY") {
            isGazeAwayTriggerActiveRef.current = true;
            playRandomAlertAudio();
            if (settings.urlActionEnabled) {
              await syncApplicationWindowByTriggers();
            }
          } else if (event === "LOOK_BACK") {
            isGazeAwayTriggerActiveRef.current = false;
            stopAlertAudio();
            if (settings.urlActionEnabled) {
              await syncApplicationWindowByTriggers();
            }
          }

          if (
            settings.urlActionEnabled &&
            settings.openMode === "webview" &&
            isGazeAwayTriggerActiveRef.current &&
            nowMs - lastWebviewOpenEnsureTsRef.current >= 2200
          ) {
            await syncApplicationWindowByTriggers(true);
          }
        } catch (error) {
          setCameraError(String(error));
        } finally {
          isProcessing = false;
        }
      })();
    }, intervalMs);

    return () => {
      isStopped = true;
      window.clearInterval(timer);
    };
  }, [
    abortCalibrationUi,
    playRandomAlertAudio,
    processCalibrationFrame,
    settings,
    stopAlertAudio,
    syncApplicationWindowByTriggers,
  ]);

  useEffect(() => {
    if (!toastMessage) {
      return;
    }

    const timer = window.setTimeout(() => {
      setToastMessage("");
    }, 3500);

    return () => {
      window.clearTimeout(timer);
    };
  }, [toastMessage]);

  const cameraMode = settings?.cameraMode ?? "booth";

  return (
    <div className="overlay-root">
      <div
        className={`camera-shell mode-${cameraMode}`}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerCancel}
        role="button"
        tabIndex={0}
        onKeyDown={(event) => {
          if (calibrationRef.current?.active) {
            return;
          }
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            void toggleCameraMode();
          }
        }}
      >
        <video ref={videoRef} className="camera-video" autoPlay playsInline muted />

        {!settings?.privacyNoticeAccepted && (
          <div className="overlay-message">
            설정 창에서 개인정보 안내에 동의하면 감지가 시작됩니다.
          </div>
        )}

        {!!cameraError && <div className="overlay-message error">{cameraError}</div>}

        <div
          className="overlay-hud"
          onClick={(event) => {
            event.stopPropagation();
          }}
        >
          <span className="pill">Mode: {cameraModeLabel(cameraMode)}</span>
          <span className="pill">{statusText}</span>
          <span className="pill subtle">
            yaw {observation?.orientation?.yawDeg.toFixed(1) ?? "-"} / pitch{" "}
            {observation?.orientation?.pitchDeg.toFixed(1) ?? "-"}
          </span>
          <span className="pill subtle">
            eye x {observation?.eyeGaze?.xNorm.toFixed(2) ?? "-"} / y{" "}
            {observation?.eyeGaze?.yNorm.toFixed(2) ?? "-"} / conf{" "}
            {observation?.eyeGaze?.confidence.toFixed(2) ?? "-"}
          </span>
          <span className="pill subtle">
            source {observation?.classificationSource ?? "-"}
          </span>
        </div>
      </div>

      {!!toastMessage && <div className="overlay-toast">{toastMessage}</div>}
    </div>
  );
}
