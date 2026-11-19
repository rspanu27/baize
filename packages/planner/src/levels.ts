import type { PlayerLevel } from "./types";

/**
 * Player levels: the spread of a player's errors in the cue ball's starting direction and speed.
 *
 * UNVERIFIED. No measured source for these spreads was found (2026-11-19). They are this
 * project's estimates, chosen as round steps that halve the aim error from one level to the
 * next; the aim error is of the cue ball's direction after the strike, so it includes the
 * player's errors with squirt and stance. They only scale the pot chances the planner reports
 * and the balance between safe and ambitious routes; replace them when a measurement is found.
 */
export const PLAYER_LEVELS: readonly PlayerLevel[] = [
  // 1.0 degree, 15 % speed. UNVERIFIED estimate.
  { id: "beginner", name: "Beginner", aimErrorRad: (1.0 * Math.PI) / 180, speedError: 0.15 },
  // 0.5 degree, 10 % speed. UNVERIFIED estimate.
  { id: "club", name: "Club player", aimErrorRad: (0.5 * Math.PI) / 180, speedError: 0.1 },
  // 0.25 degree, 7 % speed. UNVERIFIED estimate.
  { id: "strong", name: "Strong amateur", aimErrorRad: (0.25 * Math.PI) / 180, speedError: 0.07 },
  // 0.12 degree, 5 % speed. UNVERIFIED estimate.
  { id: "pro", name: "Professional", aimErrorRad: (0.12 * Math.PI) / 180, speedError: 0.05 },
];

export function getPlayerLevel(id: string): PlayerLevel | undefined {
  return PLAYER_LEVELS.find((l) => l.id === id);
}
