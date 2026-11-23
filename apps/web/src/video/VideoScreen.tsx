import type { BallSetSpec, TableSpec } from "@baize/tables";
import { useEffect, useState } from "react";
import { createAnalyser } from "../photo/analyser";
import { PhotoReviewDialog } from "../photo/PhotoReview";
import type { TableCalibration } from "../photo/PhotoReview";
import type { ReviewInitial } from "../photo/reviewModel";
import { openClipSession, openingMessage } from "./clipSession";
import type { CalibratedClip, ClipSession, ClipSessionDeps } from "./clipSession";
import { readFrame } from "./frame";
import { openClip } from "./media";
import { ClipDetails, VideoScreenView } from "./VideoScreenView";

/**
 * The video screen (Phase 7), loaded only when a clip is chosen so that the video code and
 * Mediabunny are downloaded then and not with the editor. Steps so far: open the clip, show
 * its first frame, and place the table on it with the photo review's corner handles. Later
 * steps (tracking, overlays, saving) continue from the `calibrated` state.
 *
 * The clip, its frames and pixels live in this component's state only: nothing goes into the
 * document, the link, the undo history or storage, and nothing is sent anywhere. Closing the
 * screen ends the decoder, the table finder's worker and the frame's object URL.
 */

export type VideoScreenState =
  | { phase: "opening" }
  | { phase: "error"; message: string }
  | { phase: "calibrating"; session: ClipSession; initial: ReviewInitial }
  | { phase: "calibrated"; session: ClipSession; calibrated: CalibratedClip };

/** One screen shows one clip: another clip is shown by a new screen, not new props. */
export interface VideoScreenProps {
  file: File;
  /** The document's table and balls when the clip was chosen. */
  table: TableSpec;
  ballSet: BallSetSpec;
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

export default function VideoScreen({ file, table, ballSet, onClose }: VideoScreenProps) {
  const [state, setState] = useState<VideoScreenState>({ phase: "opening" });

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
      session?.close();
    };
  }, [file, table, ballSet]);

  if (state.phase === "opening" || state.phase === "error") {
    return <VideoScreenView {...state} fileName={file.name} onClose={onClose} />;
  }
  const { session } = state;
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
          details: <ClipDetails fileName={session.fileName} info={session.clip.info} />,
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
  return (
    <VideoScreenView
      phase="calibrated"
      fileName={session.fileName}
      info={session.clip.info}
      frameUrl={session.frameUrl}
      frameSize={session.frameSize}
      corners={state.calibrated.corners}
      onAdjust={() => {
        setState({ phase: "calibrating", session, initial: initialFrom(state.calibrated) });
      }}
      onClose={onClose}
    />
  );
}
