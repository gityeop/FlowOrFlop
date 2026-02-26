export type CameraMode = "booth" | "circle";

export type OpenMode = "webview" | "browser";

export type AttentionEvent = "LOOK_AWAY" | "LOOK_BACK";

export type RawAttentionState = "RAW_LOOKING" | "RAW_AWAY";

export interface AppSettings {
  detectionEnabled: boolean;
  applicationUrl: string;
  openMode: OpenMode;
  yawThresholdDeg: number;
  pitchThresholdDeg: number;
  awayDebounceMs: number;
  backDebounceMs: number;
  noFaceTimeoutMs: number;
  fps: number;
  cameraMode: CameraMode;
  privacyNoticeAccepted: boolean;
}

export interface BrowserCloseNotSupportedPayload {
  message: string;
}

export const DEFAULT_APPLICATION_URL =
  "https://www.alba.co.kr/job/Detail?adid=141211195&productcd=45&listmenucd=MAIN";

export const HYSTERESIS_BAND_DEG = 2;

export const EVENT_SETTINGS_UPDATED = "settings:updated";

export const EVENT_BROWSER_CLOSE_NOT_SUPPORTED = "browser-close-not-supported";

export const DEFAULT_SETTINGS: AppSettings = {
  detectionEnabled: true,
  applicationUrl: DEFAULT_APPLICATION_URL,
  openMode: "webview",
  yawThresholdDeg: 10,
  pitchThresholdDeg: 8,
  awayDebounceMs: 700,
  backDebounceMs: 500,
  noFaceTimeoutMs: 350,
  fps: 15,
  cameraMode: "booth",
  privacyNoticeAccepted: false,
};
