import {
  FaceLandmarker,
  FilesetResolver,
  type NormalizedLandmark,
} from "@mediapipe/tasks-vision";

import { AppSettings, HYSTERESIS_BAND_DEG, RawAttentionState } from "./types";

const LEFT_EYE_OUTER_INDEX = 33;
const RIGHT_EYE_OUTER_INDEX = 263;
const NOSE_TIP_INDEX = 1;
const UPPER_LIP_INDEX = 13;
const LOWER_LIP_INDEX = 14;

interface Orientation {
  yawDeg: number;
  pitchDeg: number;
}

interface OrientationThresholds {
  yawThresholdDeg: number;
  pitchThresholdDeg: number;
}

interface FrameEvaluationInput extends OrientationThresholds {
  noFaceTimeoutMs: number;
  nowMs: number;
  previousRawState: RawAttentionState;
  lastFaceSeenMs: number;
  landmarks: LandmarkLike[] | null;
}

export interface LandmarkLike {
  x: number;
  y: number;
  z?: number;
}

export interface FrameEvaluationResult {
  rawState: RawAttentionState;
  orientation: Orientation | null;
  lastFaceSeenMs: number;
  hasFace: boolean;
}

export interface GazeObservation {
  rawState: RawAttentionState;
  orientation: Orientation | null;
  hasFace: boolean;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function landmarkAt(
  landmarks: LandmarkLike[],
  index: number,
  fallback: LandmarkLike,
): LandmarkLike {
  return landmarks[index] ?? fallback;
}

export function estimateYawPitchFromLandmarks(
  landmarks: LandmarkLike[],
): Orientation {
  const defaultPoint: LandmarkLike = { x: 0.5, y: 0.5, z: 0 };

  const leftEye = landmarkAt(landmarks, LEFT_EYE_OUTER_INDEX, defaultPoint);
  const rightEye = landmarkAt(landmarks, RIGHT_EYE_OUTER_INDEX, defaultPoint);
  const noseTip = landmarkAt(landmarks, NOSE_TIP_INDEX, defaultPoint);
  const upperLip = landmarkAt(landmarks, UPPER_LIP_INDEX, defaultPoint);
  const lowerLip = landmarkAt(landmarks, LOWER_LIP_INDEX, defaultPoint);

  const eyeCenterX = (leftEye.x + rightEye.x) * 0.5;
  const eyeCenterY = (leftEye.y + rightEye.y) * 0.5;
  const mouthCenterY = (upperLip.y + lowerLip.y) * 0.5;
  const mouthCenterZ = ((upperLip.z ?? 0) + (lowerLip.z ?? 0)) * 0.5;

  const faceHalfWidth = Math.max(Math.abs(rightEye.x - leftEye.x) * 0.5, 1e-4);
  const faceHalfHeight = Math.max(Math.abs(mouthCenterY - eyeCenterY) * 0.5, 1e-4);
  const eyeHorizontalDistance = Math.max(Math.abs(rightEye.x - leftEye.x), 1e-4);

  const normalizedYawByPosition = (noseTip.x - eyeCenterX) / faceHalfWidth;
  const normalizedYawByDepth = ((rightEye.z ?? 0) - (leftEye.z ?? 0)) / eyeHorizontalDistance;
  const faceCenterY = (eyeCenterY + mouthCenterY) * 0.5;
  const normalizedPitchByPosition = (noseTip.y - faceCenterY) / faceHalfHeight;
  const normalizedPitchByDepth = mouthCenterZ - (noseTip.z ?? 0);

  return {
    yawDeg: clamp(
      normalizedYawByPosition * 42 + normalizedYawByDepth * 36,
      -70,
      70,
    ),
    pitchDeg: clamp(
      normalizedPitchByPosition * 36 + normalizedPitchByDepth * 26,
      -70,
      70,
    ),
  };
}

export function classifyRawAttentionState(
  orientation: Orientation,
  thresholds: OrientationThresholds,
  previousRawState: RawAttentionState,
  hysteresisBandDeg = HYSTERESIS_BAND_DEG,
): RawAttentionState {
  const absYaw = Math.abs(orientation.yawDeg);
  const absPitch = Math.abs(orientation.pitchDeg);

  if (previousRawState === "RAW_LOOKING") {
    const awayYawThreshold = thresholds.yawThresholdDeg + hysteresisBandDeg;
    const awayPitchThreshold = thresholds.pitchThresholdDeg + hysteresisBandDeg;
    const shouldGoAway =
      absYaw > awayYawThreshold || absPitch > awayPitchThreshold;

    return shouldGoAway ? "RAW_AWAY" : "RAW_LOOKING";
  }

  const shouldReturnLooking =
    absYaw <= thresholds.yawThresholdDeg &&
    absPitch <= thresholds.pitchThresholdDeg;

  return shouldReturnLooking ? "RAW_LOOKING" : "RAW_AWAY";
}

export function evaluateFrameAttention(input: FrameEvaluationInput): FrameEvaluationResult {
  if (!input.landmarks) {
    const noFaceElapsedMs = input.nowMs - input.lastFaceSeenMs;
    const rawState =
      noFaceElapsedMs >= input.noFaceTimeoutMs
        ? "RAW_AWAY"
        : input.previousRawState;

    return {
      rawState,
      orientation: null,
      lastFaceSeenMs: input.lastFaceSeenMs,
      hasFace: false,
    };
  }

  const orientation = estimateYawPitchFromLandmarks(input.landmarks);
  const rawState = classifyRawAttentionState(
    orientation,
    {
      yawThresholdDeg: input.yawThresholdDeg,
      pitchThresholdDeg: input.pitchThresholdDeg,
    },
    input.previousRawState,
  );

  return {
    rawState,
    orientation,
    lastFaceSeenMs: input.nowMs,
    hasFace: true,
  };
}

export class GazeEstimator {
  private readonly faceLandmarker: FaceLandmarker;
  private previousRawState: RawAttentionState = "RAW_LOOKING";
  private lastFaceSeenMs = performance.now();

