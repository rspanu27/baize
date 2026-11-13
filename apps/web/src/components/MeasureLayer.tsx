import { useRef, useState } from "react";
import type { PointerEvent } from "react";
import type { Scene } from "../doc/resolve";
import type { Annotation } from "../doc/types";
import { distance } from "../geometry/aim";
import { useDoc, useEditor } from "../store/store";
import { formatDistance } from "../units/units";
import type { UnitSystem } from "../units/units";
import { useUnitSystem } from "../units/usePreference";
import { RAIL_WIDTH_M } from "../view/constants";
import { clientToScreen } from "../view/pointer";
import type { Point } from "../view/transform";
import { useViewTransform } from "../view/viewContext";
import "./MeasureLayer.css";

/** Drawing sizes, in metres. */
const LINE_WIDTH_M = 0.004;
const END_RADIUS_M = 0.008;
/** Label text is drawn at this font size and scaled, so that no tiny font size is needed. */
const LABEL_FONT = 14;
const LABEL_SCALE = 0.0034;
/** Shorter drags than this are taken as a slip, not a measurement. */
export const MIN_MEASURE_M = 0.005;

/** An end point dropped on a ball snaps to the centre of that ball. */
export function snapToBall(p: Point, balls: readonly (Point & { radiusM: number })[]): Point {
  let best: (Point & { radiusM: number }) | undefined;
  let bestD = Infinity;
  for (const b of balls) {
    const d = distance(p, b);
    if (d <= b.radiusM && d < bestD) {
      best = b;
      bestD = d;
    }
  }
  return best ? { x: best.x, y: best.y } : p;
}

interface MeasureLineProps {
  from: Point;
  to: Point;
  units: UnitSystem;
  draft?: boolean;
}

function MeasureLine({ from, to, units, draft }: MeasureLineProps) {
  const view = useViewTransform();
  const a = view.toScreen(from);
  const b = view.toScreen(to);
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const label = formatDistance(distance(from, to), units);
  return (
    <g className={draft ? "measure measure-draft" : "measure"} data-measure="">
      <line
        x1={a.x}
        y1={a.y}
        x2={b.x}
        y2={b.y}
        className="measure-line"
        strokeWidth={LINE_WIDTH_M}
      />
      <circle cx={a.x} cy={a.y} r={END_RADIUS_M} className="measure-end" />
      <circle cx={b.x} cy={b.y} r={END_RADIUS_M} className="measure-end" />
      <g
        transform={`translate(${String(mid.x)} ${String(mid.y - 0.025)}) scale(${String(LABEL_SCALE)})`}
      >
        <text className="measure-label" textAnchor="middle" fontSize={LABEL_FONT}>
          {label}
        </text>
      </g>
    </g>
  );
}

/**
 * Measuring lines. With the measure tool on, dragging on the table draws a new one; ends that
 * land on a ball snap to its centre.
 */
export function MeasureLayer({ scene, interactive }: { scene: Scene; interactive: boolean }) {
  const doc = useDoc();
  const view = useViewTransform();
  const tool = useEditor((s) => s.tool);
  const addMeasure = useEditor((s) => s.addMeasure);
  const [units] = useUnitSystem();
  const [draft, setDraft] = useState<{ from: Point; to: Point } | undefined>(undefined);
  const pointer = useRef<number | undefined>(undefined);

  const pointAt = (e: PointerEvent<SVGRectElement>): Point | undefined => {
    const svg = e.currentTarget.ownerSVGElement;
    const screen = svg ? clientToScreen(svg, e.clientX, e.clientY) : undefined;
    return screen ? snapToBall(view.toTable(screen), scene.balls) : undefined;
  };

  const finish = (commit: boolean): void => {
    if (pointer.current === undefined) return;
    pointer.current = undefined;
    if (commit && draft && distance(draft.from, draft.to) >= MIN_MEASURE_M) {
      addMeasure(draft.from, draft.to);
    }
    setDraft(undefined);
  };

  const box = view.viewBox(RAIL_WIDTH_M);
  const measuring = interactive && tool === "measure";
  return (
    <g className="measure-layer">
      <g pointerEvents="none">
        {doc.annotations.map((a: Annotation) => (
          <MeasureLine key={a.id} from={a.from} to={a.to} units={units} />
        ))}
        {draft ? <MeasureLine from={draft.from} to={draft.to} units={units} draft /> : null}
      </g>
      {measuring ? (
        <rect
          className="measure-surface"
          x={box.x}
          y={box.y}
          width={box.width}
          height={box.height}
          fill="transparent"
          onPointerDown={(e) => {
            if (e.pointerType === "mouse" && e.button !== 0) return;
            const p = pointAt(e);
            if (!p) return;
            e.preventDefault();
            e.stopPropagation();
            e.currentTarget.setPointerCapture(e.pointerId);
            pointer.current = e.pointerId;
            setDraft({ from: p, to: p });
          }}
          onPointerMove={(e) => {
            if (pointer.current !== e.pointerId) return;
            const p = pointAt(e);
            if (p) setDraft((d) => (d ? { from: d.from, to: p } : d));
          }}
          onPointerUp={(e) => {
            if (pointer.current === e.pointerId) finish(true);
          }}
          onPointerCancel={() => {
            finish(false);
          }}
          onLostPointerCapture={() => {
            finish(false);
          }}
        />
      ) : null}
    </g>
  );
}
