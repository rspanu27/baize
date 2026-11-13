import { useEffect, useState } from "react";
import type { DiagramDoc } from "../doc/types";

/** Playback speeds on offer: real time and three slow motions. */
export const PLAYBACK_RATES: readonly number[] = [1, 0.5, 0.25, 0.1];

/** With repeat on, how long the finished shot is held before it starts again, in real seconds. */
export const REPEAT_HOLD_S = 0.8;

export interface Playback {
  /** Seconds into the shot being shown, or undefined when the editor shows the setup. */
  t: number | undefined;
  running: boolean;
  rate: number;
  /** Start again from the beginning each time the shot ends. */
  repeat: boolean;
  /** Starts or resumes; from the start if the shot had played to the end. */
  play: () => void;
  pause: () => void;
  /** Back to the setup. */
  stop: () => void;
  /** Shows the shot at a time, paused. */
  seek: (t: number) => void;
  setRate: (rate: number) => void;
  setRepeat: (repeat: boolean) => void;
}

export interface KeyTarget {
  tagName?: string;
  isContentEditable?: boolean;
}

/**
 * True when a key press is the space bar meant for playback: not while typing, and not on a
 * control that the space bar already operates (buttons, links, sliders, checkboxes).
 */
export function isPlayKey(
  e: { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; repeat?: boolean },
  target: (KeyTarget & { getAttribute?: (name: string) => string | null }) | null,
): boolean {
  if (e.key !== " " || e.ctrlKey || e.metaKey || e.altKey || e.repeat === true) return false;
  if (!target) return true;
  if (target.isContentEditable) return false;
  const tag = target.tagName?.toUpperCase();
  if (["INPUT", "TEXTAREA", "SELECT", "BUTTON", "A", "SUMMARY"].includes(tag ?? "")) return false;
  const role = target.getAttribute?.("role");
  return role !== "slider" && role !== "button";
}

interface State {
  /** The document being played. Any change to the document ends the playback. */
  doc: DiagramDoc;
  t: number;
  running: boolean;
}

/**
 * Where a playback is after `dt` more seconds of wall-clock time. Pure.
 *
 * With `repeat`, the time runs on past the end of the shot (the balls are at rest there) for
 * `REPEAT_HOLD_S` real seconds, then starts again from zero.
 */
export function advance(
  t: number,
  dtS: number,
  rate: number,
  durationS: number,
  repeat = false,
): { t: number; running: boolean } {
  const next = t + Math.max(0, dtS) * rate;
  if (!repeat) {
    return next >= durationS ? { t: durationS, running: false } : { t: next, running: true };
  }
  return next >= durationS + REPEAT_HOLD_S * rate
    ? { t: 0, running: true }
    : { t: next, running: true };
}

/** Playback of the shot of `doc`, which lasts `durationS` seconds. */
export function usePlayback(doc: DiagramDoc, durationS: number): Playback {
  const [state, setState] = useState<State | undefined>(undefined);
  const [rate, setRate] = useState(1);
  const [repeat, setRepeat] = useState(false);
  // Any change to the document ends the playback for good: undo and redo bring back the very
  // same document object, and must not bring a finished playback back with it.
  if (state && state.doc !== doc) setState(undefined);
  const active = state?.doc === doc ? state : undefined;
  const running = active?.running === true;

  useEffect(() => {
    if (!running) return;
    let frame = 0;
    let last: number | undefined;
    const tick = (now: number): void => {
      const dt = last === undefined ? 0 : (now - last) / 1000;
      last = now;
      setState((s) => {
        if (s?.doc !== doc || !s.running) return s;
        return { doc, ...advance(s.t, dt, rate, durationS, repeat) };
      });
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [running, doc, rate, durationS, repeat]);

  return {
    t: active?.t,
    running,
    rate,
    repeat,
    play: () => {
      const from = active && active.t < durationS ? active.t : 0;
      setState({ doc, t: from, running: true });
    },
    pause: () => {
      if (active) setState({ ...active, running: false });
    },
    stop: () => {
      setState(undefined);
    },
    seek: (t) => {
      setState({ doc, t: Math.min(durationS, Math.max(0, t)), running: false });
    },
    setRate,
    setRepeat,
  };
}

/** The space bar plays and pauses the shot, wherever the focus is (except in controls). */
export function usePlayKey(playback: Playback, enabled: boolean): void {
  const { running, play, pause } = playback;
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent): void => {
      if (!isPlayKey(e, e.target as KeyTarget | null)) return;
      // Otherwise the space bar scrolls the panel.
      e.preventDefault();
      if (running) pause();
      else play();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
    };
    // `play` and `pause` are new functions on every render; `running` and the playback's own
    // state decide what they do, so re-subscribing on each render is what keeps them current.
  });
}
