import { spotsFor } from "@baize/tables";
import { useEffect, useMemo, useRef } from "react";
import type { KeyboardEvent, PointerEvent } from "react";
import type { Scene, SceneBall } from "../doc/resolve";
import { useEditor } from "../store/store";
import { ballName, isLowConfidence } from "../view/ballLook";
import { arrowTarget, dragTarget, grabOffset, isRemoveKey } from "../view/drag";
import { clientToScreen } from "../view/pointer";
import { snapDistanceFor, snapPoint } from "../view/snap";
import type { Point, ViewTransform } from "../view/transform";
import { useViewTransform } from "../view/viewContext";
import { BallBody, LABEL_UNITS } from "./BallBody";
import "./BallsLayer.css";

/** The area that picks a ball up, as a multiple of its radius. */
const GRAB_SCALE = 1.6;

interface BallItemProps {
  ball: SceneBall;
  view: ViewTransform;
  selected: boolean;
  spots: Point[];
}

interface Grab {
  pointerId: number;
  offset: Point;
}

/** One ball: drawn, focusable, draggable and movable from the keyboard. */
function BallItem({ ball, view, selected, spots }: BallItemProps) {
  const select = useEditor((s) => s.select);
  const placeBall = useEditor((s) => s.placeBall);
  const removeBall = useEditor((s) => s.removeBall);
  const endGesture = useEditor((s) => s.endGesture);
  const grab = useRef<Grab | undefined>(undefined);

  const r = ball.radiusM;
  const c = view.toScreen(ball);
  const uncertain = isLowConfidence(ball.confidence);
  const name = ballName(ball.kind);

  const screenPoint = (e: PointerEvent<SVGGElement>): Point | undefined => {
    const svg = e.currentTarget.ownerSVGElement;
    return svg ? clientToScreen(svg, e.clientX, e.clientY) : undefined;
  };

  const onPointerDown = (e: PointerEvent<SVGGElement>) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const p = screenPoint(e);
    select(ball.id);
    if (!p) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    grab.current = { pointerId: e.pointerId, offset: grabOffset(view, ball, p) };
  };

  const onPointerMove = (e: PointerEvent<SVGGElement>) => {
    const g = grab.current;
    if (g?.pointerId !== e.pointerId) return;
    // The button was let go somewhere the release could not be seen.
    if (e.pointerType === "mouse" && e.buttons === 0) {
      onPointerEnd(e);
      return;
    }
    const p = screenPoint(e);
    if (!p) return;
    const target = dragTarget(view, g.offset, p);
    // Alt turns snapping off.
    const placed = e.altKey ? target : snapPoint(target, spots, snapDistanceFor(r));
    placeBall(ball.id, placed, "live");
  };

  const onPointerEnd = (e: PointerEvent<SVGGElement>) => {
    if (grab.current?.pointerId !== e.pointerId) return;
    grab.current = undefined;
    endGesture();
  };

  const onKeyDown = (e: KeyboardEvent<SVGGElement>) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (isRemoveKey(e.key)) {
      e.preventDefault();
      removeBall(ball.id);
      return;
    }
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      select(ball.id);
      return;
    }
    const target = arrowTarget(view, ball, e.key, e.shiftKey);
    if (!target) return;
    e.preventDefault();
    select(ball.id);
    // Each key press is its own undo step.
    placeBall(ball.id, target, "commit");
  };

  return (
    <g
      className="ball"
      transform={`translate(${String(c.x)} ${String(c.y)})`}
      role="button"
      tabIndex={0}
      aria-label={uncertain ? `${name}, uncertain position` : name}
      aria-pressed={selected}
      data-ball-id={ball.id}
      data-kind={ball.kind}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      onLostPointerCapture={onPointerEnd}
      onKeyDown={onKeyDown}
    >
      {/* A wider invisible disc, so a ball can be picked up with a finger. */}
      <circle className="ball-grab" r={r * GRAB_SCALE} fill="transparent" />
      <BallBody kind={ball.kind} r={r} />
      {selected ? <circle className="ball-selection" r={r * 1.25} strokeWidth={r * 0.14} /> : null}
      <circle className="ball-focus" r={r * 1.55} strokeWidth={r * 0.12} />
      {uncertain ? (
        <g data-testid="uncertain">
          <title>uncertain position</title>
          <circle
            className="ball-uncertain-ring"
            r={r * 1.4}
            strokeWidth={r * 0.14}
            strokeDasharray={`${String(r * 0.4)} ${String(r * 0.3)}`}
          />
          <circle
            className="ball-uncertain-badge"
            cx={r * 1.1}
            cy={-r * 1.1}
            r={r * 0.5}
            strokeWidth={r * 0.06}
          />
          <text
            className="ball-uncertain-mark"
            transform={`translate(${String(r * 1.1)} ${String(-r * 1.1)}) scale(${String(r / LABEL_UNITS)})`}
            textAnchor="middle"
            dominantBaseline="central"
            fontSize={LABEL_UNITS * 0.75}
          >
            ?
          </text>
        </g>
      ) : null}
    </g>
  );
}

/** The balls on the table. Clicking anywhere else on the table deselects. */
export function BallsLayer({ scene }: { scene: Scene }) {
  const selectedBallId = useEditor((s) => s.selectedBallId);
  return <BallsLayerView scene={scene} selectedBallId={selectedBallId} />;
}

/** The balls layer for a given selection; `BallsLayer` connects it to the store. */
export function BallsLayerView({
  scene,
  selectedBallId,
}: {
  scene: Scene;
  selectedBallId: string | undefined;
}) {
  const view = useViewTransform();
  const select = useEditor((s) => s.select);
  const spots = useMemo(() => spotsFor(scene.table), [scene.table]);
  const anchor = useRef<SVGGElement>(null);

  // Clicks that land on the cloth (not on a ball) reach the svg itself.
  useEffect(() => {
    const svg = anchor.current?.ownerSVGElement;
    if (!svg) return;
    const onDown = (e: Event) => {
      if (e.target instanceof Element && e.target.closest("[data-ball-id]")) return;
      select(undefined);
    };
    svg.addEventListener("pointerdown", onDown);
    return () => {
      svg.removeEventListener("pointerdown", onDown);
    };
  }, [select]);

  return (
    <g ref={anchor} className="balls-layer">
      {scene.balls.map((b) => (
        <BallItem
          key={b.id}
          ball={b}
          view={view}
          selected={b.id === selectedBallId}
          spots={spots}
        />
      ))}
    </g>
  );
}
