import { describe, expect, it } from "vitest";

import {
  classifyRawAttentionState,
  estimateEyeGazeFromLandmarks,
  estimateYawPitchFromLandmarks,
  evaluateFrameAttention,
  isEyeGazeInRange,
  isEyeGazeOutsideRange,
  isPoseOutsideRange,
  smoothEyeGaze,
  type LandmarkLike,
} from "./gazeEstimator";

function buildLandmarks(overrides: {
  noseX?: number;
  noseY?: number;
  leftEyeX?: number;
  rightEyeX?: number;
  eyeY?: number;
  mouthY?: number;
  leftIrisX?: number;
  rightIrisX?: number;
  leftIrisY?: number;
  rightIrisY?: number;
} = {}): LandmarkLike[] {
  const {
    noseX = 0.5,
    noseY = 0.5,
    leftEyeX = 0.4,
    rightEyeX = 0.6,
    eyeY = 0.4,
    mouthY = 0.62,
    leftIrisX = 0.435,
    rightIrisX = 0.565,
    leftIrisY = 0.4,
    rightIrisY = 0.4,
  } = overrides;

  const landmarks: LandmarkLike[] = Array.from({ length: 478 }, () => ({
    x: 0.5,
    y: 0.5,
    z: 0,
  }));

  landmarks[33] = { x: leftEyeX, y: eyeY, z: 0 };
  landmarks[133] = { x: leftEyeX + 0.07, y: eyeY, z: 0 };
  landmarks[159] = { x: leftEyeX + 0.035, y: eyeY - 0.006, z: 0 };
  landmarks[145] = { x: leftEyeX + 0.035, y: eyeY + 0.006, z: 0 };
  landmarks[263] = { x: rightEyeX, y: eyeY, z: 0 };
  landmarks[362] = { x: rightEyeX - 0.07, y: eyeY, z: 0 };
  landmarks[386] = { x: rightEyeX - 0.035, y: eyeY - 0.006, z: 0 };
  landmarks[374] = { x: rightEyeX - 0.035, y: eyeY + 0.006, z: 0 };
  landmarks[468] = { x: leftIrisX, y: leftIrisY, z: 0 };
  landmarks[473] = { x: rightIrisX, y: rightIrisY, z: 0 };
  landmarks[1] = { x: noseX, y: noseY, z: 0 };
  landmarks[13] = { x: 0.5, y: mouthY - 0.01, z: 0 };
  landmarks[14] = { x: 0.5, y: mouthY + 0.01, z: 0 };

  return landmarks;
}

describe("estimateYawPitchFromLandmarks", () => {
  it("returns positive yaw when nose is shifted to the right", () => {
    const landmarks = buildLandmarks({ noseX: 0.57 });
    const orientation = estimateYawPitchFromLandmarks(landmarks);

    expect(orientation.yawDeg).toBeGreaterThan(0);
  });

  it("returns positive pitch when nose is shifted down", () => {
    const landmarks = buildLandmarks({ noseY: 0.57 });
    const orientation = estimateYawPitchFromLandmarks(landmarks);

    expect(orientation.pitchDeg).toBeGreaterThan(0);
  });
});

describe("eye gaze helpers", () => {
  it("estimates near-centered eye gaze for centered iris", () => {
    const eyeGaze = estimateEyeGazeFromLandmarks(buildLandmarks());
    expect(eyeGaze).not.toBeNull();
    expect(Math.abs(eyeGaze?.xNorm ?? 1)).toBeLessThan(0.2);
    expect(Math.abs(eyeGaze?.yNorm ?? 1)).toBeLessThan(0.3);
  });

  it("classifies out-of-range eye gaze", () => {
    const eyeGaze = estimateEyeGazeFromLandmarks(
      buildLandmarks({
        leftIrisX: 0.468,
        rightIrisX: 0.532,
      }),
    );

    expect(eyeGaze).not.toBeNull();
    expect(
      isEyeGazeInRange(eyeGaze!, 0.25, 0.45),
    ).toBe(false);
  });

  it("smooths eye gaze with alpha", () => {
    const smoothed = smoothEyeGaze(
      { xNorm: 0.5, yNorm: 0.4, confidence: 0.8 },
      { xNorm: 0.1, yNorm: 0.1, confidence: 0.4 },
      0.5,
    );

    expect(smoothed.xNorm).toBeCloseTo(0.3, 3);
    expect(smoothed.yNorm).toBeCloseTo(0.25, 3);
    expect(smoothed.confidence).toBeCloseTo(0.6, 3);
  });

  it("detects outside-threshold eye gaze", () => {
    const isOutside = isEyeGazeOutsideRange(
      {
        xNorm: 0.68,
        yNorm: 0.1,
        confidence: 0.9,
      },
      0.6,
      null,
    );
    expect(isOutside).toBe(true);
  });
});

