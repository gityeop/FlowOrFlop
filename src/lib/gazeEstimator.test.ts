import { describe, expect, it } from "vitest";

import {
  classifyRawAttentionState,
  estimateYawPitchFromLandmarks,
  evaluateFrameAttention,
  type LandmarkLike,
} from "./gazeEstimator";

function buildLandmarks(overrides: {
  noseX?: number;
  noseY?: number;
  leftEyeX?: number;
  rightEyeX?: number;
  eyeY?: number;
  mouthY?: number;
} = {}): LandmarkLike[] {
  const {
    noseX = 0.5,
    noseY = 0.5,
    leftEyeX = 0.4,
    rightEyeX = 0.6,
    eyeY = 0.4,
    mouthY = 0.62,
  } = overrides;

  const landmarks: LandmarkLike[] = Array.from({ length: 264 }, () => ({
    x: 0.5,
    y: 0.5,
    z: 0,
  }));

  landmarks[33] = { x: leftEyeX, y: eyeY, z: 0 };
  landmarks[263] = { x: rightEyeX, y: eyeY, z: 0 };
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
  it("keeps prior state when no face is brief", () => {
    const result = evaluateFrameAttention({
      landmarks: null,
      nowMs: 350,
      previousRawState: "RAW_LOOKING",
      lastFaceSeenMs: 0,
      yawThresholdDeg: 12,
      pitchThresholdDeg: 10,
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
      lastFaceSeenMs: 0,
      yawThresholdDeg: 12,
      pitchThresholdDeg: 10,
      noFaceTimeoutMs: 400,
    });

    expect(result.rawState).toBe("RAW_AWAY");
    expect(result.hasFace).toBe(false);
  });
});
