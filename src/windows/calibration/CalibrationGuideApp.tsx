import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  type OutsideDirection,
  type CalibrationUiPayload,
  EVENT_CALIBRATION_UI,
} from "../../lib/types";
import "./CalibrationGuideApp.css";

interface StaticCalibrationPoint {
  id: string;
  xPercent: number;
  yPercent: number;
}

const STATIC_POINTS: StaticCalibrationPoint[] = [
  { id: "top-left", xPercent: 11, yPercent: 11 },
  { id: "top", xPercent: 50, yPercent: 11 },
  { id: "top-right", xPercent: 89, yPercent: 11 },
  { id: "left", xPercent: 11, yPercent: 50 },
  { id: "center", xPercent: 50, yPercent: 50 },
  { id: "right", xPercent: 89, yPercent: 50 },
  { id: "bottom-left", xPercent: 11, yPercent: 89 },
  { id: "bottom", xPercent: 50, yPercent: 89 },
  { id: "bottom-right", xPercent: 89, yPercent: 89 },
];

const OUTSIDE_DIRECTION_META: Record<
  OutsideDirection,
  { label: string; arrow: string }
> = {
  left: { label: "Left", arrow: "←" },
  top_left: { label: "Top-left", arrow: "↖" },
  top: { label: "Top", arrow: "↑" },
  top_right: { label: "Top-right", arrow: "↗" },
  right: { label: "Right", arrow: "→" },
  bottom_right: { label: "Bottom-right", arrow: "↘" },
  bottom: { label: "Bottom", arrow: "↓" },
  bottom_left: { label: "Bottom-left", arrow: "↙" },
};

export function CalibrationGuideApp() {
  const [ui, setUi] = useState<CalibrationUiPayload | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const previousCountdownRef = useRef<CalibrationUiPayload["countdown"]>(null);

  const playCountdownBeep = useCallback(async (countdown: 2 | 1) => {
    try {
      const AudioContextClass = window.AudioContext;
      if (!AudioContextClass) {
        return;
      }

      if (!audioContextRef.current) {
        audioContextRef.current = new AudioContextClass();
      }

      const context = audioContextRef.current;
      if (context.state === "suspended") {
        await context.resume();
      }

      const oscillator = context.createOscillator();
      const gain = context.createGain();
      const now = context.currentTime;
      const frequency = countdown === 2 ? 860 : 1020;

      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(frequency, now);

      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.exponentialRampToValueAtTime(0.085, now + 0.018);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.14);

      oscillator.connect(gain);
      gain.connect(context.destination);

      oscillator.start(now);
      oscillator.stop(now + 0.16);
    } catch {
      // Non-fatal: keep visual countdown running even if audio fails.
    }
  }, []);

  useEffect(() => {
    document.documentElement.classList.add("calibration-window");
    document.body.classList.add("calibration-window");

    return () => {
      document.documentElement.classList.remove("calibration-window");
      document.body.classList.remove("calibration-window");
      if (audioContextRef.current) {
        void audioContextRef.current.close();
        audioContextRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    let isMounted = true;
    let unlisten: (() => void) | null = null;

    void listen<CalibrationUiPayload>(EVENT_CALIBRATION_UI, (event) => {
      if (!isMounted) {
        return;
      }

      if (!event.payload.visible) {
        setUi(null);
        previousCountdownRef.current = null;
        return;
      }

      setUi(event.payload);
    }).then((dispose) => {
      unlisten = dispose;
    });

    return () => {
      isMounted = false;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    if (!ui || ui.phase !== "countdown" || ui.countdown === null) {
      previousCountdownRef.current = null;
      return;
    }

    if (previousCountdownRef.current === ui.countdown) {
      return;
    }

    previousCountdownRef.current = ui.countdown;
    void playCountdownBeep(ui.countdown);
  }, [playCountdownBeep, ui]);

  const statusText = useMemo(() => {
    if (!ui) {
      return "";
    }

    if (ui.phase === "countdown") {
      return `Get ready: ${ui.countdown ?? ""}`;
    }

    return `Sampling... (${ui.sampleCount})`;
  }, [ui]);

  if (!ui) {
    return null;
  }

  const isOutsideStep = ui.stepType === "outside";
  const outsideMeta = ui.outsideDirection
    ? OUTSIDE_DIRECTION_META[ui.outsideDirection]
    : null;
  const titleText =
    isOutsideStep && outsideMeta
      ? `Look outside: ${outsideMeta.label}`
      : `Look at ${ui.pointLabel}`;

  return (
    <main className="calibration-guide-root" aria-live="polite">
      <div className="calibration-guide-dim" />

      {!isOutsideStep &&
        STATIC_POINTS.map((point) => (
          <span
            key={point.id}
            className="calibration-guide-point"
            style={{
              left: `${point.xPercent}%`,
              top: `${point.yPercent}%`,
            }}
          />
        ))}

      {!isOutsideStep && (
        <span
          className={`calibration-guide-target phase-${ui.phase}`}
          style={{
            left: `${ui.xPercent}%`,
            top: `${ui.yPercent}%`,
          }}
        />
      )}

      {isOutsideStep && outsideMeta && (
        <section className="calibration-guide-outside">
          <p className="calibration-guide-outside-label">Look outside monitor</p>
          <p className="calibration-guide-outside-arrow">{outsideMeta.arrow}</p>
          <p className="calibration-guide-outside-text">{outsideMeta.label}</p>
        </section>
      )}

      <section className="calibration-guide-panel">
        <p className="calibration-guide-progress">
          {ui.pointIndex + 1}/{ui.totalPoints}
        </p>
        <h1 className="calibration-guide-title">{titleText}</h1>
        <p className="calibration-guide-countdown">
          {ui.phase === "countdown" ? ui.countdown : "●"}
        </p>
        <p className="calibration-guide-status">{statusText}</p>
      </section>
    </main>
  );
}
