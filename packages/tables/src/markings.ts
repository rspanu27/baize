import type { Marking, Spot, TableSpec } from "./types";

/** Lines, arcs, spots and sights to draw for a table, derived from its game and size. Task 1.5. */
export const markingsFor: (table: TableSpec) => Marking[] = () => {
  throw new Error("not implemented");
};

/** Named spots balls can snap to. Task 1.5. */
export const spotsFor: (table: TableSpec) => Spot[] = () => {
  throw new Error("not implemented");
};
