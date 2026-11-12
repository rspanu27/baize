import { ballLook } from "../view/ballLook";
import type { BallPath, PathModel, PathRole } from "../sim/pathModel";
import { simulationFor } from "../sim/useSimulation";
import { useDoc } from "../store/store";
import {
  CONTACT_DOT_RADIUS_M,
  CUSHION_DOT_RADIUS_M,
  FINAL_OUTLINE_DASH_M,
  FINAL_OUTLINE_WIDTH_M,
  FIRST_CONTACT_RADIUS_M,
  FIRST_CONTACT_WIDTH_M,
  MARK_COLOUR,
  POCKET_RING_RADIUS_M,
  POCKET_RING_WIDTH_M,
  SLIDING_DASH_M,
  dashArray,
  markVisible,
  pathColour,
  pathData,
  pathStyle,
  pieceRuns,
} from "../view/pathArt";
import { useViewTransform } from "../view/viewContext";

function ballName(kind: string): string {
  return kind === "cue" ? "cue ball" : `${kind} ball`;
}

/** Draws the simulated shot: ball paths, contact marks and final positions. */
export function PathsLayer({ paths }: { paths: PathModel | undefined }) {
  const doc = useDoc();
  const view = useViewTransform();
  if (!paths) return null;

  const showAll = doc.style?.showAllPaths === true;
  const radiusOf = new Map(
    (simulationFor(doc).scene?.balls ?? []).map((b) => [b.id, b.radiusM] as const),
  );
  const roleOf = new Map<string, PathRole>(paths.paths.map((p) => [p.ballId, p.role] as const));
  const kindOf = new Map(paths.finals.map((f) => [f.ballId, f.kind] as const));

  const renderPath = (path: BallPath) => {
    const style = pathStyle(path.role, showAll);
    if (!style.visible) return null;
    const colour = pathColour(path.role, ballLook(path.kind).colour);
    const runs = style.emphasised ? pieceRuns(path.pieces) : [path.pieces];
    const title =
      path.role === "first-object"
        ? `${ballName(path.kind)} path (first ball hit)`
        : `${ballName(path.kind)} path`;
    return (
      <g
        key={path.ballId}
        data-path={path.ballId}
        data-role={path.role}
        data-faint={style.emphasised ? undefined : "true"}
      >
        <title>{title}</title>
        {runs.map((run, i) => (
          <path
            key={i}
            d={pathData(run, view)}
            fill="none"
            stroke={colour}
            strokeWidth={style.widthM}
            strokeOpacity={style.opacity}
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeDasharray={
              style.emphasised && run[0]?.sliding ? dashArray(SLIDING_DASH_M) : undefined
            }
          />
        ))}
      </g>
    );
  };

  return (
    <g
      data-paths-layer=""
      data-incomplete={paths.complete ? undefined : "true"}
      pointerEvents="none"
      style={{ pointerEvents: "none" }}
    >
      {paths.paths.map(renderPath)}
      {paths.marks.map((m, i) => {
        if (!markVisible(m, (id) => roleOf.get(id))) return null;
        const c = view.toScreen(m.point);
        if (m.kind === "pocket") {
          const kind = kindOf.get(m.ballIds[0] ?? "") ?? "";
          return (
            <circle
              key={i}
              data-mark="pocket"
              cx={c.x}
              cy={c.y}
              r={POCKET_RING_RADIUS_M}
              fill="none"
              stroke={MARK_COLOUR}
              strokeWidth={POCKET_RING_WIDTH_M}
            >
              <title>{`${ballName(kind)} potted`}</title>
            </circle>
          );
        }
        if (m.kind === "ball-ball" && m.firstContact) {
          return (
            <circle
              key={i}
              data-mark="first-contact"
              cx={c.x}
              cy={c.y}
              r={FIRST_CONTACT_RADIUS_M}
              fill="none"
              stroke={MARK_COLOUR}
              strokeWidth={FIRST_CONTACT_WIDTH_M}
            >
              <title>first contact</title>
            </circle>
          );
        }
        return (
          <circle
            key={i}
            data-mark={m.kind}
            cx={c.x}
            cy={c.y}
            r={m.kind === "cushion" ? CUSHION_DOT_RADIUS_M : CONTACT_DOT_RADIUS_M}
            fill={MARK_COLOUR}
            fillOpacity={0.9}
          >
            <title>{m.kind === "cushion" ? "cushion contact" : "ball contact"}</title>
          </circle>
        );
      })}
      {paths.finals.map((f) => {
        if (!f.moved || f.pocketed) return null;
        const r = radiusOf.get(f.ballId);
        if (r === undefined) return null;
        const c = view.toScreen(f.position);
        return (
          <circle
            key={f.ballId}
            data-final={f.ballId}
            cx={c.x}
            cy={c.y}
            r={r}
            fill="none"
            stroke={MARK_COLOUR}
            strokeOpacity={0.85}
            strokeWidth={FINAL_OUTLINE_WIDTH_M}
            strokeDasharray={dashArray(FINAL_OUTLINE_DASH_M)}
          >
            <title>{`${ballName(f.kind)} final position`}</title>
          </circle>
        );
      })}
    </g>
  );
}
