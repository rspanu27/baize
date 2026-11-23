import { useEffect, useRef, useState } from "react";
import type { Scene } from "../doc/resolve";
import type { DiagramTheme } from "../doc/types";
import { createAnalyser } from "../photo/analyser";
import { PhotoReviewDialog } from "../photo/PhotoReview";
import type { TableCalibration } from "../photo/PhotoReview";
import type { ReviewInitial } from "../photo/reviewModel";
import type { Tuning } from "../sim/tuning";
import { analyseClip, MESSAGE_CANCELLED } from "./analysis";
import type { AnalyseProgress } from "./analysis";
import { ClipResults } from "./ClipResults";
import { openClipSession, openingMessage } from "./clipSession";
import type { CalibratedClip, ClipSession, ClipSessionDeps } from "./clipSession";
import { readFrame } from "./frame";
import { openClip } from "./media";
import { MESSAGE_STOPPED, openShotInEditor } from "./resultsModel";
import type { ClipAnalysis } from "./types";
import { ClipDetails, VideoScreenView } from "./VideoScreenView";
import type { ScreenNotice } from "./VideoScreenView";

/**
 * The video screen (Phase 7), loaded only when a clip is chosen so that the video code and
 * Mediabunny are downloaded then and not with the editor. Steps: open the clip, place the table
 * on its first frame with the photo review's corner handles, track the balls and fit the shots,
 * then pick a shot and the overlays, preview, save the video, or open the shot in the editor.
 *
 * The clip, its frames, pixels and analysis live in this component's state only: nothing goes
 * into the document (except the one shot "Open in editor" puts there, as one undo step), the
 * link, storage, and nothing is sent anywhere. Closing the screen ends the decoder, the workers
 * and the frame's object URL.
 */

export type VideoScreenState =
  | { phase: "opening" }
  | { phase: "error"; message: string }
  | { phase: "calibrating"; session: ClipSession; initial: ReviewInitial }
  | {
      phase: "calibrated";
      session: ClipSession;
      calibrated: CalibratedClip;
      notice?: ScreenNotice | undefined;
    }
  | {
      phase: "tracking";
      session: ClipSession;
      calibrated: CalibratedClip;
      progress: AnalyseProgress;
      abort: AbortController;
    }
  | { phase: "analysed"; session: ClipSession; calibrated: CalibratedClip; analysis: ClipAnalysis };

/** One screen shows one clip: another clip is shown by a new screen, not new props. */
export interface VideoScreenProps {
  file: File;
  /** The document's scene (table, balls, cloth) when the clip was chosen. */
  scene: Scene;
  /** The physics numbers of the debug panel, so the fitted shots are what the editor draws. */
  tuning: Tuning;
  /** The document's theme, where the overlay colours start. */
  theme: DiagramTheme;
  onClose: () => void;
}

const BROWSER: ClipSessionDeps = {
  openClip,
  readFrame,
  createAnalyser,
  revokeUrl: (url) => {
    URL.revokeObjectURL(url);
  },
};

/** Where calibrating again starts: the corners and camera confirmed last time. */
function initialFrom(calibrated: CalibratedClip): ReviewInitial {
  return {
    corners: calibrated.corners,
    camera: calibrated.camera,
    cornersDetected: false,
    balls: [...calibrated.balls],
  };
}

/** The message for an analysis that failed. */
export function analysisMessage(e: unknown): string {
  return e instanceof Error && e.message ? e.message : "The clip could not be analysed.";
}

export default function VideoScreen({ file, scene, tuning, theme, onClose }: VideoScreenProps) {
  const [state, setState] = useState<VideoScreenState>({ phase: "opening" });
  const { table, ballSet } = scene;
  const tracking = useRef<AbortController | undefined>(undefined);

  useEffect(() => {
    const abort = new AbortController();
    let session: ClipSession | undefined;
    openClipSession(file, table, ballSet, BROWSER, abort.signal).then(
      (s) => {
        session = s;
        setState({ phase: "calibrating", session: s, initial: s.initial });
      },
      (e: unknown) => {
        if (!abort.signal.aborted) setState({ phase: "error", message: openingMessage(e) });
      },
    );
    return () => {
      abort.abort();
      tracking.current?.abort();
      session?.close();
    };
  }, [file, table, ballSet]);

  if (state.phase === "opening" || state.phase === "error") {
    return <VideoScreenView {...state} fileName={file.name} onClose={onClose} />;
  }
  const { session } = state;
  const details = <ClipDetails fileName={session.fileName} info={session.clip.info} />;
  if (state.phase === "calibrating") {
    return (
      <PhotoReviewDialog
        image={session.frameSize}
        analyser={session.analyser}
        photoUrl={session.frameUrl}
        initial={state.initial}
        table={table}
        ballSet={ballSet}
        calibration={{
          details,
          onConfirm: (c: TableCalibration) => {
            setState({
              phase: "calibrated",
              session,
              calibrated: {
                clip: session.clip,
                corners: c.corners,
                camera: c.camera,
                frameSize: session.frameSize,
                table,
                ballSet,
                balls: c.balls,
              },
            });
          },
        }}
        onClose={onClose}
      />
    );
  }

  const { calibrated } = state;
  const adjust = () => {
    setState({ phase: "calibrating", session, initial: initialFrom(calibrated) });
  };
  const track = () => {
    const abort = new AbortController();
    tracking.current = abort;
    const current = (s: VideoScreenState): s is Extract<VideoScreenState, { phase: "tracking" }> =>
      s.phase === "tracking" && s.abort === abort;
    setState({
      phase: "tracking",
      session,
      calibrated,
      progress: { stage: "tracking", share: 0 },
      abort,
    });
    analyseClip(calibrated, scene, tuning, {
      signal: abort.signal,
      onProgress: (progress) => {
        setState((s) => (current(s) ? { ...s, progress } : s));
      },
    }).then(
      (analysis) => {
        setState((s) => (current(s) ? { phase: "analysed", session, calibrated, analysis } : s));
      },
      (e: unknown) => {
        const stopped = abort.signal.aborted || analysisMessage(e) === MESSAGE_CANCELLED;
        const notice: ScreenNotice = stopped
          ? { kind: "stopped", text: MESSAGE_STOPPED }
          : { kind: "error", text: analysisMessage(e) };
        setState((s) => (current(s) ? { phase: "calibrated", session, calibrated, notice } : s));
      },
    );
  };

  if (state.phase === "analysed") {
    return (
      <ClipResults
        clip={session.clip}
        fileName={session.fileName}
        analysis={state.analysis}
        details={details}
        theme={theme}
        onOpen={(shot) => {
          openShotInEditor(shot);
          onClose();
        }}
        onAdjust={adjust}
        onClose={onClose}
      />
    );
  }

  const frame = {
    fileName: session.fileName,
    info: session.clip.info,
    frameUrl: session.frameUrl,
    frameSize: session.frameSize,
    corners: calibrated.corners,
    onClose,
  };
  if (state.phase === "tracking") {
    return (
      <VideoScreenView
        phase="tracking"
        {...frame}
        progress={state.progress}
        onStop={() => {
          state.abort.abort();
          setState({
            phase: "calibrated",
            session,
            calibrated,
            notice: { kind: "stopped", text: MESSAGE_STOPPED },
          });
        }}
      />
    );
  }
  return (
    <VideoScreenView
      phase="calibrated"
      {...frame}
      notice={state.notice}
      onAdjust={adjust}
      onTrack={track}
    />
  );
}
