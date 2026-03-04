import {
  FaceLandmarker,
  FilesetResolver,
  type NormalizedLandmark,
} from "@mediapipe/tasks-vision";

import { AppSettings, HYSTERESIS_BAND_DEG, RawAttentionState } from "./types";

const LEFT_EYE_OUTER_INDEX = 33;
const LEFT_EYE_INNER_INDEX = 133;
const LEFT_EYE_UPPER_INDEX = 159;
const LEFT_EYE_LOWER_INDEX = 145;
const RIGHT_EYE_OUTER_INDEX = 263;
const RIGHT_EYE_INNER_INDEX = 362;
const RIGHT_EYE_UPPER_INDEX = 386;
const RIGHT_EYE_LOWER_INDEX = 374;
const LEFT_IRIS_CENTER_INDEX = 468;
const RIGHT_IRIS_CENTER_INDEX = 473;
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

interface EyeGazeThresholds {
  useEyeGaze: boolean;
  eyeHorizontalThreshold: number;
  eyeVerticalThreshold: number;
  awayEyeHorizontalThreshold: number | null;
  awayEyeVerticalThreshold: number | null;
  eyeConfidenceThreshold: number;
  eyeSmoothingAlpha: number;
}

interface FrameEvaluationInput extends OrientationThresholds, EyeGazeThresholds {
  awayYawThresholdDeg: number | null;
  awayPitchThresholdDeg: number | null;
  previousEyeGaze: EyeGazeVector | null;
  noFaceTimeoutMs: number;
  nowMs: number;
  previousRawState: RawAttentionState;
  lastFaceSeenMs: number;
  landmarks: LandmarkLike[] | null;
}

interface EyeLandmarkIndices {
  outer: number;
  inner: number;
  upper: number;
  lower: number;
  iris: number;
}

export interface LandmarkLike {
  x: number;
  y: number;
  z?: number;
}

export interface EyeGazeVector {
  xNorm: number;
  yNorm: number;
  confidence: number;
}

export type AttentionClassificationSource =
  | "eye"
  | "eye_outside"
  | "pose_fallback"
  | "pose_outside"
  | "no_face"
  | "l2cs_sidecar";

export interface FrameEvaluationResult {
  rawState: RawAttentionState;
  orientation: Orientation | null;
  eyeGaze: EyeGazeVector | null;
  classificationSource: AttentionClassificationSource;
  lastFaceSeenMs: number;
  hasFace: boolean;
}

