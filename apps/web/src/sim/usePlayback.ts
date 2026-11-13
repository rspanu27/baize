import { useEffect, useState } from "react";
import type { DiagramDoc } from "../doc/types";

/** Playback speeds on offer: real time and two slow motions. */
export const PLAYBACK_RATES: readonly number[] = [1, 0.5, 0.25];

export interface Playback {
  /** Seconds into the shot being shown, or undefined when the editor shows the setup. */
  t: number | undefined;
  running: boolean;
  rate: number;
  /** Starts or resumes; from the start if the shot had played to the end. */
  play: () => void;
  pause: () => void;
  /** Back to the setup. */
  stop: () => void;
  /** Shows the shot at a time, paused. */
  seek: (t: number) => void;
  setRate: (rate: number) => void;
}

interface State {
  /** The document being played. Any change to the document ends the playback. */
  doc: DiagramDoc;
  t: number;
  running: boolean;
}

/** Where a playback is after `dt` more seconds of wall-clock time. Pure. */
export function advance(
  t: number,
  dtS: number,
  rate: number,
  durationS: number,
): { t: number; running: boolean } {
  const next = t + Math.max(0, dtS) * rate;
  return next >= durationS ? { t: durationS, running: false } : { t: next, running: true };
}

/** Playback of the shot of `doc`, which lasts `durationS` seconds. */
export function usePlayback(doc: DiagramDoc, durationS: number): Playback {
  const [state, setState] = useState<State | undefined>(undefined);
  const [rate, setRate] = useState(1);
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
        return { doc, ...advance(s.t, dt, rate, durationS) };
      });
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [running, doc, rate, durationS]);

  return {
    t: active?.t,
    running,
    rate,
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
  };
}
