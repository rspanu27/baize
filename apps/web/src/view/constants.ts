import { CUSHION_TOP_DEPTH_M } from "@baize/tables";

/**
 * Drawing constants for the table, in metres. These are about how the table is painted, not
 * about its physics; the playing area and pockets always come from the table spec.
 */

/** How far the cushion is drawn behind the nose line: the value the photo import also uses. */
export const CUSHION_DEPTH_M = CUSHION_TOP_DEPTH_M;

/** Width of the wooden rail beyond the cushion rubber. */
export const RAIL_WOOD_M = 0.12;

/** Distance from the nose line to the outer edge of the rail; also the viewBox margin. */
export const RAIL_WIDTH_M = CUSHION_DEPTH_M + RAIL_WOOD_M;

/** Distance from the nose line to the middle of the wooden rail, where sights are drawn. */
export const SIGHT_OFFSET_M = CUSHION_DEPTH_M + RAIL_WOOD_M / 2;

export const RAIL_CORNER_RADIUS_M = 0.06;
export const SPOT_RADIUS_M = 0.008;
export const SIGHT_RADIUS_M = 0.009;
export const MARKING_WIDTH_M = 0.004;

export const RAIL_COLOUR = "#4a2f1c";
export const POCKET_COLOUR = "#0d0d0d";
export const SIGHT_COLOUR = "#e9dcc3";
export const MARKING_COLOUR = "#ffffff";
export const LINE_OPACITY = 0.25;
export const SPOT_OPACITY = 0.35;

/** How much darker than the cloth the cushions are drawn. */
export const CUSHION_DARKEN = 0.18;
