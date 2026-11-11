import type { BallSetSpec, GameType, Layout, RackKind, TableSpec } from "./types";

/** Racks available for a game. Task 1.6. */
export const racksFor: (game: GameType) => RackKind[] = () => {
  throw new Error("not implemented");
};

/** Ball positions for a rack on a given table with a given ball set. Task 1.6. */
export const rackLayout: (
  table: TableSpec,
  ballSet: BallSetSpec,
  rack: RackKind,
) => Layout = () => {
  throw new Error("not implemented");
};
