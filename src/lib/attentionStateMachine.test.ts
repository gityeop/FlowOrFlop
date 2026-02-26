import { describe, expect, it } from "vitest";

import { AttentionStateMachine } from "./attentionStateMachine";

describe("AttentionStateMachine", () => {
  it("emits LOOK_AWAY only after away debounce threshold", () => {
    const machine = new AttentionStateMachine({
      awayDebounceMs: 700,
      backDebounceMs: 500,
    });

    machine.reset("RAW_LOOKING", 0);

    expect(machine.process("RAW_AWAY", 100)).toBeNull();
    expect(machine.process("RAW_AWAY", 799)).toBeNull();
    expect(machine.process("RAW_AWAY", 800)).toBe("LOOK_AWAY");

    const snapshot = machine.snapshot();
    expect(snapshot.rawState).toBe("RAW_AWAY");
    expect(snapshot.isLookingAtScreen).toBe(false);
  });

  it("emits LOOK_BACK only after back debounce threshold", () => {
    const machine = new AttentionStateMachine({
      awayDebounceMs: 700,
      backDebounceMs: 500,
    });

    machine.reset("RAW_AWAY", 0);

    expect(machine.process("RAW_LOOKING", 100)).toBeNull();
    expect(machine.process("RAW_LOOKING", 599)).toBeNull();
    expect(machine.process("RAW_LOOKING", 600)).toBe("LOOK_BACK");

    const snapshot = machine.snapshot();
    expect(snapshot.rawState).toBe("RAW_LOOKING");
    expect(snapshot.isLookingAtScreen).toBe(true);
  });

  it("ignores jittery raw input around thresholds", () => {
    const machine = new AttentionStateMachine({
      awayDebounceMs: 700,
      backDebounceMs: 500,
    });

    machine.reset("RAW_LOOKING", 0);

    expect(machine.process("RAW_AWAY", 100)).toBeNull();
    expect(machine.process("RAW_LOOKING", 200)).toBeNull();
    expect(machine.process("RAW_AWAY", 300)).toBeNull();
    expect(machine.process("RAW_LOOKING", 400)).toBeNull();

    const snapshot = machine.snapshot();
    expect(snapshot.rawState).toBe("RAW_LOOKING");
  });

  it("does not emit duplicate events once stable state changed", () => {
    const machine = new AttentionStateMachine({
      awayDebounceMs: 700,
      backDebounceMs: 500,
    });

    machine.reset("RAW_LOOKING", 0);

    expect(machine.process("RAW_AWAY", 100)).toBeNull();
    expect(machine.process("RAW_AWAY", 801)).toBe("LOOK_AWAY");
    expect(machine.process("RAW_AWAY", 1200)).toBeNull();
    expect(machine.process("RAW_AWAY", 1800)).toBeNull();
  });
});
