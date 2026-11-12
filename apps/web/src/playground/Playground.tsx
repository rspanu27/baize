import { buildTableGeometry, sampleAt, simulate } from "@baize/physics";
import type { BallInput, SimResult } from "@baize/physics";
import {
  ballSizeOf,
  getBallSet,
  getTablePreset,
  makeCloth,
  markingsFor,
  rackLayout,
} from "@baize/tables";
import type { BallKind, BallSetSpec, ClothSpeed, RackKind, TableSpec } from "@baize/tables";
import { useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent } from "react";
import { ballLook, cushionPaths, toScreen, toTable, trackLength, trackPath } from "./draw";

/**
 * A first look at the engine: one table (pool 8 ft pro), a rack, one shot.
 * Layout and styling are throwaway; the table and path drawing carry over to the editor.
 */

const TABLE_ID = "pool-8-pro@1";
const MARGIN_M = 0.17; // space around the playing area for cushions, pockets and rails
const CUSHION_DEPTH_M = 0.05; // drawn depth of the cushion rubber behind the nose
const CLOTH_COLOUR = "#1d7a5f";

type RackChoice = RackKind | "two-balls";

const RACKS: { id: RackChoice; label: string }[] = [
  { id: "pool-9ball", label: "9-ball rack" },
  { id: "pool-8ball", label: "8-ball rack" },
  { id: "pool-15", label: "15-ball rack" },
  { id: "two-balls", label: "Cue ball and one ball" },
];

interface SceneBall extends BallInput {
  kind: BallKind;
}

function useScene(rack: RackChoice): {
  balls: SceneBall[];
  error: string | undefined;
} {
  return useMemo(() => {
    const table = getTablePreset(TABLE_ID);
    const set = table ? getBallSet(table.defaultBallSetId) : undefined;
    if (!table || !set) return { balls: [], error: "The table preset is missing." };
    try {
      const layout =
        rack === "two-balls"
          ? {
              balls: [
                {
                  kind: "cue" as BallKind,
                  x: table.playingArea.widthM / 2,
                  y: table.playingArea.lengthM / 4,
                },
                {
                  kind: "1" as BallKind,
                  x: table.playingArea.widthM * 0.62,
                  y: table.playingArea.lengthM * 0.7,
                },
              ],
            }
          : rackLayout(table, set, rack);
      const balls = layout.balls.map((b, i) => {
        const size = ballSizeOf(set, b.kind);
        return {
          id: `${b.kind}-${String(i)}`,
          kind: b.kind,
          radiusM: size.diameterM / 2,
          massKg: size.massKg,
          x: b.x,
          y: b.y,
        };
      });
      return { balls, error: undefined };
    } catch (e) {
      return { balls: [], error: e instanceof Error ? e.message : String(e) };
    }
  }, [rack]);
}

interface ShotOutcome {
  result?: SimResult;
  error?: string;
  /** Wall-clock time the simulation took, in milliseconds. */
  ms: number;
}

/** Simulates one shot with the first ball as the cue ball, and times it. */
function runShot(
  table: TableSpec | undefined,
  set: BallSetSpec | undefined,
  balls: SceneBall[],
  clothSpeed: ClothSpeed,
  aimDeg: number,
  speed: number,
  side: number,
  vertical: number,
): ShotOutcome {
  const cue = balls[0];
  if (!table || !set || !cue) return { ms: 0 };
  const started = performance.now();
  try {
    const result = simulate({
      table,
      cloth: makeCloth(CLOTH_COLOUR, clothSpeed),
      balls,
      ballRestitution: set.restitution,
      shot: {
        ballId: cue.id,
        aimAngleRad: (aimDeg * Math.PI) / 180,
        speedMps: speed,
        tipOffset: { side, vertical },
      },
    });
    return { result, ms: performance.now() - started };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e), ms: performance.now() - started };
  }
}