  private constructor(faceLandmarker: FaceLandmarker) {
    this.faceLandmarker = faceLandmarker;
  }

  static async create(modelAssetPath: string, wasmBasePath: string): Promise<GazeEstimator> {
    const vision = await FilesetResolver.forVisionTasks(wasmBasePath);
    const faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath,
      },
      runningMode: "VIDEO",
      numFaces: 1,
      minFaceDetectionConfidence: 0.4,
      minFacePresenceConfidence: 0.4,
      minTrackingConfidence: 0.4,
      outputFaceBlendshapes: false,
      outputFacialTransformationMatrixes: false,
    });

    return new GazeEstimator(faceLandmarker);
  }

  reset(nowMs = performance.now()): void {
    this.previousRawState = "RAW_LOOKING";
    this.lastFaceSeenMs = nowMs;
  }

  detect(video: HTMLVideoElement, nowMs: number, settings: AppSettings): GazeObservation {
    const result = this.faceLandmarker.detectForVideo(video, nowMs);
    const landmarks = (result.faceLandmarks[0] as NormalizedLandmark[] | undefined) ?? null;

    const evaluated = evaluateFrameAttention({
      landmarks,
      nowMs,
      previousRawState: this.previousRawState,
      lastFaceSeenMs: this.lastFaceSeenMs,
      yawThresholdDeg: settings.yawThresholdDeg,
      pitchThresholdDeg: settings.pitchThresholdDeg,
      noFaceTimeoutMs: settings.noFaceTimeoutMs,
    });

    this.previousRawState = evaluated.rawState;
    this.lastFaceSeenMs = evaluated.lastFaceSeenMs;

    return {
      rawState: evaluated.rawState,
      orientation: evaluated.orientation,
      hasFace: evaluated.hasFace,
    };
  }

  close(): void {
    this.faceLandmarker.close();
  }
}
