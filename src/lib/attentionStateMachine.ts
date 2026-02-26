import { AttentionEvent, RawAttentionState } from "./types";

export interface AttentionStateMachineConfig {
  awayDebounceMs: number;
  backDebounceMs: number;
}

export interface AttentionStateSnapshot {
  isLookingAtScreen: boolean;
  rawState: RawAttentionState;
  lastStateChangeTs: number;
}

export class AttentionStateMachine {
  private stableRawState: RawAttentionState = "RAW_LOOKING";
  private candidateRawState: RawAttentionState | null = null;
  private candidateStartTs = 0;
  private lastStateChangeTs = 0;
  private config: AttentionStateMachineConfig;

  constructor(config: AttentionStateMachineConfig) {
    this.config = config;
    this.lastStateChangeTs = performance.now();
  }

  updateConfig(config: AttentionStateMachineConfig): void {
    this.config = config;
  }

  reset(initialState: RawAttentionState = "RAW_LOOKING", nowMs = performance.now()): void {
    this.stableRawState = initialState;
    this.candidateRawState = null;
    this.candidateStartTs = 0;
    this.lastStateChangeTs = nowMs;
  }

  process(rawState: RawAttentionState, nowMs: number): AttentionEvent | null {
    if (rawState === this.stableRawState) {
      this.candidateRawState = null;
      return null;
    }

    if (this.candidateRawState !== rawState) {
      this.candidateRawState = rawState;
      this.candidateStartTs = nowMs;
      return null;
    }

    const elapsedMs = nowMs - this.candidateStartTs;
    const debounceMs =
      rawState === "RAW_AWAY"
        ? this.config.awayDebounceMs
        : this.config.backDebounceMs;

    if (elapsedMs < debounceMs) {
      return null;
    }

    this.stableRawState = rawState;
    this.candidateRawState = null;
    this.lastStateChangeTs = nowMs;

    return rawState === "RAW_AWAY" ? "LOOK_AWAY" : "LOOK_BACK";
  }

  snapshot(): AttentionStateSnapshot {
    return {
      isLookingAtScreen: this.stableRawState === "RAW_LOOKING",
      rawState: this.stableRawState,
      lastStateChangeTs: this.lastStateChangeTs,
    };
  }
}
