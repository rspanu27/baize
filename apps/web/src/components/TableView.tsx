import { buildTableGeometry } from "@baize/physics";
import { markingsFor } from "@baize/tables";
import { useMemo } from "react";
import type { ReactNode } from "react";
import type { Scene } from "../doc/resolve";
import type { DiagramStyle } from "../doc/types";
import { CAPTION_UNITS, captionLayout, withCaptionBand } from "../view/caption";
import type { CaptionLayout } from "../view/caption";
import {
  CUSHION_DARKEN,
  CUSHION_DEPTH_M,
  MARKING_WIDTH_M,
  RAIL_CORNER_RADIUS_M,
  RAIL_WIDTH_M,
  SIGHT_RADIUS_M,
  SPOT_RADIUS_M,
} from "../view/constants";
import { DrawStyleContext } from "../view/drawStyleContext";
import { shade } from "../view/shade";
import { cushionPaths, markingShapes, pocketCircles, tableRect } from "../view/tableArt";
import { resolveDrawStyle, themeCssVars } from "../view/theme";
import type { ThemeColours } from "../view/theme";
import { makeViewTransform } from "../view/transform";
import type { Orientation } from "../view/transform";
import { ViewTransformContext } from "../view/viewContext";
import "./TableView.css";

/** Width of the thin outline themes may draw around the rails. */
const OUTLINE_WIDTH_M = 0.004;

export interface TableViewProps {
  scene: Scene;
  orientation: Orientation;
  /** How the diagram is drawn (theme, caption); absent means the defaults. */
  style?: DiagramStyle | undefined;
  /** Drawn on top of the table, in screen space; use `useViewTransform()` to place things. */
  children?: ReactNode;
}

/** The caption, in a band under the table: one centred line, squeezed to fit if it is long. */
function CaptionBand({
  text,
  layout,
  colours,
}: {
  text: string;
  layout: CaptionLayout;
  colours: ThemeColours;
}) {
  const { band } = layout;
  return (
    <g data-caption="">
      <rect
        x={band.x}
        y={band.y}
        width={band.width}
        height={band.height}
        fill={colours.captionBackground}
      />
      <text
        transform={`translate(${String(layout.x)} ${String(layout.y)}) scale(${String(layout.scale)})`}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={CAPTION_UNITS}
        fontFamily="system-ui, sans-serif"
        fill={colours.captionText}
        textLength={layout.textLength}
        lengthAdjust={layout.textLength === undefined ? undefined : "spacingAndGlyphs"}
      >
        {text}
      </text>
    </g>
  );
}

/** The table seen from above: rails, cloth, pockets, cushions and markings. */
export function TableView({ scene, orientation, style, children }: TableViewProps) {
  const { table, cloth } = scene;
  const { widthM, lengthM } = table.playingArea;

  const transform = useMemo(
    () => makeViewTransform({ widthM, lengthM }, orientation),
    [widthM, lengthM, orientation],
  );
  const geometry = useMemo(() => buildTableGeometry(table), [table]);

  const draw = useMemo(() => resolveDrawStyle(style), [style]);
  const colours = draw.colours;
  const tableBox = transform.viewBox(RAIL_WIDTH_M);
  const box = withCaptionBand(tableBox, draw.caption);
  const caption = draw.caption === undefined ? undefined : captionLayout(draw.caption, tableBox);
  const rails = tableRect(transform, RAIL_WIDTH_M);
  const bed = tableRect(transform, CUSHION_DEPTH_M);
  const clothColour = colours.cloth ?? cloth.colour;
  const cushionColour = colours.cushion ?? shade(clothColour, -CUSHION_DARKEN);
  const cushionEdge = colours.cushionEdge ?? shade(clothColour, -CUSHION_DARKEN - 0.15);
  const cushions = cushionPaths(geometry, CUSHION_DEPTH_M, transform);
  const pockets = pocketCircles(geometry, transform);
  const markings = markingShapes(markingsFor(table), transform);
  const cssVars = themeCssVars(colours);

  return (
    <ViewTransformContext.Provider value={transform}>
      <DrawStyleContext.Provider value={draw}>
        <svg
          className="table-view"
          viewBox={`${String(box.x)} ${String(box.y)} ${String(box.width)} ${String(box.height)}`}
          preserveAspectRatio="xMidYMin meet"
          role="group"
          aria-label={`${table.name}, seen from above`}
          data-theme={draw.theme === "table" ? undefined : draw.theme}
          data-caption-band={caption ? caption.band.height : undefined}
          style={cssVars}
        >
          {colours.sheet ? (
            <rect
              data-sheet=""
              x={box.x}
              y={box.y}
              width={box.width}
              height={box.height}
              fill={colours.sheet}
            />
          ) : null}
          <rect
            {...rails}
            rx={RAIL_CORNER_RADIUS_M}
            fill={colours.rail}
            stroke={colours.railOutline}
            strokeWidth={colours.railOutline ? OUTLINE_WIDTH_M : undefined}
          />
          <rect {...bed} fill={clothColour} />
          {pockets.map((p) => (
            <circle key={p.id} cx={p.cx} cy={p.cy} r={p.r} fill={colours.pocket} />
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
                    stroke={colours.marking}
                    strokeOpacity={colours.lineOpacity}
                    strokeWidth={MARKING_WIDTH_M}
                  />
                );
              case "arc":
                return (
                  <path
                    key={m.name}
                    d={m.d}
                    fill="none"
                    stroke={colours.marking}
                    strokeOpacity={colours.lineOpacity}
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
                    fill={colours.marking}
                    fillOpacity={colours.spotOpacity}
                  />
                );
              case "sight":
                return (
                  <circle
                    key={m.name}
                    cx={m.cx}
                    cy={m.cy}
                    r={SIGHT_RADIUS_M}
                    fill={colours.sight}
                  />
                );
            }
          })}
          {caption && draw.caption !== undefined ? (
            <CaptionBand text={draw.caption} layout={caption} colours={colours} />
          ) : null}
          {children}
        </svg>
      </DrawStyleContext.Provider>
    </ViewTransformContext.Provider>
  );
}
