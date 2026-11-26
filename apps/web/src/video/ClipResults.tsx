import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { DiagramTheme } from "../doc/types";
import { useUnitSystem } from "../units/usePreference";
import { exportFileName, exportVideo, saveBlob } from "./export";
import type { Clip } from "./media";
import { frameNear, overlayDrawer, paintFrame, playTimeline } from "./preview";
import { initialChoice, outputFps, outputSize, outputTimeline } from "./resultsModel";
import type { ShotChoice } from "./resultsModel";
import { ResultsView } from "./ResultsView";
import type { OverlayFlag, SaveState } from "./ResultsView";
import { DEFAULT_OVERLAYS } from "./types";
import type { ClipAnalysis, FittedClipShot, OverlayOptions } from "./types";

/**
 * The analysed clip on the video screen (task 7.10): picks the shot and overlays, draws the
 * preview, plays it, and writes the video. The clip's decoder is used by one thing at a time
 * (a preview frame, playing, or writing), in the order asked. Everything stays in this
 * component and this page; the written file goes only to the person's own Save.
 */

export interface ClipResultsProps {
  clip: Clip;
  fileName: string;
  analysis: ClipAnalysis;
  details: ReactNode;
  /** The document's theme: where the colours start. */
  theme: DiagramTheme;
  /** Only a fitted shot can be opened. */
  onOpen: (shot: FittedClipShot) => void;
  onAdjust: () => void;
  onClose: () => void;
}

