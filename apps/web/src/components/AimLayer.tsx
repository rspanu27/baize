import { useRef } from "react";
import type { KeyboardEvent, PointerEvent } from "react";
import type { Scene } from "../doc/resolve";
import { aimAt, aimGuide, aimKeyStep, angleToDegrees, nudgeAngle } from "../shot/shotModel";
import { useEditor } from "../store/store";
import { RAIL_WIDTH_M } from "../view/constants";
import { clientToScreen } from "../view/pointer";
import { useViewTransform } from "../view/viewContext";
import "./AimLayer.css";

/** Drawing sizes, in metres (the svg is drawn in metres). */
const AIM_LINE_WIDTH_M = 0.004;
const HANDLE_RADIUS_M = 0.022;
/** A wider, invisible ring around the handle that is easier to grab. */
const HANDLE_GRAB_RADIUS_M = 0.07;
const MIN_HANDLE_DISTANCE_M = 0.08;

interface AimDrag {
  /** Starts aiming at the pointer; `aimNow` also points the shot there straight away. */
  begin: (e: PointerEvent<SVGElement>, aimNow: boolean) => void;
  move: (e: PointerEvent<SVGElement>) => void;
  end: (e: PointerEvent<SVGElement>) => void;
}

/**
 * Aiming by dragging: the shot points exactly at the pointer, with no rounding, and the handle
 * follows it. Used by the handle and by the cloth itself.
 */
function useAimDrag(scene: Scene): AimDrag {
  const view = useViewTransform();
  const setShot = useEditor((s) => s.setShot);
  const endGesture = useEditor((s) => s.endGesture);
  const setAimHandle = useEditor((s) => s.setAimHandle);
  const active = useRef<number | undefined>(undefined);

  const shot = scene.shot;
  const cue = shot ? scene.balls.find((b) => b.id === shot.cueBallId) : undefined;

  const aimFrom = (e: PointerEvent<SVGElement>): void => {
    const svg = e.currentTarget.ownerSVGElement;
    if (!svg || !cue) return;
    const screen = clientToScreen(svg, e.clientX, e.clientY);
    if (!screen) return;
    const p = view.toTable(screen);
    const angle = aimAt(cue, p);
    if (angle === undefined) return;
    const d = Math.sqrt((p.x - cue.x) * (p.x - cue.x) + (p.y - cue.y) * (p.y - cue.y));
    setAimHandle(Math.max(MIN_HANDLE_DISTANCE_M, d));
    setShot({ aimAngleRad: angle }, "live");
  };

  const finish = (): void => {
    if (active.current === undefined) return;
    active.current = undefined;
    endGesture();
  };

  return {
    begin: (e, aimNow) => {
      if (!cue) return;
      if (e.pointerType === "mouse" && e.button !== 0) return;
      // Stops the browser starting a text selection or a native drag, either of which would
      // swallow the pointer moves that follow.
      e.preventDefault();
      e.stopPropagation();
      e.currentTarget.setPointerCapture(e.pointerId);
      active.current = e.pointerId;
      if (aimNow) aimFrom(e);
    },
    move: (e) => {
      if (active.current !== e.pointerId) return;
      // The button was let go somewhere the release could not be seen.
      if (e.pointerType === "mouse" && e.buttons === 0) {
        finish();
        return;
      }
      aimFrom(e);
    },
    end: (e) => {
      if (active.current !== e.pointerId) return;
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
      finish();
    },
  };
}

/**
 * The cloth as an aiming surface: press or drag anywhere that is not a ball to point the shot
 * there. Drawn under the balls, so balls are still picked up first.
 */
export function AimSurface({ scene }: { scene: Scene }) {
  const view = useViewTransform();
  const drag = useAimDrag(scene);
  if (!scene.shot) return null;
  const box = view.viewBox(RAIL_WIDTH_M);
  return (
    <rect
      className="aim-surface"
      x={box.x}
      y={box.y}
      width={box.width}
      height={box.height}
      fill="transparent"
      onPointerDown={(e) => {
        drag.begin(e, true);
      }}
      onPointerMove={drag.move}
      onPointerUp={drag.end}
      onPointerCancel={drag.end}
      onLostPointerCapture={drag.end}
    />
  );
}

/**
 * The aim line, the ghost ball and the aim handle.
 *
 * Dragging the handle (or the cloth) points the shot exactly at the pointer. The handle stays
 * at the distance it was dragged to, so pulling it further from the cue ball gives finer
 * control: at one metre, a millimetre of movement is about 0.06 degrees. With the handle
 * focused, the left and right arrows turn the aim by 0.1 degrees (1 with Shift, 0.01 with Alt).
 */
export function AimLayer({ scene }: { scene: Scene }) {
  const view = useViewTransform();
  const setShot = useEditor((s) => s.setShot);
  const storedDistance = useEditor((s) => s.aimHandleM);
  // The distance is kept across table changes; on a smaller table it must still be on it.
  const handleDistance = Math.min(
    storedDistance,
    Math.sqrt(view.widthM * view.widthM + view.lengthM * view.lengthM),
  );
  const drag = useAimDrag(scene);

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

  const onKeyDown = (e: KeyboardEvent<SVGGElement>): void => {
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
      <g
        className="aim-handle"
        transform={`translate(${String(handleAt.x)} ${String(handleAt.y)})`}
        tabIndex={0}
        role="slider"
        aria-label="Aim direction. Drag, or use the left and right arrow keys."
        aria-valuemin={0}
        aria-valuemax={360}
        aria-valuenow={Math.round(angleToDegrees(shot.aimAngleRad) * 100) / 100}
        aria-valuetext={`${angleToDegrees(shot.aimAngleRad).toFixed(2)} degrees`}
        onPointerDown={(e) => {
          drag.begin(e, false);
          e.currentTarget.focus({ preventScroll: true });
        }}
        onPointerMove={drag.move}
        onPointerUp={drag.end}
        onPointerCancel={drag.end}
        onLostPointerCapture={drag.end}
        onKeyDown={onKeyDown}
      >
        <circle r={HANDLE_GRAB_RADIUS_M} fill="transparent" />
        <circle r={HANDLE_RADIUS_M} className="aim-handle-dot" strokeWidth={AIM_LINE_WIDTH_M} />
      </g>
    </g>
  );
}