describe("classifyRawAttentionState", () => {
  it("applies hysteresis when entering RAW_AWAY", () => {
    const orientation = { yawDeg: 14, pitchDeg: 0 };
    const state = classifyRawAttentionState(
      orientation,
      { yawThresholdDeg: 12, pitchThresholdDeg: 10 },
      "RAW_LOOKING",
      3,
    );

    expect(state).toBe("RAW_LOOKING");

    const awayOrientation = { yawDeg: 16, pitchDeg: 0 };
    const awayState = classifyRawAttentionState(
      awayOrientation,
      { yawThresholdDeg: 12, pitchThresholdDeg: 10 },
      "RAW_LOOKING",
      3,
    );

    expect(awayState).toBe("RAW_AWAY");
  });

  it("requires base threshold to return from RAW_AWAY", () => {
    const stillAway = classifyRawAttentionState(
      { yawDeg: 13, pitchDeg: 0 },
      { yawThresholdDeg: 12, pitchThresholdDeg: 10 },
      "RAW_AWAY",
      3,
    );
    expect(stillAway).toBe("RAW_AWAY");

    const backLooking = classifyRawAttentionState(
      { yawDeg: 11, pitchDeg: 9 },
      { yawThresholdDeg: 12, pitchThresholdDeg: 10 },
      "RAW_AWAY",
      3,
    );
    expect(backLooking).toBe("RAW_LOOKING");
  });
});