export function ClipResults(props: ClipResultsProps) {
  const { clip, analysis } = props;
  const [units] = useUnitSystem();
  const [choice, setChoice] = useState<ShotChoice>(() => initialChoice(analysis));
  const [look, setLook] = useState<Omit<OverlayOptions, "units">>(() => ({
    ...DEFAULT_OVERLAYS,
    theme: props.theme,
  }));
  const options: OverlayOptions = useMemo(() => ({ ...look, units }), [look, units]);
  // The clip's frame rate, at most 60 fps: preview and saved video alike.
  const fps = useMemo(() => outputFps(analysis), [analysis]);
  const size = useMemo(() => outputSize(analysis.widthPx, analysis.heightPx), [analysis]);
  const timeline = useMemo(
    () => outputTimeline(analysis, options, fps, choice),
    [analysis, options, fps, choice],
  );
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [behind, setBehind] = useState(false);
  const [save, setSave] = useState<SaveState>({ kind: "idle" });

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  // One user of the decoder at a time: tasks run in the order they are queued.
  const queue = useRef<Promise<void>>(Promise.resolve());
  const enqueue = useCallback((task: () => Promise<void>) => {
    queue.current = queue.current.then(task).catch(() => undefined);
  }, []);
  const alive = useRef(true);
  const playAbort = useRef<AbortController | undefined>(undefined);
  const saveAbort = useRef<AbortController | undefined>(undefined);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      playAbort.current?.abort();
      saveAbort.current?.abort();
    };
  }, []);

  // The frame to show when not playing: only the latest asked for is drawn.
  const wanted = useRef<number | undefined>(undefined);
  const drawing = useRef(false);
  const latest = useRef({ timeline, options });
  useEffect(() => {
    latest.current = { timeline, options };
  }, [timeline, options]);
  const show = useCallback(
    (i: number) => {
      wanted.current = i;
      if (drawing.current) return;
      drawing.current = true;
      enqueue(async () => {
        try {
          while (wanted.current !== undefined && alive.current) {
            const at = wanted.current;
            wanted.current = undefined;
            const frame = latest.current.timeline[at];
            if (!frame) continue;
            const picture = await frameNear(clip, frame.clipTimeS);
            const ctx = canvasRef.current?.getContext("2d");
            if (picture && ctx && alive.current) {
              paintFrame(ctx, picture.canvas, analysis, latest.current.options, frame);
            }
          }
        } finally {
          drawing.current = false;
        }
      });
    },
    [clip, analysis, enqueue],
  );

  const stopPlaying = () => {
    playAbort.current?.abort();
    playAbort.current = undefined;
    setPlaying(false);
  };

  // Redraw when what is shown changes (and not while playing: the player draws then).
  useEffect(() => {
    if (!playing) show(Math.min(index, Math.max(0, timeline.length - 1)));
  }, [show, index, timeline, options, playing]);

  const play = () => {
    if (timeline.length === 0) return;
    const from = index >= timeline.length - 1 ? 0 : index;
    const abort = new AbortController();
    playAbort.current?.abort();
    playAbort.current = abort;
    setPlaying(true);
    setBehind(false);
    const frames = timeline;
    enqueue(async () => {
      try {
        const lastShown = await playTimeline({
          clip,
          timeline: frames,
          from,
          fps,
          signal: abort.signal,
          show: (source, i) => {
            const ctx = canvasRef.current?.getContext("2d");
            const frame = frames[i];
            if (ctx && frame) paintFrame(ctx, source, analysis, latest.current.options, frame);
          },
          onBehind: () => {
            if (alive.current) setBehind(true);
          },
        });
        if (alive.current && playAbort.current === abort) setIndex(lastShown);
      } finally {
        if (alive.current && playAbort.current === abort) {
          playAbort.current = undefined;
          setPlaying(false);
        }
      }
    });
  };

  const saveVideo = () => {
    stopPlaying();
    const abort = new AbortController();
    saveAbort.current = abort;
    const frames = timeline;
    const opts = options;
    setSave({ kind: "saving", done: 0, total: frames.length });
    enqueue(async () => {
      try {
        const result = await exportVideo({
          clip,
          widthPx: size.widthPx,
          heightPx: size.heightPx,
          fps,
          timeline: frames,
          draw: overlayDrawer(analysis, opts, size.widthPx, size.heightPx),
          onProgress: (done, total) => {
            if (alive.current && !abort.signal.aborted) setSave({ kind: "saving", done, total });
          },
          signal: abort.signal,
        });
        if (!alive.current || abort.signal.aborted) return;
        const name = exportFileName(props.fileName, result.format);
        saveBlob(result.blob, name);
        setSave({ kind: "saved", fileName: name });
      } catch (e) {
        if (!alive.current) return;
        if (abort.signal.aborted || (e instanceof DOMException && e.name === "AbortError")) {
          setSave({ kind: "cancelled" });
        } else {
          setSave({
            kind: "failed",
            message:
              e instanceof Error && e.message ? e.message : "The video could not be written.",
          });
        }
      } finally {
        if (saveAbort.current === abort) saveAbort.current = undefined;
      }
    });
  };

  const frame = timeline[Math.min(index, Math.max(0, timeline.length - 1))];
  const lastFrame = timeline[timeline.length - 1];
  return (
    <ResultsView
      details={props.details}
      durationS={analysis.durationS}
      shots={analysis.shots}
      choice={choice}
      options={options}
      units={units}
      canvasRef={canvasRef}
      widthPx={size.widthPx}
      heightPx={size.heightPx}
      frameCount={timeline.length}
      frameIndex={index}
      timeS={frame?.outTimeS ?? 0}
      lengthS={lastFrame ? lastFrame.outTimeS + 1 / fps : 0}
      playing={playing}
      behind={behind}
      save={save}
      onChoose={(c) => {
        stopPlaying();
        setChoice(c);
        setIndex(0);
      }}
      onFlag={(flag: OverlayFlag, on) => {
        // Slow motion changes the frames of the video, so playing starts again from them.
        if (flag === "slowMotion") {
          stopPlaying();
          setIndex(0);
        }
        setLook((l) => ({ ...l, [flag]: on }));
      }}
      onTheme={(theme) => {
        setLook((l) => ({ ...l, theme }));
      }}
      onScrub={(i) => {
        stopPlaying();
        setIndex(i);
      }}
      onPlay={play}
      onPause={stopPlaying}
      onSave={saveVideo}
      onCancelSave={() => {
        saveAbort.current?.abort();
      }}
      onOpen={() => {
        const shot = choice === "whole" ? undefined : analysis.shots[choice];
        if (shot?.fitted) props.onOpen(shot);
      }}
      onAdjust={props.onAdjust}
      onClose={props.onClose}
    />
  );
}
