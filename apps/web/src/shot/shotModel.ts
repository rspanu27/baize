import type { Scene } from "../doc/resolve";
import { firstBallOnLine } from "../geometry/aim";
import type { Point } from "../geometry/aim";

/**
 * Pure logic behind the shot controls: aiming, the tip position and the speed scale.
 *
 * Aim angles are never rounded here. The controls can reach any angle: dragging the aim
 * handle sets the exact direction to the pointer, and the fine steps go down to a hundredth
 * of a degree.
 */

export const DEG = Math.PI / 180;

/** Aim steps offered by the controls, in degrees. */
export const AIM_STEPS_DEG = [1, 0.1, 0.01] as const;

/** Largest tip offset, as a fraction of the ball radius (the miscue limit). */
export const MAX_TIP = 0.5;

/** Speed range of the slider, m/s. Design range: a soft roll to a hard break. */
export const SPEED_MIN = 0.2;
export const SPEED_MAX = 10;

/**
 * Named speeds, m/s. Design values chosen so the names match how the shots play on a 9 ft
 * table with medium cloth: a soft shot rolls about one table length, a break is a hard break.
 */
export const SPEED_STOPS: readonly { name: string; speedMps: number }[] = [
  { name: "Soft", speedMps: 0.7 },
  { name: "Medium", speedMps: 1.8 },
  { name: "Firm", speedMps: 3.5 },
  { name: "Power", speedMps: 6 },
  { name: "Break", speedMps: 9 },
];

/** Standard gravity, m/s^2, for the roll-distance hint (the engine uses the same value). */
const G = 9.80665;

/** The angle turned by a number of degrees, kept in [0, 2 pi). */
export function nudgeAngle(angleRad: number, deltaDeg: number): number {
  const turn = 2 * Math.PI;
  const a = (angleRad + deltaDeg * DEG) % turn;
  return a < 0 ? a + turn : a;
}

/** Aim angle in degrees in [0, 360), for display. */
export function angleToDegrees(angleRad: number): number {
  const d = (angleRad / DEG) % 360;
  return d < 0 ? d + 360 : d;
}

/** Direction from the cue ball to a point on the table: the exact angle, not rounded. */
export function aimAt(cue: Point, target: Point): number | undefined {
  const dx = target.x - cue.x;
  const dy = target.y - cue.y;
  if (dx === 0 && dy === 0) return undefined;
  return Math.atan2(dy, dx);
}

/** A tip position held inside the miscue limit. */
export function clampTip(side: number, vertical: number): { side: number; vertical: number } {
  const length = Math.sqrt(side * side + vertical * vertical);
  if (length <= MAX_TIP) return { side, vertical };
  const k = MAX_TIP / length;
  return { side: side * k, vertical: vertical * k };
}

/**
 * Tip position from a point on the ball-face widget. `dx` and `dy` are measured from the
 * centre of the drawn ball in units of its drawn radius, with screen y pointing down, so up
 * on the screen is above centre on the ball.
 */
export function tipFromWidget(dx: number, dy: number): { side: number; vertical: number } {
  return clampTip(dx, -dy);
}

/** Words for a tip position, for the readout and for screen readers. */
export function describeTip(side: number, vertical: number): string {
  const near = (v: number): boolean => Math.abs(v) < 0.005;
  if (near(side) && near(vertical)) return "Centre ball";
  const parts: string[] = [];
  if (!near(vertical)) {
    parts.push(
      `${Math.abs(vertical).toFixed(2)} ${vertical > 0 ? "above centre (follow)" : "below centre (draw)"}`,
    );
  }
  if (!near(side)) parts.push(`${Math.abs(side).toFixed(2)} ${side > 0 ? "right" : "left"} side`);
  return parts.join(", ");
}

/** The named speed closest to a speed, if it is within 5 % of it. */
export function speedName(speedMps: number): string | undefined {
  return SPEED_STOPS.find((s) => Math.abs(s.speedMps - speedMps) <= 0.05 * s.speedMps)?.name;
}

/**
 * How far a ball struck at this speed would roll on this cloth with nothing in its way, in
 * table lengths: a feel for the speed that does not depend on units. Uses the natural-roll
 * speed (5/7 of the launch speed for a centre-ball hit) and the cloth's rolling resistance.
 */
export function rollInTableLengths(speedMps: number, scene: Scene): number {
  const rolling = (5 / 7) * speedMps;
  const distance = (rolling * rolling) / (2 * scene.cloth.rollingResistance * G);
  return distance / scene.table.playingArea.lengthM;
}

export interface AimGuide {
  /** Cue ball centre. */
  from: Point;
  /** Where the aim line is drawn to: the ghost ball, or a point along the line. */
  to: Point;
  /** Cue ball centre at first contact with a ball, if the line meets one before a cushion. */
  ghost: Point | undefined;
  /** Id of the ball the line meets first. */
  targetBallId: string | undefined;
}

/** Length of the aim line when it meets no ball, metres. */
const FREE_AIM_LENGTH_M = 0.6;

/** The straight aim line from the cue ball, up to the first ball on it. */
export function aimGuide(scene: Scene): AimGuide | undefined {
  const shot = scene.shot;
  const cue = shot ? scene.balls.find((b) => b.id === shot.cueBallId) : undefined;
  if (!shot || !cue) return undefined;
  const others = scene.balls.filter((b) => b.id !== cue.id);
  const hit = firstBallOnLine(cue, shot.aimAngleRad, cue.radiusM, others);
  const from = { x: cue.x, y: cue.y };
  if (hit) return { from, to: hit.ghost, ghost: hit.ghost, targetBallId: hit.id };
  return {
    from,
    to: {
      x: cue.x + FREE_AIM_LENGTH_M * Math.cos(shot.aimAngleRad),
      y: cue.y + FREE_AIM_LENGTH_M * Math.sin(shot.aimAngleRad),
    },
    ghost: undefined,
    targetBallId: undefined,
  };
}

/** Key presses on the aim handle: left and right turn the aim. Returns degrees, or undefined. */
export function aimKeyStep(
  key: string,
  modifiers: { shift: boolean; alt: boolean },
): number | undefined {
  const size = modifiers.alt ? 0.01 : modifiers.shift ? 1 : 0.1;
  // Angles are counter-clockwise, so the left arrow turns the aim to the left of its direction.
  if (key === "ArrowLeft") return size;
  if (key === "ArrowRight") return -size;
  return undefined;
}
