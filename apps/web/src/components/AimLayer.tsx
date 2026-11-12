import { useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent } from "react";
import type { Scene } from "../doc/resolve";
import { aimAt, aimGuide, aimKeyStep, nudgeAngle } from "../shot/shotModel";
import { useEditor } from "../store/store";
import { clientToScreen } from "../view/pointer";
import { useViewTransform } from "../view/viewContext";
import "./AimLayer.css";

/** Drawing sizes, in metres (the svg is drawn in metres). */
const AIM_LINE_WIDTH_M = 0.004;
const HANDLE_RADIUS_M = 0.022;
/** Where the handle sits along the aim line before it has been dragged. */
const DEFAULT_HANDLE_DISTANCE_M = 0.35;
const MIN_HANDLE_DISTANCE_M = 0.08;

/**
 * The aim line, the ghost ball and the aim handle.
 *
 * Dragging the handle points the shot exactly at the pointer, with no rounding. The handle
 * stays at the distance it was dragged to, so pulling it further from the cue ball gives
 * finer control: at one metre, a millimetre of movement is about 0.06 degrees. With the
 * handle focused, the left and right arrows turn the aim by 0.1 degrees (1 with Shift, 0.01
 * with Alt).
 */
export function AimLayer({ scene }: { scene: Scene }) {
  const view = useViewTransform();
  const setShot = useEditor((s) => s.setShot);
  const endGesture = useEditor((s) => s.endGesture);
  const [handleDistance, setHandleDistance] = useState(DEFAULT_HANDLE_DISTANCE_M);
  const dragging = useRef(false);

  const guide = aimGuide(scene);
  const shot = scene.shot;
  if (!guide || !shot) return null;

  const cue = guide.from;
  const cueBall = scene.balls.find((b) => b.id === shot.cueBallId);
  const handle = {
    x: cue.x + handleDistance * Math.cos(shot.aimAngleRad),
    y: cue.y + handleDistance * Math.sin(shot.aimAngleRad),
  };
  const from = view.toScreen(cue);
  const to = view.toScreen(guide.to);
  const handleAt = view.toScreen(handle);
  const ghostAt = guide.ghost ? view.toScreen(guide.ghost) : undefined;

  const pointerOnTable = (e: PointerEvent<SVGCircleElement>) => {
    const svg = e.currentTarget.ownerSVGElement;
    if (!svg) return undefined;
    const screen = clientToScreen(svg, e.clientX, e.clientY);
    return screen ? view.toTable(screen) : undefined;
  };

  const onPointerDown = (e: PointerEvent<SVGCircleElement>): void => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    dragging.current = true;
  };
  const onPointerMove = (e: PointerEvent<SVGCircleElement>): void => {
    if (!dragging.current) return;
    const p = pointerOnTable(e);
    if (!p) return;
    const angle = aimAt(cue, p);
    if (angle === undefined) return;
    const d = Math.sqrt((p.x - cue.x) * (p.x - cue.x) + (p.y - cue.y) * (p.y - cue.y));
    setHandleDistance(Math.max(MIN_HANDLE_DISTANCE_M, d));
    setShot({ aimAngleRad: angle }, "live");
  };
  const onPointerEnd = (e: PointerEvent<SVGCircleElement>): void => {
    if (!dragging.current) return;
    dragging.current = false;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    endGesture();
  };
  const onKeyDown = (e: KeyboardEvent<SVGCircleElement>): void => {
    const step = aimKeyStep(e.key, { shift: e.shiftKey, alt: e.altKey });
    if (step === undefined) return;
    e.preventDefault();
    setShot({ aimAngleRad: nudgeAngle(shot.aimAngleRad, step) });
  };

  return (
    <g className="aim-layer">
      <line
        x1={from.x}
        y1={from.y}
        x2={to.x}
        y2={to.y}
        className="aim-line"
        strokeWidth={AIM_LINE_WIDTH_M}
        strokeDasharray="0.02 0.014"
        pointerEvents="none"
      />
      {ghostAt && cueBall ? (
        <circle
          cx={ghostAt.x}
          cy={ghostAt.y}
          r={cueBall.radiusM}
          className="aim-ghost"
          strokeWidth={AIM_LINE_WIDTH_M}
          pointerEvents="none"
        >
          <title>ghost ball: where the cue ball will be at contact</title>
        </circle>
      ) : null}
      <circle
        cx={handleAt.x}
        cy={handleAt.y}
        r={HANDLE_RADIUS_M}
        className="aim-handle"
        strokeWidth={AIM_LINE_WIDTH_M}
        tabIndex={0}
        role="slider"
        aria-label="Aim direction. Drag, or use the left and right arrow keys."
        aria-valuemin={0}
        aria-valuemax={360}
        aria-valuenow={Math.round(((shot.aimAngleRad * 180) / Math.PI) * 100) / 100}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        onKeyDown={onKeyDown}
      />
    </g>
  );
}
