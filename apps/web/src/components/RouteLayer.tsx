import { sampleAt } from "@baize/physics";
import type { PlannedShot } from "@baize/planner";
import { useMemo } from "react";
import type { Scene } from "../doc/resolve";
import { planFor, usePlanner } from "../planner/plannerStore";
import { buildPathModel } from "../sim/pathModel";
import type { PathPiece, Point } from "../sim/pathModel";
import { useDoc } from "../store/store";
import { ballName } from "../view/ballLook";
import { useDrawStyle } from "../view/drawStyleContext";
import {
  FINAL_OUTLINE_DASH_M,
  FINAL_OUTLINE_WIDTH_M,
  STRONG_WIDTH_M,
  dashArray,
  pathData,
} from "../view/pathArt";
import { useViewTransform } from "../view/viewContext";

/**
 * The planner's route drawn on the table: for each step its number at the target ball, a line
 * from that ball to its pocket, the cue ball's path and a numbered outline where the cue ball
 * stops. The selected step stands out. Nothing here takes pointer events, so balls can still be
 * dragged through it.
 */

/** Radius of a step number's badge, metres: a little larger than a ball, to read on a phone. */
export const BADGE_RADIUS_M = 0.03;
/** Badges are drawn in these units and scaled, as browsers floor tiny font sizes. */
const BADGE_UNITS = 100;
const POCKET_LINE_DASH_M: readonly [number, number] = [0.02, 0.014];

/** What the layer draws for one step, in table coordinates. */
export interface RouteStepArt {
  index: number;
  targetName: string;
  /** Where the target ball starts, and where it drops (absent if it does not drop as planned). */
  target: Point | undefined;
  pocket: Point | undefined;
  cuePieces: PathPiece[];
  cueStop: Point;
}

/** The drawable parts of a route; pure, so the layer and its tests share it. */
export function routeArt(
  steps: readonly PlannedShot[],
  scene: Scene,
  cueBallId: string,
  kindOf: ReadonlyMap<string, string>,
): RouteStepArt[] {
  return steps.map((step, index) => {
    const start = sampleAt(step.result, 0).find((b) => b.id === step.targetId);
    const drop = step.result.events.find((e) => e.type === "pocket" && e.ballId === step.targetId);
    const model = buildPathModel(step.result, scene);
    return {
      index,
      targetName: ballName(kindOf.get(step.targetId) ?? step.targetId),
      target: start ? { x: start.position.x, y: start.position.y } : undefined,
      pocket: drop && drop.type === "pocket" ? { x: drop.point.x, y: drop.point.y } : undefined,
      cuePieces: model.paths.find((p) => p.ballId === cueBallId)?.pieces ?? [],
      cueStop: { x: step.cueStop.x, y: step.cueStop.y },
    };
  });
}

function Badge({
  at,
  n,
  fill,
  text,
  stroke,
}: {
  at: Point;
  n: number;
  fill: string;
  text: string;
  stroke: string;
}) {
  const k = BADGE_RADIUS_M / BADGE_UNITS;
  return (
    <g transform={`translate(${String(at.x)} ${String(at.y)}) scale(${String(k)})`}>
      <circle r={BADGE_UNITS} fill={fill} stroke={stroke} strokeWidth={BADGE_UNITS * 0.14} />
      <text
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={BADGE_UNITS * 1.2}
        fontWeight={700}
        fontFamily="system-ui, sans-serif"
        fill={text}
      >
        {n}
      </text>
    </g>
  );
}

export interface RouteLayerViewProps {
  art: readonly RouteStepArt[];
  selected: number | undefined;
  cueRadiusM: number;
  ballRadiusM: number;
}

