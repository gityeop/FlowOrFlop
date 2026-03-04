import type { AppSettings, CalibrationResultPayload, CalibrationUiPayload } from "./types";

export interface CalibrationThresholdInput {
  insideYawAbs: number[];
  insidePitchAbs: number[];
  insideEyeAbsX: number[];
  insideEyeAbsY: number[];
  outsideYawAbs: number[];
  outsidePitchAbs: number[];
  outsideEyeAbsX: number[];
  outsideEyeAbsY: number[];
  minInsideEyeSampleCount: number;
  minOutsideEyeSampleCount: number;
}

export interface CalibrationStepState {
  phase: CalibrationUiPayload["phase"];
  countdown: CalibrationUiPayload["countdown"];
  pointDone: boolean;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function quantile(values: number[], ratio: number): number {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const index = clamp(Math.round((sorted.length - 1) * ratio), 0, sorted.length - 1);
  return sorted[index];
}

function roundToTwo(value: number): number {
  return Math.round(value * 100) / 100;
}

function deriveAwayThreshold(options: {
  outsideAbsValues: number[];
  insideThreshold: number | undefined;
  q25Margin: number;
  min: number;
  max: number;
  minSeparation: number;
  roundToTwoDigits?: boolean;
}): number | null {
  if (
    options.outsideAbsValues.length === 0 ||
    options.insideThreshold === undefined
  ) {
    return null;
  }

  const q25 = quantile(options.outsideAbsValues, 0.25);
  const candidateRaw = clamp(
    q25 - options.q25Margin,
    options.min,
    options.max,
  );
  const candidate = options.roundToTwoDigits
    ? roundToTwo(candidateRaw)
    : Math.round(candidateRaw);

  if (candidate < options.insideThreshold + options.minSeparation) {
    return null;
  }

  return candidate;
}

export function deriveCalibrationStep(
  elapsedMs: number,
  countdownMs: number,
  collectMs: number,
): CalibrationStepState {
  if (elapsedMs < countdownMs) {
    const countdown = Math.ceil((countdownMs - elapsedMs) / 1000) >= 2 ? 2 : 1;
    return {
      phase: "countdown",
      countdown,
      pointDone: false,
    };
  }

  if (elapsedMs < countdownMs + collectMs) {
    return {
      phase: "collect",
      countdown: null,
      pointDone: false,
    };
  }

  return {
    phase: "collect",
    countdown: null,
    pointDone: true,
  };
}

export function advanceCalibrationPoint(
  currentIndex: number,
  totalPoints: number,
): { nextIndex: number; done: boolean } {
  const nextIndex = currentIndex + 1;
  return {
    nextIndex,
    done: nextIndex >= totalPoints,
  };
}

export function computeCalibrationPatch(
  input: CalibrationThresholdInput,
): NonNullable<CalibrationResultPayload["applied"]> {
  const patch: NonNullable<CalibrationResultPayload["applied"]> = {
    awayEyeHorizontalThreshold: null,
    awayEyeVerticalThreshold: null,
    awayYawThresholdDeg: null,
    awayPitchThresholdDeg: null,
  };

  const insidePatch: Partial<
    Pick<
      AppSettings,
      "eyeHorizontalThreshold" | "eyeVerticalThreshold" | "yawThresholdDeg" | "pitchThresholdDeg" | "useEyeGaze"
    >
  > = {};

  if (input.insideYawAbs.length > 0) {
    insidePatch.yawThresholdDeg = clamp(
      Math.round(quantile(input.insideYawAbs, 0.95) + 3),
      6,
      30,
    );
  }

  if (input.insidePitchAbs.length > 0) {
    insidePatch.pitchThresholdDeg = clamp(
      Math.round(quantile(input.insidePitchAbs, 0.95) + 3),
      6,
      25,
    );
  }

  if (input.insideEyeAbsX.length >= input.minInsideEyeSampleCount) {
    insidePatch.eyeHorizontalThreshold = roundToTwo(
      clamp(quantile(input.insideEyeAbsX, 0.95) + 0.06, 0.15, 0.8),
    );
  }

  if (input.insideEyeAbsY.length >= input.minInsideEyeSampleCount) {
    insidePatch.eyeVerticalThreshold = roundToTwo(
      clamp(quantile(input.insideEyeAbsY, 0.95) + 0.06, 0.15, 0.9),
    );
  }

  if (insidePatch.eyeHorizontalThreshold && insidePatch.eyeVerticalThreshold) {
    insidePatch.useEyeGaze = true;
  }

  if (input.outsideEyeAbsX.length >= input.minOutsideEyeSampleCount) {
    patch.awayEyeHorizontalThreshold = deriveAwayThreshold({
      outsideAbsValues: input.outsideEyeAbsX,
      insideThreshold: insidePatch.eyeHorizontalThreshold,
      q25Margin: 0.04,
      min: 0.18,
      max: 1.2,
      minSeparation: 0.05,
      roundToTwoDigits: true,
    });
  }

  if (input.outsideEyeAbsY.length >= input.minOutsideEyeSampleCount) {
    patch.awayEyeVerticalThreshold = deriveAwayThreshold({
      outsideAbsValues: input.outsideEyeAbsY,
      insideThreshold: insidePatch.eyeVerticalThreshold,
      q25Margin: 0.04,
      min: 0.18,
      max: 1.2,
      minSeparation: 0.05,
      roundToTwoDigits: true,
    });
  }

  patch.awayYawThresholdDeg = deriveAwayThreshold({
    outsideAbsValues: input.outsideYawAbs,
    insideThreshold: insidePatch.yawThresholdDeg,
    q25Margin: 2,
    min: 8,
    max: 70,
    minSeparation: 3,
  });

  patch.awayPitchThresholdDeg = deriveAwayThreshold({
    outsideAbsValues: input.outsidePitchAbs,
    insideThreshold: insidePatch.pitchThresholdDeg,
    q25Margin: 2,
    min: 8,
    max: 70,
    minSeparation: 3,
  });

  return {
    ...insidePatch,
    ...patch,
  };
}
