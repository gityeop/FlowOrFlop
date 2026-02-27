import { convertFileSrc, invoke } from "@tauri-apps/api/core";
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
import { GazeEstimator, type GazeObservation } from "../../lib/gazeEstimator";
import { loadSettings, patchSettings } from "../../lib/settingsStore";
import {
  type AppSettings,
  type BrowserCloseNotSupportedPayload,
  type CameraMode,
  DEFAULT_SETTINGS,
  EVENT_BROWSER_CLOSE_NOT_SUPPORTED,
  EVENT_SETTINGS_UPDATED,
} from "../../lib/types";
import faceLandmarkerTaskUrl from "../../assets/models/face_landmarker.task?url";
import "./OverlayApp.css";

const WASM_BASE_PATH = `${window.location.origin}/mediapipe`;
const ALERT_AUDIO_FILE_PATHS = [
  "/Users/imsang-yeob/Downloads/ScreenRecording_02-26-2026 22-12-53_1 2.mp3",
  "/Users/imsang-yeob/Downloads/ScreenRecording_02-26-2026 22-12-53_1.mp3",
];

function cameraModeLabel(mode: CameraMode): string {
  return mode === "booth" ? "Booth" : "Circle";
}

export function OverlayApp() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const gazeEstimatorRef = useRef<GazeEstimator | null>(null);
  const alertAudioRef = useRef<HTMLAudioElement | null>(null);
  const isApplicationWindowOpenRef = useRef(false);
  const isGazeAwayTriggerActiveRef = useRef(false);
  const lastWebviewOpenEnsureTsRef = useRef(0);
  const dragStateRef = useRef<{
    startX: number;
    startY: number;
    pointerId: number;
    dragged: boolean;
  } | null>(null);
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
    async (mode: CameraMode) => {
      const nextMode = mode === "booth" ? "booth" : "circle";
      await invoke("set_overlay_mode_window", { mode: nextMode });
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
    if (ALERT_AUDIO_FILE_PATHS.length === 0) {
      return;
    }

    stopAlertAudio();

    const randomIndex = Math.floor(Math.random() * ALERT_AUDIO_FILE_PATHS.length);
    const randomFilePath = ALERT_AUDIO_FILE_PATHS[randomIndex];
    const audio = new Audio(convertFileSrc(randomFilePath));

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
      setCameraError(`Audio playback failed: ${String(error)}.`);
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

      const shouldOpen = isGazeAwayTriggerActiveRef.current;

      if (shouldOpen) {
        if (!isApplicationWindowOpenRef.current || allowRefocus) {
          await invoke("open_application_window", {
            url: settings.applicationUrl,
            mode: settings.openMode,
          });

          if (!isApplicationWindowOpenRef.current) {
            isApplicationWindowOpenRef.current = true;
            playRandomAlertAudio();
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
      stopAlertAudio();
    },
    [playRandomAlertAudio, settings, stopAlertAudio],
  );

  const toggleCameraMode = useCallback(async () => {
    if (!settings) {
      return;
    }

    const nextMode: CameraMode =
      settings.cameraMode === "booth" ? "circle" : "booth";

    try {
      const nextSettings = await patchSettings({
        cameraMode: nextMode,
      });
      await resizeOverlayWindow(nextMode);
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
    let isMounted = true;
    let unlistenSettings: (() => void) | null = null;
    let unlistenBrowserCloseNotice: (() => void) | null = null;

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

    return () => {
      isMounted = false;
      unlistenSettings?.();
      unlistenBrowserCloseNotice?.();
    };
  }, []);

  useEffect(() => {
    machineRef.current.updateConfig({
      awayDebounceMs: settings?.awayDebounceMs ?? DEFAULT_SETTINGS.awayDebounceMs,
      backDebounceMs: settings?.backDebounceMs ?? DEFAULT_SETTINGS.backDebounceMs,
    });
  }, [settings?.awayDebounceMs, settings?.backDebounceMs]);

  useEffect(() => {
    if (!settings?.cameraMode) {
      return;
    }
    void resizeOverlayWindow(settings.cameraMode).catch((error) => {
      setCameraError(`Overlay resize failed: ${String(error)}.`);
    });
  }, [resizeOverlayWindow, settings?.cameraMode]);

  useEffect(() => {
    if (!settings?.privacyNoticeAccepted) {
      isApplicationWindowOpenRef.current = false;
      isGazeAwayTriggerActiveRef.current = false;
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
  }, [settings?.privacyNoticeAccepted, stopAlertAudio]);

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
      machineRef.current.reset("RAW_LOOKING", performance.now());
      lastWebviewOpenEnsureTsRef.current = 0;
      isGazeAwayTriggerActiveRef.current = false;
      setObservation(null);
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
      const estimator = gazeEstimatorRef.current;
      if (!video || !estimator) {
        return;
      }

      if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
        return;
      }

      isProcessing = true;

      void (async () => {
        try {
          const nowMs = performance.now();
          const nextObservation = estimator.detect(video, nowMs, settings);
          setObservation(nextObservation);

          const event = machineRef.current.process(nextObservation.rawState, nowMs);

          if (event === "LOOK_AWAY") {
            isGazeAwayTriggerActiveRef.current = true;
            await syncApplicationWindowByTriggers();
          } else if (event === "LOOK_BACK") {
            isGazeAwayTriggerActiveRef.current = false;
            await syncApplicationWindowByTriggers();
          }

          if (
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
  }, [settings, syncApplicationWindowByTriggers]);

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
        </div>
      </div>

      {!!toastMessage && <div className="overlay-toast">{toastMessage}</div>}
    </div>
  );
}