export function RouteLayerView({ art, selected, cueRadiusM, ballRadiusM }: RouteLayerViewProps) {
  const view = useViewTransform();
  const { colours } = useDrawStyle();
  const opacityOf = (i: number) => (selected === undefined ? 0.9 : selected === i ? 1 : 0.4);
  const widthOf = (i: number) => (selected === i ? STRONG_WIDTH_M * 1.5 : STRONG_WIDTH_M);
  // The selected step is drawn last, on top of the others.
  const order = [...art].sort(
    (a, b) => Number(a.index === selected) - Number(b.index === selected) || a.index - b.index,
  );
  // Badges sit up and to the left of the target ball on screen, clear of its own number.
  const offset = (ballRadiusM + BADGE_RADIUS_M) * Math.SQRT1_2;

  return (
    <g data-route-layer="" pointerEvents="none" style={{ pointerEvents: "none" }}>
      {order.map((s) => {
        const n = s.index + 1;
        const target = s.target ? view.toScreen(s.target) : undefined;
        const pocket = s.pocket ? view.toScreen(s.pocket) : undefined;
        const stop = view.toScreen(s.cueStop);
        return (
          <g
            key={s.index}
            data-route-step={n}
            data-selected={selected === s.index ? "true" : undefined}
            opacity={opacityOf(s.index)}
          >
            <title>{`Shot ${String(n)}: ${s.targetName}`}</title>
            {target && pocket ? (
              <line
                data-route-pocket-line=""
                x1={target.x}
                y1={target.y}
                x2={pocket.x}
                y2={pocket.y}
                stroke={colours.mark}
                strokeWidth={widthOf(s.index)}
                strokeDasharray={dashArray(POCKET_LINE_DASH_M)}
                strokeLinecap="round"
              />
            ) : null}
            {s.cuePieces.length > 0 ? (
              <path
                data-route-cue-path=""
                d={pathData(s.cuePieces, view)}
                fill="none"
                stroke={colours.cuePath}
                strokeWidth={widthOf(s.index)}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ) : null}
            {target && s.index > 0 ? (
              // Where a later step expects its ball, which an earlier step may have moved.
              <circle
                data-route-target=""
                cx={target.x}
                cy={target.y}
                r={ballRadiusM}
                fill="none"
                stroke={colours.mark}
                strokeWidth={FINAL_OUTLINE_WIDTH_M}
                strokeDasharray={dashArray(FINAL_OUTLINE_DASH_M)}
              />
            ) : null}
            <circle
              data-route-stop=""
              cx={stop.x}
              cy={stop.y}
              r={cueRadiusM}
              fill="none"
              stroke={colours.cuePath}
              strokeWidth={FINAL_OUTLINE_WIDTH_M * (selected === s.index ? 1.5 : 1)}
              strokeDasharray={dashArray(FINAL_OUTLINE_DASH_M)}
            />
            <Badge
              at={stop}
              n={n}
              fill={colours.captionBackground}
              text={colours.captionText}
              stroke={colours.cuePath}
            />
            {target ? (
              <Badge
                at={{ x: target.x - offset, y: target.y - offset }}
                n={n}
                fill={colours.captionBackground}
                text={colours.captionText}
                stroke={colours.mark}
              />
            ) : null}
          </g>
        );
      })}
    </g>
  );
}

/** The route of the planner panel, when there is one for the current document. */
export function RouteLayer({ scene }: { scene: Scene }) {
  const doc = useDoc();
  const plan = usePlanner((s) => s.plan);
  const owned = planFor(plan, doc);
  const route = owned?.route;
  const planDoc = owned?.planDoc;
  const cueBallId = owned?.cueBallId ?? "";
  const art = useMemo(() => {
    if (!route || !planDoc) return [];
    const kindOf = new Map<string, string>(planDoc.balls.map((b) => [b.id, b.kind]));
    return routeArt(route.steps, scene, cueBallId, kindOf);
  }, [route, planDoc, scene, cueBallId]);
  if (!owned || art.length === 0) return null;
  const cue = scene.balls.find((b) => b.id === cueBallId);
  const radius = cue?.radiusM ?? scene.balls[0]?.radiusM ?? 0;
  return (
    <RouteLayerView art={art} selected={owned.selected} cueRadiusM={radius} ballRadiusM={radius} />
  );
}
