import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useRef, useState } from "react";

import { loadSettings, saveSettings } from "../../lib/settingsStore";
import {
  type AppSettings,
  type BrowserCloseNotSupportedPayload,
  type CalibrationStartPayload,
  type CalibrationResultPayload,
  DEFAULT_SETTINGS,
  EVENT_BROWSER_CLOSE_NOT_SUPPORTED,
  EVENT_CALIBRATION_RESULT,
  EVENT_CALIBRATION_START,
  EVENT_SETTINGS_UPDATED,
} from "../../lib/types";
import "./SettingsApp.css";

export function SettingsApp() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [notice, setNotice] = useState<string>("");
  const [loadError, setLoadError] = useState<string>("");
  const [isCalibrating, setIsCalibrating] = useState(false);

  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());

  const persistAndBroadcast = useCallback((next: AppSettings) => {
    saveQueueRef.current = saveQueueRef.current
      .then(async () => {
        await saveSettings(next);
        await emit(EVENT_SETTINGS_UPDATED, next);
      })
      .catch((error) => {
        setLoadError(String(error));
      });
  }, []);

  const applyPatch = useCallback(
    (patch: Partial<AppSettings>) => {
      setSettings((current) => {
        if (!current) {
          return current;
        }

        const next = {
          ...current,
          ...patch,
        };

        persistAndBroadcast(next);
        return next;
      });
    },
    [persistAndBroadcast],
  );

  const startCalibration = useCallback(async () => {
    setLoadError("");
    setNotice("Calibration started. Follow the full-screen 2-1 countdown for 9+8 steps.");
    setIsCalibrating(true);

    try {
      await invoke("focus_or_create_overlay_window");
      const payload: CalibrationStartPayload = {
        anchorWindowLabel: "main",
      };
      await emit(EVENT_CALIBRATION_START, payload);
    } catch (error) {
      setIsCalibrating(false);
      setLoadError(`Failed to start calibration: ${String(error)}`);
    }
  }, []);

  useEffect(() => {
    let isMounted = true;
    let unlistenBrowserCloseNotice: (() => void) | null = null;
    let unlistenSettingsUpdated: (() => void) | null = null;
    let unlistenCalibrationResult: (() => void) | null = null;

    void loadSettings()
      .then((loaded) => {
        if (!isMounted) {
          return;
        }
        setSettings(loaded);
      })
      .catch((error) => {
        if (!isMounted) {
          return;
        }
        setLoadError(String(error));
      });

    void listen<BrowserCloseNotSupportedPayload>(
      EVENT_BROWSER_CLOSE_NOT_SUPPORTED,
      (event) => {
        if (!isMounted) {
          return;
        }
        setNotice(event.payload.message);
      },
    ).then((unlisten) => {
      unlistenBrowserCloseNotice = unlisten;
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
      unlistenSettingsUpdated = unlisten;
    });

    void listen<CalibrationResultPayload>(EVENT_CALIBRATION_RESULT, (event) => {
      if (!isMounted) {
        return;
      }
      setIsCalibrating(false);
      setNotice(event.payload.message);
      setLoadError(event.payload.ok ? "" : event.payload.message);
    }).then((unlisten) => {
      unlistenCalibrationResult = unlisten;
    });

    return () => {
      isMounted = false;
      unlistenBrowserCloseNotice?.();
      unlistenSettingsUpdated?.();
      unlistenCalibrationResult?.();
    };
  }, []);

  useEffect(() => {
    if (!notice) {
      return;
    }

    const timer = window.setTimeout(() => {
      setNotice("");
    }, 3500);

    return () => {
      window.clearTimeout(timer);
    };
  }, [notice]);

  if (!settings) {
    return (
      <main className="settings-root">
        <section className="settings-card">
          <h1>FlowOrFlop Settings</h1>
          <p>Loading settings...</p>
          {loadError && <p className="error-text">{loadError}</p>}
        </section>
      </main>
    );
  }

  return (
    <main className="settings-root">
      <section className="settings-card">
        <header className="settings-header">
          <div>
            <h1>FlowOrFlop Settings</h1>
            <p className="subtext">
              Face direction is estimated locally. No video is stored or sent.
            </p>
          </div>
          <div className="header-actions">
            <button
              className="secondary"
              onClick={() => {
                void invoke("focus_or_create_overlay_window");
              }}
              type="button"
            >
              Focus Overlay
            </button>
            <button
              type="button"
              onClick={() => {
                void startCalibration();
              }}
              disabled={isCalibrating || !settings.privacyNoticeAccepted}
            >
              {isCalibrating ? "Calibrating..." : "Start 9+8 calibration"}
            </button>
          </div>
        </header>

        {notice && <div className="notice">{notice}</div>}
        {loadError && <div className="notice error">{loadError}</div>}
        <p className="hint calibration-hint">
          Calibration runs 9 inside-screen points plus 8 outside-screen directions with 2-1
          countdown, then updates inside and outside thresholds to reduce false positives and misses.
        </p>

        <div className="field-row">
          <label htmlFor="detectionEnabled">Detection Enabled</label>
          <input
            id="detectionEnabled"
            type="checkbox"
            checked={settings.detectionEnabled}
            onChange={(event) => {
              applyPatch({
                detectionEnabled: event.currentTarget.checked,
              });
            }}
          />
        </div>

        <div className="field-row">
          <label htmlFor="urlActionEnabled">Enable URL open/close action</label>
          <input
            id="urlActionEnabled"
            type="checkbox"
            checked={settings.urlActionEnabled}
            onChange={(event) => {
              applyPatch({
                urlActionEnabled: event.currentTarget.checked,
              });
            }}
          />
        </div>

        <div className="slider-group">
          <label htmlFor="overlayScale">
            Camera window size: {settings.overlayScale.toFixed(2)}x
          </label>
          <input
            id="overlayScale"
            type="range"
            min={0.6}
            max={1.8}
            step={0.05}
            value={settings.overlayScale}
            onChange={(event) => {
              applyPatch({
                overlayScale: Number(event.currentTarget.value),
              });
            }}
          />
        </div>

        <div className="field-column">
          <label htmlFor="applicationUrl">Application URL</label>
          <input
            id="applicationUrl"
            type="url"
            value={settings.applicationUrl}
            onChange={(event) => {
              applyPatch({
                applicationUrl: event.currentTarget.value,
              });
            }}
            placeholder={DEFAULT_SETTINGS.applicationUrl}
          />
        </div>

        <div className="field-column">
          <label htmlFor="openMode">Open Mode</label>
          <select
            id="openMode"
            value={settings.openMode}
            onChange={(event) => {
              applyPatch({
                openMode: event.currentTarget.value as AppSettings["openMode"],
              });
            }}
          >
            <option value="webview">In-app Webview (default)</option>
            <option value="browser">Default Browser</option>
          </select>
          {settings.openMode === "browser" && (
            <p className="hint">
              Browser mode opens links, but LOOK_BACK cannot close browser tabs automatically.
            </p>
          )}
        </div>

        <div className="field-column">
          <label htmlFor="gazeProvider">Gaze Provider</label>
          <select
            id="gazeProvider"
            value={settings.gazeProvider}
            onChange={(event) => {
              applyPatch({
                gazeProvider: event.currentTarget.value as AppSettings["gazeProvider"],
              });
            }}
          >
            <option value="l2cs_sidecar">L2CS-Net Sidecar (default)</option>
            <option value="mediapipe">MediaPipe Face Landmarker</option>
          </select>
          {settings.gazeProvider === "l2cs_sidecar" && (
            <p className="hint">
              L2CS sidecar needs Python dependencies and model weights. If it fails, app falls
              back to MediaPipe automatically.
            </p>
          )}
        </div>

        <div className="field-row">
          <label htmlFor="useEyeGaze">Use Eye-Gaze Primary Detection</label>
          <input
            id="useEyeGaze"
            type="checkbox"
            checked={settings.useEyeGaze}
            onChange={(event) => {
              applyPatch({
                useEyeGaze: event.currentTarget.checked,
              });
            }}
          />
        </div>

        {settings.useEyeGaze && (
          <>
            <div className="slider-group">
              <label htmlFor="eyeHorizontalThreshold">
                Eye horizontal threshold: {settings.eyeHorizontalThreshold.toFixed(2)}
              </label>
              <input
                id="eyeHorizontalThreshold"
                type="range"
                min={0.15}
                max={0.8}
                step={0.01}
                value={settings.eyeHorizontalThreshold}
                onChange={(event) => {
                  applyPatch({
                    eyeHorizontalThreshold: Number(event.currentTarget.value),
                  });
                }}
              />
            </div>

            <div className="slider-group">
              <label htmlFor="eyeVerticalThreshold">
                Eye vertical threshold: {settings.eyeVerticalThreshold.toFixed(2)}
              </label>
              <input
                id="eyeVerticalThreshold"
                type="range"
                min={0.15}
                max={0.9}
                step={0.01}
                value={settings.eyeVerticalThreshold}
                onChange={(event) => {
                  applyPatch({
                    eyeVerticalThreshold: Number(event.currentTarget.value),
                  });
                }}
              />
            </div>
          </>
        )}

        <div className="slider-group">
          <label htmlFor="yawThresholdDeg">
            Yaw threshold: {settings.yawThresholdDeg} deg
          </label>
          <input
            id="yawThresholdDeg"
            type="range"
            min={6}
            max={30}
            step={1}
            value={settings.yawThresholdDeg}
            onChange={(event) => {
              applyPatch({
                yawThresholdDeg: Number(event.currentTarget.value),
              });
            }}
          />
        </div>

        <div className="slider-group">
          <label htmlFor="pitchThresholdDeg">
            Pitch threshold: {settings.pitchThresholdDeg} deg
          </label>
          <input
            id="pitchThresholdDeg"
            type="range"
            min={6}
            max={25}
            step={1}
            value={settings.pitchThresholdDeg}
            onChange={(event) => {
              applyPatch({
                pitchThresholdDeg: Number(event.currentTarget.value),
              });
            }}
          />
        </div>

        <details className="advanced">
          <summary>Advanced debounce and loop options</summary>

          <div className="field-column">
            <label htmlFor="eyeConfidenceThreshold">
              Eye confidence threshold (fallback gate)
            </label>
            <input
              id="eyeConfidenceThreshold"
              type="number"
              min={0}
              max={1}
              step={0.05}
              value={settings.eyeConfidenceThreshold}
              onChange={(event) => {
                applyPatch({
                  eyeConfidenceThreshold: Number(event.currentTarget.value),
                });
              }}
            />
          </div>

          <div className="field-column">
            <label htmlFor="eyeSmoothingAlpha">Eye smoothing alpha</label>
            <input
              id="eyeSmoothingAlpha"
              type="number"
              min={0.05}
              max={1}
              step={0.05}
              value={settings.eyeSmoothingAlpha}
              onChange={(event) => {
                applyPatch({
                  eyeSmoothingAlpha: Number(event.currentTarget.value),
                });
              }}
            />
          </div>

          <div className="field-column">
            <label htmlFor="awayDebounceMs">Away debounce (ms)</label>
            <input
              id="awayDebounceMs"
              type="number"
              min={200}
              max={2000}
              step={50}
              value={settings.awayDebounceMs}
              onChange={(event) => {
                applyPatch({
                  awayDebounceMs: Number(event.currentTarget.value),
                });
              }}
            />
          </div>

          <div className="field-column">
            <label htmlFor="backDebounceMs">Back debounce (ms)</label>
            <input
              id="backDebounceMs"
              type="number"
              min={200}
              max={2000}
              step={50}
              value={settings.backDebounceMs}
              onChange={(event) => {
                applyPatch({
                  backDebounceMs: Number(event.currentTarget.value),
                });
              }}
            />
          </div>

          <div className="field-column">
            <label htmlFor="noFaceTimeoutMs">No-face timeout (ms)</label>
            <input
              id="noFaceTimeoutMs"
              type="number"
              min={100}
              max={2000}
              step={50}
              value={settings.noFaceTimeoutMs}
              onChange={(event) => {
                applyPatch({
                  noFaceTimeoutMs: Number(event.currentTarget.value),
                });
              }}
            />
          </div>

          <div className="field-column">
            <label htmlFor="fps">Processing FPS</label>
            <input
              id="fps"
              type="number"
              min={5}
              max={30}
              step={1}
              value={settings.fps}
              onChange={(event) => {
                applyPatch({
                  fps: Number(event.currentTarget.value),
                });
              }}
            />
          </div>
        </details>
      </section>

      {!settings.privacyNoticeAccepted && (
        <div className="privacy-modal-backdrop">
          <section className="privacy-modal">
            <h2>Privacy Notice</h2>
            <p>
              This app estimates face direction locally using camera frames. Video is not
              recorded or transmitted.
            </p>
            <p>
              After you accept, macOS or Windows may prompt for camera permission.
            </p>
            <div className="button-row">
              <button
                type="button"
                onClick={() => {
                  applyPatch({
                    privacyNoticeAccepted: true,
                    detectionEnabled: true,
                  });
                }}
              >
                Agree and enable detection
              </button>
              <button
                className="secondary"
                type="button"
                onClick={() => {
                  applyPatch({
                    privacyNoticeAccepted: true,
                    detectionEnabled: false,
                  });
                }}
              >
                Agree but keep detection OFF
              </button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
