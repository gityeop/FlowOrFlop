export type CameraMode = "booth" | "circle";

export type OpenMode = "webview" | "browser";
export type GazeProvider = "mediapipe" | "l2cs_sidecar";

export type AttentionEvent = "LOOK_AWAY" | "LOOK_BACK";

export type RawAttentionState = "RAW_LOOKING" | "RAW_AWAY";

export interface AppSettings {
  detectionEnabled: boolean;
  urlActionEnabled: boolean;
  applicationUrl: string;
  openMode: OpenMode;
  gazeProvider: GazeProvider;
  useEyeGaze: boolean;
  yawThresholdDeg: number;
  pitchThresholdDeg: number;
  eyeHorizontalThreshold: number;
  eyeVerticalThreshold: number;
  awayYawThresholdDeg: number | null;
  awayPitchThresholdDeg: number | null;
  awayEyeHorizontalThreshold: number | null;
  awayEyeVerticalThreshold: number | null;
  eyeConfidenceThreshold: number;
  eyeSmoothingAlpha: number;
  awayDebounceMs: number;
  backDebounceMs: number;
  noFaceTimeoutMs: number;
  fps: number;
  cameraMode: CameraMode;
  overlayScale: number;
  privacyNoticeAccepted: boolean;
}

export interface BrowserCloseNotSupportedPayload {
  message: string;
}

export interface CalibrationResultPayload {
  ok: boolean;
  message: string;
  applied?: Partial<
    Pick<
      AppSettings,
      | "eyeHorizontalThreshold"
      | "eyeVerticalThreshold"
      | "yawThresholdDeg"
      | "pitchThresholdDeg"
      | "awayEyeHorizontalThreshold"
      | "awayEyeVerticalThreshold"
      | "awayYawThresholdDeg"
      | "awayPitchThresholdDeg"
      | "useEyeGaze"
    >
  >;
}

export interface CalibrationStartPayload {
  anchorWindowLabel: string;
}

export type CalibrationUiPhase = "countdown" | "collect";
export type CalibrationStepType = "inside" | "outside";
export type OutsideDirection =
  | "left"
  | "top_left"
  | "top"
  | "top_right"
  | "right"
  | "bottom_right"
  | "bottom"
  | "bottom_left";

export interface CalibrationUiPayload {
  visible: boolean;
  pointIndex: number;
  totalPoints: number;
  pointLabel: string;
  xPercent: number;
  yPercent: number;
  phase: CalibrationUiPhase;
  countdown: 2 | 1 | null;
  stepType: CalibrationStepType;
  outsideDirection: OutsideDirection | null;
  sampleCount: number;
}

export const DEFAULT_APPLICATION_URL =
  "https://www.alba.co.kr/job/Detail?adid=141211195&productcd=45&listmenucd=MAIN";

export const HYSTERESIS_BAND_DEG = 2;

export const EVENT_SETTINGS_UPDATED = "settings:updated";

export const EVENT_BROWSER_CLOSE_NOT_SUPPORTED = "browser-close-not-supported";
export const EVENT_CALIBRATION_START = "calibration:start";
export const EVENT_CALIBRATION_RESULT = "calibration:result";
export const EVENT_CALIBRATION_UI = "calibration:ui";

export const DEFAULT_SETTINGS: AppSettings = {
  detectionEnabled: true,
  urlActionEnabled: true,
  applicationUrl: DEFAULT_APPLICATION_URL,
  openMode: "webview",
  gazeProvider: "l2cs_sidecar",
  useEyeGaze: true,
  yawThresholdDeg: 10,
  pitchThresholdDeg: 8,
  eyeHorizontalThreshold: 0.36,
  eyeVerticalThreshold: 0.42,
  awayYawThresholdDeg: null,
  awayPitchThresholdDeg: null,
  awayEyeHorizontalThreshold: null,
  awayEyeVerticalThreshold: null,
  eyeConfidenceThreshold: 0.45,
  eyeSmoothingAlpha: 0.38,
  awayDebounceMs: 700,
  backDebounceMs: 500,
  noFaceTimeoutMs: 350,
  fps: 15,
  cameraMode: "booth",
  overlayScale: 1,
  privacyNoticeAccepted: false,
};