describe("evaluateFrameAttention", () => {
  it("detects pose outside-threshold", () => {
    const isOutside = isPoseOutsideRange(
      { yawDeg: 31, pitchDeg: 4 },
      30,
      null,
    );
    expect(isOutside).toBe(true);
  });

  it("keeps prior state when no face is brief", () => {
    const result = evaluateFrameAttention({
      landmarks: null,
      nowMs: 350,
      previousRawState: "RAW_LOOKING",
      previousEyeGaze: null,
      lastFaceSeenMs: 0,
      useEyeGaze: true,
      yawThresholdDeg: 12,
      pitchThresholdDeg: 10,
      awayYawThresholdDeg: null,
      awayPitchThresholdDeg: null,
      eyeHorizontalThreshold: 0.3,
      eyeVerticalThreshold: 0.4,
      awayEyeHorizontalThreshold: null,
      awayEyeVerticalThreshold: null,
      eyeConfidenceThreshold: 0.3,
      eyeSmoothingAlpha: 0.4,
      noFaceTimeoutMs: 400,
    });

    expect(result.rawState).toBe("RAW_LOOKING");
    expect(result.hasFace).toBe(false);
  });

  it("switches to RAW_AWAY when no face exceeds timeout", () => {
    const result = evaluateFrameAttention({
      landmarks: null,
      nowMs: 401,
      previousRawState: "RAW_LOOKING",
      previousEyeGaze: null,
      lastFaceSeenMs: 0,
      useEyeGaze: true,
      yawThresholdDeg: 12,
      pitchThresholdDeg: 10,
      awayYawThresholdDeg: null,
      awayPitchThresholdDeg: null,
      eyeHorizontalThreshold: 0.3,
      eyeVerticalThreshold: 0.4,
      awayEyeHorizontalThreshold: null,
      awayEyeVerticalThreshold: null,
      eyeConfidenceThreshold: 0.3,
      eyeSmoothingAlpha: 0.4,
      noFaceTimeoutMs: 400,
    });

    expect(result.rawState).toBe("RAW_AWAY");
    expect(result.hasFace).toBe(false);
  });

  it("uses eye-gaze as primary raw-state source", () => {
    const result = evaluateFrameAttention({
      landmarks: buildLandmarks({
        leftIrisX: 0.468,
        rightIrisX: 0.532,
      }),
      nowMs: 100,
      previousRawState: "RAW_LOOKING",
      previousEyeGaze: null,
      lastFaceSeenMs: 0,
      useEyeGaze: true,
      yawThresholdDeg: 20,
      pitchThresholdDeg: 20,
      awayYawThresholdDeg: null,
      awayPitchThresholdDeg: null,
      eyeHorizontalThreshold: 0.25,
      eyeVerticalThreshold: 0.45,
      awayEyeHorizontalThreshold: null,
      awayEyeVerticalThreshold: null,
      eyeConfidenceThreshold: 0.2,
      eyeSmoothingAlpha: 0.5,
      noFaceTimeoutMs: 400,
    });

    expect(result.classificationSource).toBe("eye");
    expect(result.rawState).toBe("RAW_AWAY");
  });

  it("forces RAW_AWAY with eye outside-threshold", () => {
    const result = evaluateFrameAttention({
      landmarks: buildLandmarks({
        leftIrisX: 0.468,
        rightIrisX: 0.532,
      }),
      nowMs: 110,
      previousRawState: "RAW_LOOKING",
      previousEyeGaze: null,
      lastFaceSeenMs: 0,
      useEyeGaze: true,
      yawThresholdDeg: 20,
      pitchThresholdDeg: 20,
      awayYawThresholdDeg: null,
      awayPitchThresholdDeg: null,
      eyeHorizontalThreshold: 0.9,
      eyeVerticalThreshold: 0.9,
      awayEyeHorizontalThreshold: 0.5,
      awayEyeVerticalThreshold: null,
      eyeConfidenceThreshold: 0.2,
      eyeSmoothingAlpha: 0.5,
      noFaceTimeoutMs: 400,
    });

    expect(result.classificationSource).toBe("eye_outside");
    expect(result.rawState).toBe("RAW_AWAY");
  });

  it("falls back to pose when eye confidence is too low", () => {
    const lowConfidenceLandmarks = buildLandmarks();
    lowConfidenceLandmarks[159] = { x: 0.435, y: 0.402, z: 0 };
    lowConfidenceLandmarks[145] = { x: 0.435, y: 0.403, z: 0 };
    lowConfidenceLandmarks[386] = { x: 0.565, y: 0.402, z: 0 };
    lowConfidenceLandmarks[374] = { x: 0.565, y: 0.403, z: 0 };

    const result = evaluateFrameAttention({
      landmarks: lowConfidenceLandmarks,
      nowMs: 120,
      previousRawState: "RAW_LOOKING",
      previousEyeGaze: null,
      lastFaceSeenMs: 0,
      useEyeGaze: true,
      yawThresholdDeg: 20,
      pitchThresholdDeg: 20,
      awayYawThresholdDeg: null,
      awayPitchThresholdDeg: null,
      eyeHorizontalThreshold: 0.25,
      eyeVerticalThreshold: 0.45,
      awayEyeHorizontalThreshold: null,
      awayEyeVerticalThreshold: null,
      eyeConfidenceThreshold: 0.8,
      eyeSmoothingAlpha: 0.5,
      noFaceTimeoutMs: 400,
    });

    expect(result.classificationSource).toBe("pose_fallback");
    expect(result.rawState).toBe("RAW_LOOKING");
  });

  it("forces RAW_AWAY in pose fallback when outside pose threshold is set", () => {
    const result = evaluateFrameAttention({
      landmarks: buildLandmarks({ noseX: 0.63 }),
      nowMs: 150,
      previousRawState: "RAW_LOOKING",
      previousEyeGaze: null,
      lastFaceSeenMs: 0,
      useEyeGaze: false,
      yawThresholdDeg: 20,
      pitchThresholdDeg: 20,
      awayYawThresholdDeg: 18,
      awayPitchThresholdDeg: null,
      eyeHorizontalThreshold: 0.25,
      eyeVerticalThreshold: 0.45,
      awayEyeHorizontalThreshold: null,
      awayEyeVerticalThreshold: null,
      eyeConfidenceThreshold: 0.2,
      eyeSmoothingAlpha: 0.5,
      noFaceTimeoutMs: 400,
    });

    expect(result.classificationSource).toBe("pose_outside");
    expect(result.rawState).toBe("RAW_AWAY");
  });
});
