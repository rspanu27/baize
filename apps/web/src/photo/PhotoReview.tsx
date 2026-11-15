import type { BallKind, BallSetSpec, TableSpec } from "@baize/tables";
import { imageToTableAtHeight } from "@baize/vision";
import type { Camera, ImagePoint, ImportProblem, PhotoImage, TableCorners } from "@baize/vision";
import { ballSizeOf } from "@baize/tables";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent } from "react";
import { useEditor } from "../store/store";
import type { PhotoAnalyser } from "./analyser";
import { toPhotoPoint } from "./overlay";
import {
  CORNER_LABELS,
  NOTE_EDITS_LOST,
  PAD_FRACTION,
  addReviewBall,
  arrowStep,
  ballMarkers,
  confirmedLayout,
  defaultCorners,
  kindChoices,
  moveCorner,
  nudgeCorner,
  paddedArea,
  removeReviewBall,
  reviewBalls,
  reviewStatus,
  setBallKind,
  summaryText,
  turnCorners,
} from "./reviewModel";
import type { BallMarker, ReviewBall } from "./reviewModel";
import "./PhotoReview.css";

export interface KindChoice {
  kind: BallKind;
  name: string;
}

export interface PhotoReviewViewProps {
  photoUrl: string;
  widthPx: number;
  heightPx: number;
  corners: TableCorners;
  markers: readonly BallMarker[];
  summary: string;
  messages: readonly string[];
  /** The importer could place the camera, so balls can be shown and edited. */
  hasCamera: boolean;
  busy: boolean;
  /** How many times the balls have been found again (for tests that wait for it). */
  runs: number;
  canConfirm: boolean;
  kinds: readonly KindChoice[];
  selectedId: number | undefined;
  /** The kind picked for "Add a ball", and whether the next tap on the photo places it. */
  addKind: BallKind | undefined;
  adding: boolean;
  onCornerMove: (index: number, to: ImagePoint) => void;
  onCornerEnd: () => void;
  onCornerKey: (index: number, du: number, dv: number) => void;
  onTurn: () => void;
  onFindAgain: () => void;
  onConfirm: () => void;
  onCancel: () => void;
  onSelect: (id: number | undefined) => void;
  onChangeKind: (id: number, kind: BallKind) => void;
  onRemove: (id: number) => void;
  onPickAddKind: (kind: BallKind) => void;
  onToggleAdding: () => void;
  onPlace: (at: ImagePoint) => void;
}