export interface GazeObservation {
  rawState: RawAttentionState;
  orientation: Orientation | null;
  eyeGaze: EyeGazeVector | null;
  classificationSource: AttentionClassificationSource;
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

function normalizedAxis(iris: number, start: number, end: number): number | null {
  const span = end - start;
  if (Math.abs(span) < 1e-4) {
    return null;
  }

  const ratio = clamp((iris - start) / span, -0.3, 1.3);
  return clamp((ratio - 0.5) * 2, -1.3, 1.3);
}

function eyeGeometryConfidence(width: number, height: number): number {
  const widthScore = clamp((width - 0.016) / 0.034, 0, 1);
  const openness = height / Math.max(width, 1e-4);
  const openScore = clamp((openness - 0.08) / 0.16, 0, 1);
  return clamp((widthScore + openScore) * 0.5, 0, 1);
}

function estimateSingleEyeGaze(
  landmarks: LandmarkLike[],
  indices: EyeLandmarkIndices,
): EyeGazeVector | null {
  const defaultPoint: LandmarkLike = { x: 0.5, y: 0.5, z: 0 };
  const outer = landmarkAt(landmarks, indices.outer, defaultPoint);
  const inner = landmarkAt(landmarks, indices.inner, defaultPoint);
  const upper = landmarkAt(landmarks, indices.upper, defaultPoint);
  const lower = landmarkAt(landmarks, indices.lower, defaultPoint);
  const iris = landmarkAt(landmarks, indices.iris, defaultPoint);

  const width = Math.hypot(inner.x - outer.x, inner.y - outer.y);
  const height = Math.hypot(lower.x - upper.x, lower.y - upper.y);
  if (width < 1e-4 || height < 1e-4) {
    return null;
  }

  const xNorm = normalizedAxis(iris.x, outer.x, inner.x);
  const yNorm = normalizedAxis(iris.y, upper.y, lower.y);
  if (xNorm === null || yNorm === null) {
    return null;
  }

  return {
    xNorm,
    yNorm,
    confidence: eyeGeometryConfidence(width, height),
  };
}

export function estimateEyeGazeFromLandmarks(
  landmarks: LandmarkLike[],
): EyeGazeVector | null {
  const leftEye = estimateSingleEyeGaze(landmarks, {
    outer: LEFT_EYE_OUTER_INDEX,
    inner: LEFT_EYE_INNER_INDEX,
    upper: LEFT_EYE_UPPER_INDEX,
    lower: LEFT_EYE_LOWER_INDEX,
    iris: LEFT_IRIS_CENTER_INDEX,
  });
  const rightEye = estimateSingleEyeGaze(landmarks, {
    outer: RIGHT_EYE_OUTER_INDEX,
    inner: RIGHT_EYE_INNER_INDEX,
    upper: RIGHT_EYE_UPPER_INDEX,
    lower: RIGHT_EYE_LOWER_INDEX,
    iris: RIGHT_IRIS_CENTER_INDEX,
  });

  if (!leftEye || !rightEye) {
    return null;
  }

  return {
    xNorm: clamp((leftEye.xNorm + rightEye.xNorm) * 0.5, -1, 1),
    yNorm: clamp((leftEye.yNorm + rightEye.yNorm) * 0.5, -1, 1),
    confidence: clamp(Math.min(leftEye.confidence, rightEye.confidence), 0, 1),
  };
}

export function smoothEyeGaze(
  current: EyeGazeVector,
  previous: EyeGazeVector | null,
  alpha: number,
): EyeGazeVector {
  const appliedAlpha = clamp(alpha, 0.05, 1);
  if (!previous) {
    return {
      ...current,
    };
  }

  return {
    xNorm: previous.xNorm + (current.xNorm - previous.xNorm) * appliedAlpha,
    yNorm: previous.yNorm + (current.yNorm - previous.yNorm) * appliedAlpha,
    confidence: previous.confidence + (current.confidence - previous.confidence) * appliedAlpha,
  };
}

export function isEyeGazeInRange(
  eyeGaze: EyeGazeVector,
  horizontalThreshold: number,
  verticalThreshold: number,
): boolean {
  return (
    Math.abs(eyeGaze.xNorm) <= Math.max(horizontalThreshold, 0.05) &&
    Math.abs(eyeGaze.yNorm) <= Math.max(verticalThreshold, 0.05)
  );
}

export function isEyeGazeOutsideRange(
  eyeGaze: EyeGazeVector,
  awayHorizontalThreshold: number | null,
  awayVerticalThreshold: number | null,
): boolean {
  return (
    (awayHorizontalThreshold !== null &&
      Math.abs(eyeGaze.xNorm) >= Math.max(awayHorizontalThreshold, 0.05)) ||
    (awayVerticalThreshold !== null &&
      Math.abs(eyeGaze.yNorm) >= Math.max(awayVerticalThreshold, 0.05))
  );
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

export function isPoseOutsideRange(
  orientation: Orientation,
  awayYawThresholdDeg: number | null,
  awayPitchThresholdDeg: number | null,
): boolean {
  return (
    (awayYawThresholdDeg !== null &&
      Math.abs(orientation.yawDeg) >= awayYawThresholdDeg) ||
    (awayPitchThresholdDeg !== null &&
      Math.abs(orientation.pitchDeg) >= awayPitchThresholdDeg)
  );
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
      eyeGaze: null,
      classificationSource: "no_face",
      lastFaceSeenMs: input.lastFaceSeenMs,
      hasFace: false,
    };
  }

  const orientation = estimateYawPitchFromLandmarks(input.landmarks);
  const rawStateByPose = classifyRawAttentionState(
    orientation,
    {
      yawThresholdDeg: input.yawThresholdDeg,
      pitchThresholdDeg: input.pitchThresholdDeg,
    },
    input.previousRawState,
  );

