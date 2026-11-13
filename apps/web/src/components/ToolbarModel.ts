import { drillFits, drillsFor, rackFits, racksFor } from "@baize/tables";
import type { BallKind, RackKind } from "@baize/tables";
import type { Scene } from "../doc/resolve";
import { ballName } from "../view/ballLook";

/** What the toolbar shows for a scene: pure, so it can be tested without rendering. */

export interface PaletteEntry {
  kind: BallKind;
  /** "9 ball", "cue ball". */
  name: string;
  /** How many more of this kind the ball set allows on the table. */
  remaining: number;
}

/** One entry per ball kind of the ball set, with how many are still available. */
export function paletteEntries(scene: Scene): PaletteEntry[] {
  return scene.ballSet.kinds.map(({ kind, count }) => {
    const onTable = scene.balls.filter((b) => b.kind === kind).length;
    return { kind, name: ballName(kind), remaining: Math.max(0, count - onTable) };
  });
}

export const RACK_LABELS: Record<RackKind, string> = {
  "snooker-15": "Full snooker rack",
  "snooker-10": "10 reds",
  "snooker-6": "6 reds",
  "pool-8ball": "8-ball rack",
  "pool-9ball": "9-ball rack",
  "pool-15": "15-ball rack",
  blackball: "Blackball rack",
};

export interface RackEntry {
  rack: RackKind;
  label: string;
  fits: boolean;
  /** Why the rack is unavailable; set exactly when `fits` is false. */
  reason?: string;
}

/** One entry per rack of the table's game. */
export function rackEntries(scene: Scene): RackEntry[] {
  return racksFor(scene.table.game).map((rack) => {
    const fits = rackFits(scene.table, scene.ballSet, rack);
    return {
      rack,
      label: RACK_LABELS[rack],
      fits,
      ...(fits ? {} : { reason: "Does not fit on this table with these balls." }),
    };
  });
}

export interface DrillEntry {
  id: string;
  name: string;
  /** What to do, in a sentence or two. */
  description: string;
}

/** The drills of the table's game that fit this table with these balls. */
export function drillEntries(scene: Scene): DrillEntry[] {
  return drillsFor(scene.table.game)
    .filter((d) => drillFits(scene.table, scene.ballSet, d.id))
    .map((d) => ({ id: d.id, name: d.name, description: d.description }));
}

/** The point balls are added at: the middle of the playing area. */
export function tableCentre(scene: Scene): { x: number; y: number } {
  const { widthM, lengthM } = scene.table.playingArea;
  return { x: widthM / 2, y: lengthM / 2 };
}

export interface ShortcutEvent {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey?: boolean;
}

/** Ctrl/Cmd+Z undoes, Ctrl/Cmd+Shift+Z and Ctrl+Y redo. */
export function historyShortcut(e: ShortcutEvent): "undo" | "redo" | undefined {
  if ((!e.ctrlKey && !e.metaKey) || e.altKey) return undefined;
  const key = e.key.toLowerCase();
  if (key === "z") return e.shiftKey ? "redo" : "undo";
  if (key === "y" && e.ctrlKey && !e.shiftKey) return "redo";
  return undefined;
}

/** True when the key events belong to a text field, which has its own undo. */
export function isTypingTarget(
  target: { tagName?: string; isContentEditable?: boolean } | null,
): boolean {
  if (!target) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName?.toUpperCase();
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}