/** CSS pixels the overlay is drawn at, for sizing handles by what the finger sees. */
function useUnitsPerPx(areaWidth: number): [React.RefObject<SVGSVGElement | null>, number] {
  const ref = useRef<SVGSVGElement | null>(null);
  const [upp, setUpp] = useState(areaWidth / 600);
  useEffect(() => {
    const svg = ref.current;
    if (!svg || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      const w = svg.getBoundingClientRect().width;
      if (w > 0) setUpp(areaWidth / w);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(svg);
    return () => {
      observer.disconnect();
    };
  }, [areaWidth]);
  return [ref, upp];
}

const FOCUSABLE = 'button:not([disabled]), select:not([disabled]), [tabindex="0"]';

/** A ball outline in the ball's colour, with a light and a dark edge so that it shows on any photo. */
function BallRing({ m, upp, selected }: { m: BallMarker; upp: number; selected: boolean }) {
  const r = Math.max(m.radiusPx, 5 * upp);
  const dash = m.uncertain ? `${String(4 * upp)} ${String(3 * upp)}` : undefined;
  return (
    <>
      <circle r={r} fill="none" stroke="#000" strokeOpacity={0.75} strokeWidth={6 * upp} />
      <circle r={r} fill="none" stroke="#fff" strokeWidth={4 * upp} strokeDasharray={dash} />
      <circle r={r} fill="none" stroke={m.colour} strokeWidth={2 * upp} strokeDasharray={dash} />
      {selected ? (
        <circle r={r + 5 * upp} fill="none" stroke="#7fd1ff" strokeWidth={3 * upp} />
      ) : null}
      {m.uncertain ? (
        <text
          y={-r - 5 * upp}
          textAnchor="middle"
          fontSize={16 * upp}
          fontWeight="bold"
          fill="#fff"
          stroke="#000"
          strokeWidth={3 * upp}
          paintOrder="stroke"
        >
          ?
        </text>
      ) : null}
    </>
  );
}

/** The review screen's markup; `PhotoReviewDialog` connects it. */
export function PhotoReviewView(props: PhotoReviewViewProps) {
  const { widthPx, heightPx, corners, markers } = props;
  const titleId = useId();
  const helpId = useId();
  const kindId = useId();
  const addId = useId();
  const area = paddedArea(widthPx, heightPx);
  const [svgRef, upp] = useUnitsPerPx(area.w);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const drag = useRef<{ index: number; du: number; dv: number } | null>(null);

  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  const kindOf = (value: string): BallKind | undefined =>
    props.kinds.find((k) => k.kind === value)?.kind;
  const selected = markers.find((m) => m.id === props.selectedId);
  const selectedKind = selected?.kind;
  const ratio = area.w / area.h;
  const share = 100 / (1 + 2 * PAD_FRACTION);
  const offset = (PAD_FRACTION / (1 + 2 * PAD_FRACTION)) * 100;

  const onDialogKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      props.onCancel();
      return;
    }
    if (
      (e.key === "Delete" || e.key === "Backspace") &&
      props.selectedId !== undefined &&
      !(e.target instanceof HTMLSelectElement)
    ) {
      e.preventDefault();
      props.onRemove(props.selectedId);
      return;
    }
    if (e.key === "Tab" && dialogRef.current) {
      // Keep the focus inside the dialog.
      const items = [...dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
      const first = items[0];
      const last = items[items.length - 1];
      if (!first || !last) return;
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === dialogRef.current)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };

  const downOnHandle = (e: PointerEvent<SVGGElement>, index: number) => {
    const svg = svgRef.current;
    const corner = corners[index];
    if (!svg || !corner) return;
    const p = toPhotoPoint(svg, e.clientX, e.clientY);
    if (!p) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    e.currentTarget.focus();
    drag.current = { index, du: corner.u - p.u, dv: corner.v - p.v };
  };
  const moveOnHandle = (e: PointerEvent<SVGGElement>) => {
    const d = drag.current;
    const svg = svgRef.current;
    if (!d || !svg) return;
    const p = toPhotoPoint(svg, e.clientX, e.clientY);
    if (p) props.onCornerMove(d.index, { u: p.u + d.du, v: p.v + d.dv });
  };
  const upOnHandle = (e: PointerEvent<SVGGElement>) => {
    if (!drag.current) return;
    drag.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    props.onCornerEnd();
  };
  const keyOnHandle = (e: KeyboardEvent<SVGGElement>, index: number) => {
    const step = arrowStep(e.key, e.shiftKey);
    if (!step) return;
    e.preventDefault();
    e.stopPropagation();
    props.onCornerKey(index, step.du, step.dv);
  };

  const points = corners.map((c) => `${String(c.u)},${String(c.v)}`).join(" ");
  const photoOnly = props.hasCamera;

  return (
    <div className="photo-backdrop">
      <div
        ref={dialogRef}
        className="photo-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-runs={props.runs}
        tabIndex={-1}
        onKeyDown={onDialogKey}
      >
        <header className="photo-header">
          <h2 id={titleId}>Check the photo</h2>
          <p role="status" className="photo-summary">
            {props.busy ? "Finding the balls…" : props.summary}
          </p>
        </header>
        <div className="photo-frame">
          <div
            className="photo-stage"
            style={{
              aspectRatio: String(ratio),
              width: `min(100cqw, calc(100cqh * ${String(ratio)}))`,
            }}
            data-busy={props.busy ? "true" : undefined}
          >
            <img
              className="photo-img"
              src={props.photoUrl}
              alt="Your photo of the table"
              draggable={false}
              style={{
                left: `${String(offset)}%`,
                top: `${String(offset)}%`,
                width: `${String(share)}%`,
                height: `${String(share)}%`,
              }}
            />
            <svg
              ref={svgRef}
              className="photo-overlay"
              viewBox={`${String(area.x)} ${String(area.y)} ${String(area.w)} ${String(area.h)}`}
              role="group"
              aria-label="Table corners and balls on the photo"
              data-adding={props.adding ? "true" : undefined}
            >
              <rect
                className="photo-hit"
                x={area.x}
                y={area.y}
                width={area.w}
                height={area.h}
                fill="transparent"
                onPointerDown={(e) => {
                  const svg = svgRef.current;
                  if (!svg) return;
                  if (props.adding) {
                    const p = toPhotoPoint(svg, e.clientX, e.clientY);
                    if (p) props.onPlace(p);
                  } else {
                    props.onSelect(undefined);
                  }
                }}
              />
              <polygon
                points={points}
                fill="rgba(255,255,255,0.08)"
                stroke="#000"
                strokeOpacity={0.6}
                strokeWidth={5 * upp}
                pointerEvents="none"
              />
              <polygon
                points={points}
                fill="none"
                stroke="#ffcf33"
                strokeWidth={2.5 * upp}
                pointerEvents="none"
              />
              <line
                x1={corners[0].u}
                y1={corners[0].v}
                x2={corners[1].u}
                y2={corners[1].v}
                stroke="#ff8a3d"
                strokeWidth={5 * upp}
                strokeLinecap="round"
                pointerEvents="none"
              />
              {markers.map((m) => (
                <g
                  key={m.id}
                  className="photo-ball"
                  transform={`translate(${String(m.u)} ${String(m.v)})`}
                  role="button"
                  tabIndex={0}
                  aria-pressed={m.id === props.selectedId}
                  aria-label={`${m.name}${m.uncertain ? ", uncertain" : ""}`}
                  data-uncertain={m.uncertain ? "true" : undefined}
                  onPointerDown={(e) => {
                    e.stopPropagation();
                    props.onSelect(m.id);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      props.onSelect(m.id);
                    }
                  }}
                >
                  <BallRing m={m} upp={upp} selected={m.id === props.selectedId} />
                  <circle r={Math.max(m.radiusPx, 16 * upp)} fill="transparent" />
                </g>
              ))}
              {corners.map((c, i) => (
                <g
                  key={CORNER_LABELS[i]}
                  className="photo-handle"
                  transform={`translate(${String(c.u)} ${String(c.v)})`}
                  role="button"
                  tabIndex={0}
                  aria-label={CORNER_LABELS[i]}
                  aria-describedby={helpId}
                  onPointerDown={(e) => {
                    downOnHandle(e, i);
                  }}
                  onPointerMove={moveOnHandle}
                  onPointerUp={upOnHandle}
                  onPointerCancel={upOnHandle}
                  onKeyDown={(e) => {
                    keyOnHandle(e, i);
                  }}
                >
                  <circle r={26 * upp} fill="transparent" />
                  <circle
                    r={11 * upp}
                    fill="rgba(255,207,51,0.35)"
                    stroke="#000"
                    strokeWidth={5 * upp}
                  />
                  <circle r={11 * upp} fill="none" stroke="#ffcf33" strokeWidth={2.5 * upp} />
                  <path
                    d={`M ${String(-6 * upp)} 0 H ${String(6 * upp)} M 0 ${String(-6 * upp)} V ${String(6 * upp)}`}
                    stroke="#fff"
                    strokeWidth={1.5 * upp}
                  />
                  <text
                    x={16 * upp}
                    y={-14 * upp}
                    fontSize={13 * upp}
                    fontWeight="bold"
                    fill="#fff"
                    stroke="#000"
                    strokeWidth={3.5 * upp}
                    paintOrder="stroke"
                    pointerEvents="none"
                  >
                    {CORNER_LABELS[i]}
                  </text>
                </g>
              ))}
            </svg>
          </div>
        </div>
        <div className="photo-controls">
          {props.messages.map((m) => (
            <p key={m} className="photo-message" role="status">
              {m}
            </p>
          ))}
          <p id={helpId} className="photo-help">
            Drag each handle onto its corner of the playing area, or select it and use the arrow
            keys (Shift for bigger steps). The orange edge is the baulk end. {NOTE_EDITS_LOST}
          </p>
          <div className="photo-row">
            <button type="button" onClick={props.onTurn} disabled={props.busy}>
              Turn the table round
            </button>
            <button type="button" onClick={props.onFindAgain} disabled={props.busy}>
              Find the table again
            </button>
          </div>

          {photoOnly ? (
            <div className="photo-edit">
              {selected ? (
                <div role="group" aria-label="Selected ball" className="photo-panel">
                  <label htmlFor={kindId}>Ball kind</label>
                  <select
                    id={kindId}
                    value={selectedKind}
                    onChange={(e) => {
                      const kind = kindOf(e.target.value);
                      if (kind) props.onChangeKind(selected.id, kind);
                    }}
                  >
                    {props.kinds.map((k) => (
                      <option key={k.kind} value={k.kind}>
                        {k.name}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => {
                      props.onRemove(selected.id);
                    }}
                  >
                    Remove
                  </button>
                </div>
              ) : (
                <p className="photo-help">Tap a ball to change what it is or to remove it.</p>
              )}
              <div className="photo-panel" role="group" aria-label="Add a ball">
                <label htmlFor={addId}>Ball to add</label>
                <select
                  id={addId}
                  value={props.addKind}
                  onChange={(e) => {
                    const kind = kindOf(e.target.value);
                    if (kind) props.onPickAddKind(kind);
                  }}
                >
                  {props.kinds.map((k) => (
                    <option key={k.kind} value={k.kind}>
                      {k.name}
                    </option>
                  ))}
                </select>
                <button type="button" aria-pressed={props.adding} onClick={props.onToggleAdding}>
                  Add a ball
                </button>
                {props.adding ? (
                  <p className="photo-help photo-add-hint">Now tap the photo where the ball is.</p>
                ) : null}
              </div>
            </div>
          ) : null}

          <div className="photo-row photo-actions">
            <button
              type="button"
              className="photo-primary"
              onClick={props.onConfirm}
              disabled={!props.canConfirm || props.busy}
            >
              Use these balls
            </button>
            <button type="button" onClick={props.onCancel}>
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export interface PhotoReviewDialogProps {
  /** The size of the photo; its pixels are with the analyser. */
  image: Pick<PhotoImage, "widthPx" | "heightPx">;
  /** Runs the import on this photo again (in a worker); owned and ended by the caller. */
  analyser: PhotoAnalyser;
  /** Object URL of the chosen file, for showing it. Revoked by the owner on close. */
  photoUrl: string;
  initial: {
    problem?: ImportProblem;
    corners?: TableCorners;
    camera?: Camera;
    cornersDetected: boolean;
    balls: ReviewBall[];
  };
  table: TableSpec;
  ballSet: BallSetSpec;
  onClose: () => void;
}

/** Delay after the last arrow-key press before the balls are found again. */
const KEY_SETTLE_MS = 350;

/** The review screen connected to its photo, the importer and the editor's store. */
export function PhotoReviewDialog(props: PhotoReviewDialogProps) {
  const { image, table, ballSet, initial, analyser } = props;
  const w = image.widthPx;
  const h = image.heightPx;
  const [corners, setCorners] = useState<TableCorners>(initial.corners ?? defaultCorners(w, h));
  const cornersRef = useRef(corners);
  const [analysis, setAnalysis] = useState<{
    problem: ImportProblem | undefined;
    camera: Camera | undefined;
    cornersDetected: boolean;
  }>({
    problem: initial.problem,
    camera: initial.camera,
    cornersDetected: initial.cornersDetected,
  });
  const [balls, setBalls] = useState<ReviewBall[]>(initial.balls);
  const [selectedId, setSelectedId] = useState<number | undefined>(undefined);
  const kinds = kindChoices(ballSet);
  const [addKind, setAddKind] = useState<BallKind | undefined>(kinds[0]?.kind);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  // The last run failed: the corners on screen no longer match the balls shown.
  const [failed, setFailed] = useState(false);
  const [runs, setRuns] = useState(0);
  const runId = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(
    () => () => {
      runId.current += 1;
      clearTimeout(timer.current);
    },
    [],
  );

  const setBoth = (next: TableCorners) => {
    cornersRef.current = next;
    setCorners(next);
  };

  /** Finds the balls again, for the given corners or (undefined) with the table found afresh. */
  const rerun = useCallback(
    async (given: TableCorners | undefined) => {
      const id = ++runId.current;
      setBusy(true);
      let result;
      try {
        result = await analyser.run(table, ballSet, given ? { corners: given } : {});
      } catch {
        // The review was closed (nothing to do), or the worker failed: say so, and do not
        // let balls found for other corners be used.
        if (id === runId.current) {
          setFailed(true);
          setBusy(false);
        }
        return;
      }
      // A later run has started (or the review closed): this result is out of date.
      if (id !== runId.current) return;
      const next = result.corners ?? given ?? defaultCorners(w, h);
      cornersRef.current = next;
      setCorners(next);
      setAnalysis({
        problem: result.problem,
        camera: result.diagnostics.camera,
        cornersDetected: result.diagnostics.cornersDetected,
      });
      setBalls(reviewBalls(result.layout));
      setFailed(false);
      setSelectedId(undefined);
      setAdding(false);
      setBusy(false);
      setRuns((n) => n + 1);
    },
    [analyser, table, ballSet, w, h],
  );

  const markers = ballMarkers(analysis.camera, balls, ballSet);
  const status = reviewStatus({
    failed,
    problem: analysis.problem,
    hasCamera: analysis.camera !== undefined,
    cornersDetected: analysis.cornersDetected,
  });

  return (
    <PhotoReviewView
      photoUrl={props.photoUrl}
      widthPx={w}
      heightPx={h}
      corners={corners}
      markers={markers}
      summary={summaryText(balls)}
      messages={status.messages}
      hasCamera={analysis.camera !== undefined && analysis.problem === undefined}
      busy={busy}
      runs={runs}
      canConfirm={status.canConfirm}
      kinds={kinds}
      selectedId={selectedId}
      addKind={addKind}
      adding={adding}
      onCornerMove={(index, to) => {
        setBoth(moveCorner(cornersRef.current, index, to, w, h));
      }}
      onCornerEnd={() => {
        void rerun(cornersRef.current);
      }}
      onCornerKey={(index, du, dv) => {
        setBoth(nudgeCorner(cornersRef.current, index, du, dv, w, h));
        clearTimeout(timer.current);
        timer.current = setTimeout(() => {
          void rerun(cornersRef.current);
        }, KEY_SETTLE_MS);
      }}
      onTurn={() => {
        clearTimeout(timer.current);
        const turned = turnCorners(cornersRef.current);
        setBoth(turned);
        void rerun(turned);
      }}
      onFindAgain={() => {
        clearTimeout(timer.current);
        void rerun(undefined);
      }}
      onConfirm={() => {
        const layout = confirmedLayout(balls, table, ballSet);
        useEditor.getState().loadLayout(layout, { source: "photo", mode: "replace" });
        props.onClose();
      }}
      onCancel={props.onClose}
      onSelect={(id) => {
        setSelectedId(id);
        if (id !== undefined) setAdding(false);
      }}
      onChangeKind={(id, kind) => {
        setBalls((all) => setBallKind(all, id, kind));
      }}
      onRemove={(id) => {
        setBalls((all) => removeReviewBall(all, id));
        setSelectedId(undefined);
      }}
      onPickAddKind={setAddKind}
      onToggleAdding={() => {
        setAdding((a) => !a);
        setSelectedId(undefined);
      }}
      onPlace={(at) => {
        const camera = analysis.camera;
        if (!camera || addKind === undefined) return;
        const r = ballSizeOf(ballSet, addKind).diameterM / 2;
        const onTable = imageToTableAtHeight(camera, at, r);
        if (!onTable) return;
        const added = addReviewBall(balls, addKind, onTable);
        setBalls(added.balls);
        setSelectedId(added.id);
        setAdding(false);
      }}
    />
  );
}
