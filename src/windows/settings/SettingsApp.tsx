import { invoke } from "@tauri-apps/api/core";
import { emit, listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useRef, useState } from "react";

import { loadSettings, saveSettings } from "../../lib/settingsStore";
import {
  type AppSettings,
  type BrowserCloseNotSupportedPayload,
  DEFAULT_SETTINGS,
  EVENT_BROWSER_CLOSE_NOT_SUPPORTED,
  EVENT_SETTINGS_UPDATED,
} from "../../lib/types";
import "./SettingsApp.css";

export function SettingsApp() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [notice, setNotice] = useState<string>("");
  const [loadError, setLoadError] = useState<string>("");

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

  useEffect(() => {
    let isMounted = true;
    let unlistenBrowserCloseNotice: (() => void) | null = null;

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

    return () => {
      isMounted = false;
      unlistenBrowserCloseNotice?.();
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
          <button
            className="secondary"
            onClick={() => {
              void invoke("focus_or_create_overlay_window");
            }}
            type="button"
          >
            Focus Overlay
          </button>
        </header>

        {notice && <div className="notice">{notice}</div>}
        {loadError && <div className="notice error">{loadError}</div>}

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
