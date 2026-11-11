# @baize/physics

Event-based pool and snooker physics for any table and cloth. Zero runtime dependencies, deterministic, SI units.

Instead of stepping time, the simulator solves for the next event exactly (a collision, a pocket, or a ball changing from sliding to rolling to rest), so fast balls cannot tunnel through each other and the same input always gives a bit-identical result.

## Use

```ts
import { simulate, sampleAt, prepareTable } from "@baize/physics";

// Describe the table. Any object with these fields works; `@baize/tables` has presets.
const table = prepareTable({
  playingArea: { lengthM: 2.54, widthM: 1.27 },
  pockets: {
    corner: {
      mouthM: 0.114,
      jawRadiusM: 0.002,
      facingAngleRad: 2.478,
      dropRadiusM: 0.066,
      dropSetbackM: 0.057,
    },
    middle: {
      mouthM: 0.127,
      jawRadiusM: 0.002,
      facingAngleRad: 1.815,
      dropRadiusM: 0.072,
      dropSetbackM: 0.064,
    },
  },
  cushion: { noseHeightM: 0.0363, restitution: 0.85, friction: 0.2 },
});

const result = simulate({
  table,
  cloth: { slidingFriction: 0.2, rollingResistance: 0.01, spinningFriction: 0.0127 },
  ballRestitution: 0.94,
  balls: [
    { id: "cue", radiusM: 0.028575, massKg: 0.163, x: 0.635, y: 0.6 },
    { id: "one", radiusM: 0.028575, massKg: 0.163, x: 0.7, y: 1.6 },
  ],
  shot: {
    ballId: "cue",
    aimAngleRad: 1.5, // counter-clockwise from +x
    speedMps: 2, // cue-ball speed just after the strike
    tipOffset: { side: 0, vertical: -0.2 }, // fractions of the ball radius
  },
});

result.status; // "complete", or "eventLimit" / "timeLimit" with a partial result
result.events; // strike, transition, ball-ball, ball-cushion, pocket, in time order
result.tracks; // per ball: constant-acceleration segments (exact quadratic paths)
sampleAt(result, 0.5); // position, velocity, spin and state of every ball at t = 0.5 s
```

## Coordinates and units

Metres, seconds, kilograms, radians. The origin is the baulk/head-end left corner of the playing area (the rectangle bounded by the cushion noses). `x` runs across the width, `y` along the length, `z` up. Angles are counter-clockwise from `+x`.

## What is modelled (version 1)

- Sliding, rolling and spinning on the cloth, with friction coefficients supplied by the caller.
- Ball-ball collisions: instantaneous and frictionless with restitution, unequal masses and radii supported. There is no throw yet.
- Cushions: an impulse at the cushion nose with restitution and friction, so side spin and the nose height both matter.
- Pockets: real jaw geometry generated from the table description; a ball is potted when its centre crosses the drop circle.
- Cue strike: level cue, tip offset gives follow, draw and side spin. No squirt, swerve or elevation yet.
- Touching balls and tight racks.

## Limits to know about

- Balls slower than 1 cm/s after a collision are put to rest (they would move less than a millimetre). Closing speeds below 1 cm/s do not rebound.
- When several balls touch at exactly the same instant, contacts are resolved one pair at a time in a fixed order. This is deterministic and never adds energy, but it is not the unique physical answer.
- Results very close to the pocket jaws are approximate: there is no slate-edge or shelf physics.
- Invalid input throws `SimInputError` with a `code`. Hitting `maxEvents` or `maxTimeS` does not throw.

See `docs/ARCHITECTURE.md` in the repository for the design and the reasoning behind it.