  const eyeGazeRaw = estimateEyeGazeFromLandmarks(input.landmarks);
  const eyeGaze = eyeGazeRaw
    ? smoothEyeGaze(eyeGazeRaw, input.previousEyeGaze, input.eyeSmoothingAlpha)
    : null;

  const canClassifyByEye =
    input.useEyeGaze &&
    !!eyeGaze &&
    eyeGaze.confidence >= Math.max(input.eyeConfidenceThreshold, 0);

  if (canClassifyByEye) {
    if (
      isEyeGazeOutsideRange(
        eyeGaze,
        input.awayEyeHorizontalThreshold,
        input.awayEyeVerticalThreshold,
      )
    ) {
      return {
        rawState: "RAW_AWAY",
        orientation,
        eyeGaze,
        classificationSource: "eye_outside",
        lastFaceSeenMs: input.nowMs,
        hasFace: true,
      };
    }

    const rawState = isEyeGazeInRange(
      eyeGaze,
      input.eyeHorizontalThreshold,
      input.eyeVerticalThreshold,
    )
      ? "RAW_LOOKING"
      : "RAW_AWAY";

    return {
      rawState,
      orientation,
      eyeGaze,
      classificationSource: "eye",
      lastFaceSeenMs: input.nowMs,
      hasFace: true,
    };
  }

  if (
    isPoseOutsideRange(
      orientation,
      input.awayYawThresholdDeg,
      input.awayPitchThresholdDeg,
    )
  ) {
    return {
      rawState: "RAW_AWAY",
      orientation,
      eyeGaze,
      classificationSource: "pose_outside",
      lastFaceSeenMs: input.nowMs,
      hasFace: true,
    };
  }

  return {
    rawState: rawStateByPose,
    orientation,
    eyeGaze,
    classificationSource: "pose_fallback",
    lastFaceSeenMs: input.nowMs,
    hasFace: true,
  };
}

export class GazeEstimator {
  private readonly faceLandmarker: FaceLandmarker;
  private previousRawState: RawAttentionState = "RAW_LOOKING";
  private previousEyeGaze: EyeGazeVector | null = null;
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
    this.previousEyeGaze = null;
    this.lastFaceSeenMs = nowMs;
  }

  detect(video: HTMLVideoElement, nowMs: number, settings: AppSettings): GazeObservation {
    const result = this.faceLandmarker.detectForVideo(video, nowMs);
    const landmarks = (result.faceLandmarks[0] as NormalizedLandmark[] | undefined) ?? null;

    const evaluated = evaluateFrameAttention({
      landmarks,
      nowMs,
      previousRawState: this.previousRawState,
      previousEyeGaze: this.previousEyeGaze,
      lastFaceSeenMs: this.lastFaceSeenMs,
      useEyeGaze: settings.useEyeGaze,
      yawThresholdDeg: settings.yawThresholdDeg,
      pitchThresholdDeg: settings.pitchThresholdDeg,
      awayYawThresholdDeg: settings.awayYawThresholdDeg,
      awayPitchThresholdDeg: settings.awayPitchThresholdDeg,
      eyeHorizontalThreshold: settings.eyeHorizontalThreshold,
      eyeVerticalThreshold: settings.eyeVerticalThreshold,
      awayEyeHorizontalThreshold: settings.awayEyeHorizontalThreshold,
      awayEyeVerticalThreshold: settings.awayEyeVerticalThreshold,
      eyeConfidenceThreshold: settings.eyeConfidenceThreshold,
      eyeSmoothingAlpha: settings.eyeSmoothingAlpha,
      noFaceTimeoutMs: settings.noFaceTimeoutMs,
    });

    this.previousRawState = evaluated.rawState;
    this.previousEyeGaze = evaluated.eyeGaze;
    this.lastFaceSeenMs = evaluated.lastFaceSeenMs;

    return {
      rawState: evaluated.rawState,
      orientation: evaluated.orientation,
      eyeGaze: evaluated.eyeGaze,
      classificationSource: evaluated.classificationSource,
      hasFace: evaluated.hasFace,
    };
  }

  close(): void {
    this.faceLandmarker.close();
  }
}
