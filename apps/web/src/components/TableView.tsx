import { buildTableGeometry } from "@baize/physics";
import { markingsFor } from "@baize/tables";
import { useMemo } from "react";
import type { ReactNode } from "react";
import type { Scene } from "../doc/resolve";
import {
  CUSHION_DARKEN,
  CUSHION_DEPTH_M,
  LINE_OPACITY,
  MARKING_COLOUR,
  MARKING_WIDTH_M,
  POCKET_COLOUR,
  RAIL_COLOUR,
  RAIL_CORNER_RADIUS_M,
  RAIL_WIDTH_M,
  SIGHT_COLOUR,
  SIGHT_RADIUS_M,
  SPOT_OPACITY,
  SPOT_RADIUS_M,
} from "../view/constants";
import { shade } from "../view/shade";
import { cushionPaths, markingShapes, pocketCircles, tableRect } from "../view/tableArt";
import { makeViewTransform } from "../view/transform";
import type { Orientation } from "../view/transform";
import { ViewTransformContext } from "../view/viewContext";
import "./TableView.css";

export interface TableViewProps {
  scene: Scene;
  orientation: Orientation;
  /** Drawn on top of the table, in screen space; use `useViewTransform()` to place things. */
  children?: ReactNode;
}

/** The table seen from above: rails, cloth, pockets, cushions and markings. */
export function TableView({ scene, orientation, children }: TableViewProps) {
  const { table, cloth } = scene;
  const { widthM, lengthM } = table.playingArea;

  const transform = useMemo(
    () => makeViewTransform({ widthM, lengthM }, orientation),
    [widthM, lengthM, orientation],
  );
  const geometry = useMemo(() => buildTableGeometry(table), [table]);

  const box = transform.viewBox(RAIL_WIDTH_M);
  const rails = tableRect(transform, RAIL_WIDTH_M);
  const bed = tableRect(transform, CUSHION_DEPTH_M);
  const cushionColour = shade(cloth.colour, -CUSHION_DARKEN);
  const cushionEdge = shade(cloth.colour, -CUSHION_DARKEN - 0.15);
  const cushions = cushionPaths(geometry, CUSHION_DEPTH_M, transform);
  const pockets = pocketCircles(geometry, transform);
  const markings = markingShapes(markingsFor(table), transform);

  return (
    <ViewTransformContext.Provider value={transform}>
      <svg
        className="table-view"
        viewBox={`${String(box.x)} ${String(box.y)} ${String(box.width)} ${String(box.height)}`}
        preserveAspectRatio="xMidYMin meet"
        role="img"
        aria-label={`${table.name}, seen from above`}
      >
        <rect {...rails} rx={RAIL_CORNER_RADIUS_M} fill={RAIL_COLOUR} />
        <rect {...bed} fill={cloth.colour} />
        {pockets.map((p) => (
          <circle key={p.id} cx={p.cx} cy={p.cy} r={p.r} fill={POCKET_COLOUR} />
        ))}
        {cushions.map((d, i) => (
          <path key={i} d={d} fill={cushionColour} stroke={cushionEdge} strokeWidth={0.003} />
        ))}
        {markings.map((m) => {
          switch (m.kind) {
            case "line":
              return (
                <line
                  key={m.name}
                  x1={m.x1}
                  y1={m.y1}
                  x2={m.x2}
                  y2={m.y2}
                  stroke={MARKING_COLOUR}
                  strokeOpacity={LINE_OPACITY}
                  strokeWidth={MARKING_WIDTH_M}
                />
              );
            case "arc":
              return (
                <path
                  key={m.name}
                  d={m.d}
                  fill="none"
                  stroke={MARKING_COLOUR}
                  strokeOpacity={LINE_OPACITY}
                  strokeWidth={MARKING_WIDTH_M}
                />
              );
            case "spot":
              return (
                <circle
                  key={m.name}
                  cx={m.cx}
                  cy={m.cy}
                  r={SPOT_RADIUS_M}
                  fill={MARKING_COLOUR}
                  fillOpacity={SPOT_OPACITY}
                />
              );
            case "sight":
              return (
                <circle key={m.name} cx={m.cx} cy={m.cy} r={SIGHT_RADIUS_M} fill={SIGHT_COLOUR} />
              );
          }
        })}
        {children}
      </svg>
    </ViewTransformContext.Provider>
  );
}
