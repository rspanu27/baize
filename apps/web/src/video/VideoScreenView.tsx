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

export const CALIBRATED_NEXT = "Calibrated: next, tracking (coming soon).";
export const CLIP_STAYS = "The clip stays on this device.";

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

export type VideoScreenViewProps = { fileName: string; onClose: () => void } & (
  | { phase: "opening" }
  | { phase: "error"; message: string }
  | {
      phase: "calibrated";
      info: ClipInfo;
      frameUrl: string;
      frameSize: { widthPx: number; heightPx: number };
      corners: TableCorners;
      onAdjust: () => void;
    }
);

/** The screen while a clip opens, when it cannot be opened, and once its table is placed. */
export function VideoScreenView(props: VideoScreenViewProps) {
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

  let status: ReactNode;
  let frame: ReactNode = null;
  if (props.phase === "opening") {
    status = <p role="status">Opening the clip…</p>;
  } else if (props.phase === "error") {
    status = (
      <p role="alert" className="photo-error clip-error">
        {props.message}
      </p>
    );
  } else {
    status = <p role="status">{CALIBRATED_NEXT}</p>;
    const { widthPx: w, heightPx: h } = props.frameSize;
    const points = props.corners.map((c) => `${String(c.u)},${String(c.v)}`).join(" ");
    frame = (
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
          {props.phase === "calibrated" ? (
            <ClipDetails fileName={props.fileName} info={props.info} />
          ) : (
            <p className="clip-file">{props.fileName}</p>
          )}
        </header>
        {frame ?? <div className="photo-frame clip-empty" />}
        <div className="photo-controls">
          {status}
          <p className="photo-help">{CLIP_STAYS}</p>
          <div className="photo-row photo-actions">
            {props.phase === "calibrated" ? (
              <button type="button" onClick={props.onAdjust}>
                Adjust the corners
              </button>
            ) : null}
            <button type="button" onClick={props.onClose}>
              Close
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
