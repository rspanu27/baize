import type { TableCorners } from "@baize/vision";
import { useEffect, useId, useRef } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import "../photo/PhotoReview.css";
import { codecText, durationText, sizeText } from "./clipSession";
import type { ClipInfo } from "./media";
import "./VideoScreen.css";

/**
 * The video screen's markup (no clip, no decoder: those are in the lazily loaded
 * `VideoScreen`). It shares the photo review's dialog styles, so both screens look and lay out
 * alike on a computer and on a phone.
 */

export const CLIP_STAYS = "The clip stays on this device.";
export const CALIBRATED_READY = "The table is placed. Next, track the balls through the clip.";
export const TRACKING_HELP =
  "Tracking runs on this device and can take as long as the clip, or longer.";

/** What to say on the calibrated screen when tracking ended without results. */
export interface ScreenNotice {
  kind: "error" | "stopped";
  text: string;
}

/** Where tracking has got to: "tracking" then "fitting", with the share done (0 to 1). */
export interface TrackingProgress {
  stage: "tracking" | "fitting";
  share: number;
}

/** What the clip is: file name, size, length and codec. */
export function ClipDetails({ fileName, info }: { fileName: string; info: ClipInfo }) {
  return (
    <dl className="clip-details" aria-label="The clip">
      <div>
        <dt>File</dt>
        <dd>{fileName}</dd>
      </div>
      <div>
        <dt>Size</dt>
        <dd>{sizeText(info)}</dd>
      </div>
      <div>
        <dt>Length</dt>
        <dd>{durationText(info.durationS)}</dd>
      </div>
      <div>
        <dt>Codec</dt>
        <dd>{codecText(info.codec)}</dd>
      </div>
    </dl>
  );
}

export interface ScreenShellProps {
  phase: string;
  /** Under the title: the clip's details or its file name. */
  details: ReactNode;
  /** The picture area. */
  frame: ReactNode;
  /** The controls beside (or under) the picture. */
  children: ReactNode;
  /** Buttons kept in view at the bottom of the controls. */
  actions: ReactNode;
  onClose: () => void;
}

/** The video screen's dialog: title, picture, controls and actions, laid out like the photo review. */
export function ScreenShell(props: ScreenShellProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    dialogRef.current?.focus();
  }, [props.phase]);
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      props.onClose();
    }
  };
  return (
    <div className="photo-backdrop">
      <div
        ref={dialogRef}
        className="photo-dialog clip-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-phase={props.phase}
        tabIndex={-1}
        onKeyDown={onKey}
      >
        <header className="photo-header">
          <h2 id={titleId}>Overlay a clip</h2>
          {props.details}
        </header>
        {props.frame}
        <div className="photo-controls">
          {props.children}
          <div className="photo-row photo-actions">{props.actions}</div>
        </div>
      </div>
    </div>
  );
}

interface FrameProps {
  frameUrl: string;
  frameSize: { widthPx: number; heightPx: number };
  corners: TableCorners;
}

/** The first frame with the table's outline on it. */
function OutlinedFrame(props: FrameProps) {
  const { widthPx: w, heightPx: h } = props.frameSize;
  const points = props.corners.map((c) => `${String(c.u)},${String(c.v)}`).join(" ");
  return (
    <div className="photo-frame">
      <div
        className="photo-stage clip-stage"
        style={{
          aspectRatio: String(w / h),
          width: `min(100cqw, calc(100cqh * ${String(w / h)}))`,
        }}
      >
        <img
          className="photo-img clip-img"
          src={props.frameUrl}
          alt="The first frame of your clip, with the table outlined"
          draggable={false}
        />
        <svg
          className="photo-overlay"
          viewBox={`0 0 ${String(w)} ${String(h)}`}
          aria-hidden="true"
          preserveAspectRatio="none"
        >
          <polygon
            points={points}
            fill="none"
            stroke="#000"
            strokeOpacity={0.6}
            strokeWidth={5}
            vectorEffect="non-scaling-stroke"
          />
          <polygon
            points={points}
            fill="rgba(255,255,255,0.08)"
            stroke="#ffcf33"
            strokeWidth={2.5}
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      </div>
    </div>
  );
}

function clampShare(share: number): number {
  return Number.isFinite(share) ? Math.min(1, Math.max(0, share)) : 0;
}

/** "Tracking the balls: 42 %" or "Fitting the shots: 80 %". */
export function trackingText(p: TrackingProgress): string {
  const what = p.stage === "tracking" ? "Tracking the balls" : "Fitting the shots";
  return `${what}: ${String(Math.round(clampShare(p.share) * 100))} %`;
}

export type VideoScreenViewProps = { fileName: string; onClose: () => void } & (
  | { phase: "opening" }
  | { phase: "error"; message: string }
  | ({
      phase: "calibrated";
      info: ClipInfo;
      notice?: ScreenNotice | undefined;
      onAdjust: () => void;
      onTrack: () => void;
    } & FrameProps)
  | ({
      phase: "tracking";
      info: ClipInfo;
      progress: TrackingProgress;
      onStop: () => void;
    } & FrameProps)
);

/**
 * The screen while a clip opens, when it cannot be opened, once its table is placed, and while
 * its balls are tracked.
 */
export function VideoScreenView(props: VideoScreenViewProps) {
  let status: ReactNode;
  let frame: ReactNode = <div className="photo-frame clip-empty" />;
  let actions: ReactNode = null;
  let details: ReactNode = <p className="clip-file">{props.fileName}</p>;
  if (props.phase === "opening") {
    status = <p role="status">Opening the clip…</p>;
  } else if (props.phase === "error") {
    status = (
      <p role="alert" className="photo-error clip-error">
        {props.message}
      </p>
    );
  } else if (props.phase === "calibrated") {
    details = <ClipDetails fileName={props.fileName} info={props.info} />;
    frame = <OutlinedFrame {...props} />;
    status = (
      <>
        {props.notice?.kind === "error" ? (
          <p role="alert" className="photo-error clip-error">
            {props.notice.text}
          </p>
        ) : null}
        <p role="status">
          {props.notice?.kind === "stopped" ? props.notice.text : CALIBRATED_READY}
        </p>
      </>
    );
    actions = (
      <>
        <button type="button" className="photo-primary" onClick={props.onTrack}>
          {props.notice ? "Track the balls again" : "Track the balls"}
        </button>
        <button type="button" onClick={props.onAdjust}>
          Adjust the corners
        </button>
      </>
    );
  } else {
    details = <ClipDetails fileName={props.fileName} info={props.info} />;
    frame = <OutlinedFrame {...props} />;
    const text = trackingText(props.progress);
    status = (
      <div className="clip-progress">
        <p role="status">{text}</p>
        <progress max={1} value={clampShare(props.progress.share)} aria-label="Tracking progress" />
        <p className="photo-help">{TRACKING_HELP}</p>
      </div>
    );
    actions = (
      <button type="button" onClick={props.onStop}>
        Stop
      </button>
    );
  }
  return (
    <ScreenShell
      phase={props.phase}
      details={details}
      frame={frame}
      actions={
        <>
          {actions}
          <button type="button" onClick={props.onClose}>
            Close
          </button>
        </>
      }
      onClose={props.onClose}
    >
      {status}
      <p className="photo-help">{CLIP_STAYS}</p>
    </ScreenShell>
  );
}