export function Playground() {
  const table = getTablePreset(TABLE_ID);
  const set = table ? getBallSet(table.defaultBallSetId) : undefined;

  const [rack, setRack] = useState<RackChoice>("pool-9ball");
  const [clothSpeed, setClothSpeed] = useState<ClothSpeed>("medium");
  const [aimDeg, setAimDeg] = useState(90);
  const [speed, setSpeed] = useState(6);
  const [side, setSide] = useState(0);
  const [vertical, setVertical] = useState(0);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [rate, setRate] = useState(1);
  const [showAllPaths, setShowAllPaths] = useState(true);

  const { balls, error: sceneError } = useScene(rack);
  const geometry = useMemo(() => (table ? buildTableGeometry(table) : undefined), [table]);

  // Keep the tip inside the miscue limit of half a ball radius.
  const tipLength = Math.hypot(side, vertical);
  const tipScale = tipLength > 0.5 ? 0.5 / tipLength : 1;
  const tipSide = side * tipScale;
  const tipVertical = vertical * tipScale;
  const tip = { side: tipSide, vertical: tipVertical };

  const sim = useMemo(
    () => runShot(table, set, balls, clothSpeed, aimDeg, speed, tipSide, tipVertical),
    [table, set, balls, clothSpeed, aimDeg, speed, tipSide, tipVertical],
  );

  const duration = sim.result?.durationS ?? 0;

  // Any change to the shot rewinds the playback. (State is adjusted while rendering, not in
  // an effect, so there is no extra render with stale playback.)
  const [shown, setShown] = useState(sim.result);
  if (shown !== sim.result) {
    setShown(sim.result);
    setTime(0);
    setPlaying(false);
  }

  const last = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (!playing) {
      last.current = undefined;
      return;
    }
    let frame = 0;
    const tick = (now: number): void => {
      const dt = last.current === undefined ? 0 : (now - last.current) / 1000;
      last.current = now;
      setTime((t) => {
        const next = t + dt * rate;
        if (next >= duration) {
          setPlaying(false);
          return duration;
        }
        return next;
      });
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [playing, rate, duration]);

  if (!table || !set || !geometry) return <p>The table preset is missing.</p>;

  const W = table.playingArea.widthM;
  const L = table.playingArea.lengthM;
  const kindOf = new Map(balls.map((b) => [b.id, b.kind]));
  const radiusOf = new Map(balls.map((b) => [b.id, b.radiusM]));
  const now = sim.result ? sampleAt(sim.result, time) : undefined;
  const final = sim.result ? sampleAt(sim.result, duration + 1) : undefined;
  const cue = balls[0];
  const firstHit = sim.result?.events.find((e) => e.type === "ball-ball");
  const firstObjectId = firstHit?.type === "ball-ball" ? firstHit.otherBallId : undefined;
  const potted = sim.result?.events.filter((e) => e.type === "pocket") ?? [];
  const cueTrack = sim.result?.tracks[0];

  const onTableClick = (event: MouseEvent<SVGSVGElement>): void => {
    if (!cue) return;
    const svg = event.currentTarget;
    const matrix = svg.getScreenCTM();
    if (!matrix) return;
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    const target = toTable({ x: point.x, y: point.y });
    const angle = (Math.atan2(target.y - cue.y, target.x - cue.x) * 180) / Math.PI;
    setAimDeg(Math.round(((angle + 360) % 360) * 10) / 10);
  };

  const aimEnd = cue
    ? toScreen({
        x: cue.x + 0.35 * Math.cos((aimDeg * Math.PI) / 180),
        y: cue.y + 0.35 * Math.sin((aimDeg * Math.PI) / 180),
      })
    : undefined;
  const cueStart = cue ? toScreen(cue) : undefined;

  return (
    <div className="playground">
      <div className="table-wrap">
        <svg
          className="table"
          viewBox={`${String(-MARGIN_M)} ${String(-MARGIN_M)} ${String(L + 2 * MARGIN_M)} ${String(W + 2 * MARGIN_M)}`}
          onClick={onTableClick}
          role="img"
          aria-label="Pool table, seen from above. Click to aim the cue ball."
        >
          {/* Rails (wood), then the cloth bed, pockets, cushions. */}
          <rect
            x={-MARGIN_M}
            y={-MARGIN_M}
            width={L + 2 * MARGIN_M}
            height={W + 2 * MARGIN_M}
            rx={0.06}
            fill="#4a2f1c"
          />
          <rect
            x={-CUSHION_DEPTH_M}
            y={-CUSHION_DEPTH_M}
            width={L + 2 * CUSHION_DEPTH_M}
            height={W + 2 * CUSHION_DEPTH_M}
            fill={CLOTH_COLOUR}
          />
          {geometry.pockets.map((p) => {
            const c = toScreen(p.centre);
            return <circle key={p.id} cx={c.x} cy={c.y} r={p.radiusM} fill="#0d0d0d" />;
          })}
          {cushionPaths(geometry, CUSHION_DEPTH_M).map((d, i) => (
            <path key={i} d={d} fill="#17624c" stroke="#0f4a39" strokeWidth={0.003} />
          ))}

          {/* Markings: head string, spots, sights. */}
          {markingsFor(table).map((m) => {
            if (m.kind === "line") {
              const a = toScreen(m.from);
              const b = toScreen(m.to);
              return (
                <line
                  key={m.name}
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  stroke="#ffffff"
                  strokeOpacity={0.25}
                  strokeWidth={0.004}
                />
              );
            }
            if (m.kind === "spot") {
              const c = toScreen(m.at);
              return (
                <circle
                  key={m.name}
                  cx={c.x}
                  cy={c.y}
                  r={0.008}
                  fill="#ffffff"
                  fillOpacity={0.35}
                />
              );
            }
            if (m.kind === "sight") {
              // Sights sit on the nose line in the data; draw them out on the rail.
              const out = 0.11;
              const at = {
                x: m.at.x <= 0 ? -out : m.at.x >= W ? W + out : m.at.x,
                y: m.at.y <= 0 ? -out : m.at.y >= L ? L + out : m.at.y,
              };
              const c = toScreen(at);
              return <circle key={m.name} cx={c.x} cy={c.y} r={0.009} fill="#e9dcc3" />;
            }
            return null;
          })}

          {/* Paths. */}
          {sim.result?.tracks.map((track, i) => {
            const d = trackPath(track);
            if (!d) return null;
            const isCue = i === 0;
            const isFirst = track.id === firstObjectId;
            if (!showAllPaths && !isCue && !isFirst) return null;
            const look = ballLook(kindOf.get(track.id) ?? "cue");
            return (
              <path
                key={track.id}
                d={d}
                fill="none"
                stroke={isCue ? "#ffffff" : look.colour === "#141414" ? "#bbbbbb" : look.colour}
                strokeWidth={isCue || isFirst ? 0.008 : 0.004}
                strokeOpacity={isCue ? 0.95 : isFirst ? 0.9 : 0.55}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            );
          })}

          {/* Collision marks: where the cue ball first meets a ball. */}
          {firstHit?.type === "ball-ball" ? (
            <circle
              cx={toScreen(firstHit.point).x}
              cy={toScreen(firstHit.point).y}
              r={0.012}
              fill="none"
              stroke="#ffe27a"
              strokeWidth={0.004}
            />
          ) : null}

          {/* Final positions as outlines. */}
          {final?.map((b) => {
            if (b.state === "pocketed") return null;
            const c = toScreen(b.position);
            return (
              <circle
                key={`end-${b.id}`}
                cx={c.x}
                cy={c.y}
                r={radiusOf.get(b.id) ?? 0.028}
                fill="none"
                stroke="#ffffff"
                strokeOpacity={0.45}
                strokeWidth={0.003}
                strokeDasharray="0.012 0.008"
              />
            );
          })}

          {/* Aim line, shown before the shot is played. */}
          {time === 0 && cueStart && aimEnd ? (
            <line
              x1={cueStart.x}
              y1={cueStart.y}
              x2={aimEnd.x}
              y2={aimEnd.y}
              stroke="#ffe27a"
              strokeWidth={0.005}
              strokeDasharray="0.02 0.015"
            />
          ) : null}

          {/* Balls at the current time. */}
          {(
            now ??
            balls.map((b) => ({ id: b.id, state: "stationary", position: { x: b.x, y: b.y } }))
          ).map((b) => {
            if (b.state === "pocketed") return null;
            const c = toScreen(b.position);
            const r = radiusOf.get(b.id) ?? 0.028;
            const look = ballLook(kindOf.get(b.id) ?? "cue");
            return (
              <g key={b.id}>
                <circle
                  cx={c.x}
                  cy={c.y}
                  r={r}
                  fill={look.striped ? "#fbfaf2" : look.colour}
                  stroke="#000000"
                  strokeOpacity={0.35}
                  strokeWidth={0.002}
                />
                {look.striped ? <circle cx={c.x} cy={c.y} r={r * 0.68} fill={look.colour} /> : null}
                {look.label ? (
                  <>
                    <circle cx={c.x} cy={c.y} r={r * 0.42} fill="#fbfaf2" />
                    <text
                      x={c.x}
                      y={c.y}
                      fontSize={r * 0.62}
                      textAnchor="middle"
                      dominantBaseline="central"
                      fill="#111111"
                      fontWeight={700}
                    >
                      {look.label}
                    </text>
                  </>
                ) : null}
              </g>
            );
          })}
        </svg>
      </div>

      <div className="panel">
        <h1>Baize playground</h1>
        <p className="sub">
          {table.name}, {(L * 1000).toFixed(0)} × {(W * 1000).toFixed(0)} mm. Click the table to
          aim.
        </p>

        <label>
          Balls
          <select
            value={rack}
            onChange={(e) => {
              setRack(e.target.value as RackChoice);
            }}
          >
            {RACKS.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Cloth speed
          <select
            value={clothSpeed}
            onChange={(e) => {
              setClothSpeed(e.target.value as ClothSpeed);
            }}
          >
            <option value="slow">Slow</option>
            <option value="medium">Medium</option>
            <option value="fast">Fast</option>
          </select>
        </label>

        <label>
          Aim: {aimDeg.toFixed(1)}°
          <input
            type="range"
            min={0}
            max={360}
            step={0.1}
            value={aimDeg}
            onChange={(e) => {
              setAimDeg(Number(e.target.value));
            }}
          />
        </label>
        <label>
          Speed: {speed.toFixed(1)} m/s
          <input
            type="range"
            min={0.2}
            max={10}
            step={0.1}
            value={speed}
            onChange={(e) => {
              setSpeed(Number(e.target.value));
            }}
          />
        </label>
        <label>
          Side:{" "}
          {tip.side === 0
            ? "centre"
            : `${Math.abs(tip.side).toFixed(2)} ${tip.side > 0 ? "right" : "left"}`}
          <input
            type="range"
            min={-0.5}
            max={0.5}
            step={0.01}
            value={side}
            onChange={(e) => {
              setSide(Number(e.target.value));
            }}
          />
        </label>
        <label>
          Height:{" "}
          {tip.vertical === 0
            ? "centre"
            : `${Math.abs(tip.vertical).toFixed(2)} ${tip.vertical > 0 ? "above (follow)" : "below (draw)"}`}
          <input
            type="range"
            min={-0.5}
            max={0.5}
            step={0.01}
            value={vertical}
            onChange={(e) => {
              setVertical(Number(e.target.value));
            }}
          />
        </label>

        <div className="row">
          <button
            type="button"
            onClick={() => {
              if (time >= duration) setTime(0);
              setPlaying((p) => !p);
            }}
            disabled={!sim.result || duration === 0}
          >
            {playing ? "Pause" : time > 0 && time < duration ? "Resume" : "Play"}
          </button>
          <button
            type="button"
            onClick={() => {
              setPlaying(false);
              setTime(0);
            }}
          >
            Reset
          </button>
          <select
            value={rate}
            onChange={(e) => {
              setRate(Number(e.target.value));
            }}
            aria-label="Playback speed"
          >
            <option value={1}>1×</option>
            <option value={0.5}>0.5×</option>
            <option value={0.25}>0.25×</option>
            <option value={0.1}>0.1×</option>
          </select>
        </div>
        <label>
          Time: {time.toFixed(2)} of {duration.toFixed(2)} s
          <input
            type="range"
            min={0}
            max={Math.max(duration, 0.001)}
            step={0.001}
            value={Math.min(time, duration)}
            onChange={(e) => {
              setPlaying(false);
              setTime(Number(e.target.value));
            }}
          />
        </label>
        <label className="check">
          <input
            type="checkbox"
            checked={showAllPaths}
            onChange={(e) => {
              setShowAllPaths(e.target.checked);
            }}
          />
          Show every ball's path
        </label>

        {sceneError ? <p className="error">{sceneError}</p> : null}
        {sim.error ? <p className="error">{sim.error}</p> : null}
        {sim.result ? (
          <dl className="readout">
            <dt>Result</dt>
            <dd>
              {sim.result.status === "complete"
                ? "all balls at rest"
                : `stopped early: ${sim.result.status}`}
            </dd>
            <dt>Events</dt>
            <dd>{sim.result.stats.eventCount}</dd>
            <dt>Computed in</dt>
            <dd>{sim.ms.toFixed(1)} ms</dd>
            <dt>Cue ball travel</dt>
            <dd>{cueTrack ? `${trackLength(cueTrack).toFixed(2)} m` : "none"}</dd>
            <dt>Potted</dt>
            <dd>
              {potted.length === 0
                ? "nothing"
                : potted
                    .map((e) =>
                      kindOf.get(e.ballId) === "cue" ? "cue ball" : kindOf.get(e.ballId),
                    )
                    .join(", ")}
            </dd>
          </dl>
        ) : null}
        <p className="note">Physics v1: no throw, squirt, swerve or nap yet.</p>
      </div>
    </div>
  );
}
