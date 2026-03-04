import { describe, expect, it } from "vitest";

import {
  advanceCalibrationPoint,
  computeCalibrationPatch,
  deriveCalibrationStep,
} from "./calibration";

describe("deriveCalibrationStep", () => {
  it("stays in 2-1 countdown and then switches to collect", () => {
    expect(deriveCalibrationStep(0, 2000, 1000)).toEqual({
      phase: "countdown",
      countdown: 2,
      pointDone: false,
    });

    expect(deriveCalibrationStep(1001, 2000, 1000)).toEqual({
      phase: "countdown",
      countdown: 1,
      pointDone: false,
    });

    expect(deriveCalibrationStep(2000, 2000, 1000)).toEqual({
      phase: "collect",
      countdown: null,
      pointDone: false,
    });

    expect(deriveCalibrationStep(3000, 2000, 1000)).toEqual({
      phase: "collect",
      countdown: null,
      pointDone: true,
    });
  });
});

describe("computeCalibrationPatch", () => {
  it("computes inside and outside thresholds when outside samples are sufficiently separated", () => {
    const patch = computeCalibrationPatch({
      insideYawAbs: [4, 8, 10, 12, 15],
      insidePitchAbs: [2, 5, 7, 9, 10],
      insideEyeAbsX: [0.12, 0.19, 0.31, 0.35, 0.41],
      insideEyeAbsY: [0.2, 0.25, 0.33, 0.39, 0.44],
      outsideYawAbs: [19, 24, 25, 27, 31],
      outsidePitchAbs: [16, 18, 20, 22, 23],
      outsideEyeAbsX: [0.58, 0.62, 0.66, 0.71, 0.73],
      outsideEyeAbsY: [0.61, 0.66, 0.72, 0.78, 0.81],
      minInsideEyeSampleCount: 5,
      minOutsideEyeSampleCount: 5,
    });

    expect(patch.yawThresholdDeg).toBeGreaterThanOrEqual(6);
    expect(patch.yawThresholdDeg).toBeLessThanOrEqual(30);
    expect(patch.pitchThresholdDeg).toBeGreaterThanOrEqual(6);
    expect(patch.pitchThresholdDeg).toBeLessThanOrEqual(25);
    expect(patch.eyeHorizontalThreshold).toBeGreaterThanOrEqual(0.15);
    expect(patch.eyeHorizontalThreshold).toBeLessThanOrEqual(0.8);
    expect(patch.eyeVerticalThreshold).toBeGreaterThanOrEqual(0.15);
    expect(patch.eyeVerticalThreshold).toBeLessThanOrEqual(0.9);
    expect(patch.useEyeGaze).toBe(true);
    expect(patch.awayYawThresholdDeg).not.toBeNull();
    expect(patch.awayPitchThresholdDeg).not.toBeNull();
    expect(patch.awayEyeHorizontalThreshold).not.toBeNull();
    expect(patch.awayEyeVerticalThreshold).not.toBeNull();
  });

  it("stores null for outside thresholds when outside range is not separated enough", () => {
    const patch = computeCalibrationPatch({
      insideYawAbs: [10, 12, 14, 15, 16],
      insidePitchAbs: [8, 9, 11, 12, 13],
      insideEyeAbsX: [0.31, 0.34, 0.35, 0.36, 0.38],
      insideEyeAbsY: [0.33, 0.35, 0.38, 0.39, 0.41],
      outsideYawAbs: [12, 13, 14, 15, 16],
      outsidePitchAbs: [10, 11, 12, 13, 14],
      outsideEyeAbsX: [0.34, 0.36, 0.38, 0.4, 0.41],
      outsideEyeAbsY: [0.36, 0.37, 0.39, 0.41, 0.42],
      minInsideEyeSampleCount: 5,
      minOutsideEyeSampleCount: 5,
    });

    expect(patch.eyeHorizontalThreshold).toBeDefined();
    expect(patch.eyeVerticalThreshold).toBeDefined();
    expect(patch.awayYawThresholdDeg).toBeNull();
    expect(patch.awayPitchThresholdDeg).toBeNull();
    expect(patch.awayEyeHorizontalThreshold).toBeNull();
    expect(patch.awayEyeVerticalThreshold).toBeNull();
  });
});

describe("advanceCalibrationPoint", () => {
  it("moves to next index and marks done at boundary", () => {
    expect(advanceCalibrationPoint(0, 17)).toEqual({
      nextIndex: 1,
      done: false,
    });

    expect(advanceCalibrationPoint(16, 17)).toEqual({
      nextIndex: 17,
      done: true,
    });
  });
});
