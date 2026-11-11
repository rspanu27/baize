import type { Vec2 } from "../types";

export function dot(a: Vec2, b: Vec2): number {
  return a.x * b.x + a.y * b.y;
}

/** z component of the 3D cross product of two planar vectors. */
export function cross(a: Vec2, b: Vec2): number {
  return a.x * b.y - a.y * b.x;
}

export function length(a: Vec2): number {
  return Math.sqrt(a.x * a.x + a.y * a.y);
}

export function add(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x + b.x, y: a.y + b.y };
}

export function sub(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x - b.x, y: a.y - b.y };
}

export function scale(a: Vec2, s: number): Vec2 {
  return { x: a.x * s, y: a.y * s };
}

/** Unit vector in the direction of `a`, or the zero vector if `a` is zero. */
export function normalize(a: Vec2): Vec2 {
  const l = length(a);
  return l > 0 ? { x: a.x / l, y: a.y / l } : { x: 0, y: 0 };
}
