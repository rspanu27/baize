import { strike } from "@baize/physics";
import { BALL_TO_CUE_END_MASS_RATIO } from "@baize/tables";
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
  /**
   * Where the aim line is drawn to. The aim line is where the cue points; it is as long as
   * the cue ball's run to its first ball, or a fixed length when there is none.
   */
  to: Point;
  /**
   * Direction the cue ball actually leaves in. With side it is a little off the aim line,
   * away from the side that was hit (squirt); without side it is the aim direction exactly.
   */
  departureAngleRad: number;
  /** Cue ball centre at first contact with a ball, if its line meets one before a cushion. */
  ghost: Point | undefined;
  /** Id of the ball the cue ball meets first. */
  targetBallId: string | undefined;
}

/** Length of the aim line when the cue ball meets no ball, metres. */
const FREE_AIM_LENGTH_M = 0.6;

/**
 * The direction the cue ball leaves in: the aim direction turned by the squirt that the
 * physics gives this hit. `endMassRatio` is ball mass over cue end mass.
 */
export function departureAngle(
  scene: Scene,
  endMassRatio: number = BALL_TO_CUE_END_MASS_RATIO,
): number | undefined {
  const shot = scene.shot;
  const cue = shot ? scene.balls.find((b) => b.id === shot.cueBallId) : undefined;
  if (!shot || !cue) return undefined;
  if (shot.tipOffset.side === 0) return shot.aimAngleRad;
  try {
    const v = strike(
      cue.radiusM,
      {
        ballId: cue.id,
        aimAngleRad: shot.aimAngleRad,
        speedMps: shot.speedMps,
        tipOffset: shot.tipOffset,
        cueEndMassKg: cue.massKg / endMassRatio,
      },
      cue.massKg,
    ).velocity;
    const turned = Math.atan2(v.y, v.x) - shot.aimAngleRad;
    // The squirt itself, as a small angle either side of zero, added to the stored aim.
    return shot.aimAngleRad + Math.atan2(Math.sin(turned), Math.cos(turned));
  } catch {
    // A shot the physics refuses (a miscue) has no departure line of its own.
    return shot.aimAngleRad;
  }
}

/**
 * The aim line from the cue ball, and the first ball the cue ball meets on the line it
 * actually leaves along (see `departureAngle`). Curving after the strike is not modelled, so
 * that line is straight.
 */
export function aimGuide(
  scene: Scene,
  endMassRatio: number = BALL_TO_CUE_END_MASS_RATIO,
): AimGuide | undefined {
  const shot = scene.shot;
  const cue = shot ? scene.balls.find((b) => b.id === shot.cueBallId) : undefined;
  const departureAngleRad = departureAngle(scene, endMassRatio);
  if (!shot || !cue || departureAngleRad === undefined) return undefined;
  const others = scene.balls.filter((b) => b.id !== cue.id);
  const hit = firstBallOnLine(cue, departureAngleRad, cue.radiusM, others);
  const from = { x: cue.x, y: cue.y };
  const squirted = departureAngleRad !== shot.aimAngleRad;
  if (hit && !squirted) {
    return { from, to: hit.ghost, departureAngleRad, ghost: hit.ghost, targetBallId: hit.id };
  }
  const length = hit
    ? Math.sqrt(
        (hit.ghost.x - cue.x) * (hit.ghost.x - cue.x) +
          (hit.ghost.y - cue.y) * (hit.ghost.y - cue.y),
      )
    : FREE_AIM_LENGTH_M;
  return {
    from,
    to: {
      x: cue.x + length * Math.cos(shot.aimAngleRad),
      y: cue.y + length * Math.sin(shot.aimAngleRad),
    },
    departureAngleRad,
    ghost: hit?.ghost,
    targetBallId: hit?.id,
  };
}

/** Arrow keys on the tip widget move the tip by a twentieth of the ball radius. */
export const TIP_KEY_STEP = 0.05;

export function tipKeyStep(key: string): { side: number; vertical: number } | undefined {
  switch (key) {
    case "ArrowLeft":
      return { side: -TIP_KEY_STEP, vertical: 0 };
    case "ArrowRight":
      return { side: TIP_KEY_STEP, vertical: 0 };
    case "ArrowUp":
      return { side: 0, vertical: TIP_KEY_STEP };
    case "ArrowDown":
      return { side: 0, vertical: -TIP_KEY_STEP };
    default:
      return undefined;
  }
}

/** A cut angle in the words players use for how much of the object ball is hit. */
export function describeHit(cutAngleRad: number): string {
  const fraction = 1 - Math.sin(cutAngleRad);
  if (fraction > 0.95) return "full ball";
  if (fraction < 0.08) return "very thin";
  const names: [number, string][] = [
    [0.75, "three-quarter ball"],
    [0.5, "half ball"],
    [0.25, "quarter ball"],
  ];
  for (const [f, name] of names) if (Math.abs(fraction - f) < 0.06) return name;
  return `${fraction.toFixed(2)} of the ball`;
}

export interface AimReadout {
  /** Angle between the cue ball's line and the line of centres at contact, in [0, pi/2]. */
  cutAngleRad: number;
  /** How far the cue ball travels to the contact, metres. */
  distanceM: number;
  targetBallId: string;
}

/**
 * The cut angle and distance of the shot along the line the cue ball leaves on (the aim line
 * turned by squirt), if it meets a ball.
 */
export function aimReadout(
  scene: Scene,
  endMassRatio: number = BALL_TO_CUE_END_MASS_RATIO,
): AimReadout | undefined {
  const guide = aimGuide(scene, endMassRatio);
  const shot = scene.shot;
  if (!guide?.ghost || guide.targetBallId === undefined || !shot) return undefined;
  const target = scene.balls.find((b) => b.id === guide.targetBallId);
  if (!target) return undefined;
  const tx = Math.cos(guide.departureAngleRad);
  const ty = Math.sin(guide.departureAngleRad);
  const cx = target.x - guide.ghost.x;
  const cy = target.y - guide.ghost.y;
  const dx = guide.ghost.x - guide.from.x;
  const dy = guide.ghost.y - guide.from.y;
  return {
    cutAngleRad: Math.atan2(Math.abs(tx * cy - ty * cx), tx * cx + ty * cy),
    distanceM: Math.sqrt(dx * dx + dy * dy),
    targetBallId: guide.targetBallId,
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
