import { buildTableGeometry, sampleAt, simulate } from "@baize/physics";
import type { SimResult } from "@baize/physics";
import { getBallSet, getTablePreset, makeCloth, markingsFor } from "@baize/tables";
import type { BallKind, BallSetSpec, ClothSpeed, TableSpec } from "@baize/tables";
import { useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent } from "react";
import { ballLook, cushionPaths, toScreen, toTable, trackLength, trackPath } from "./draw";
import { freshRack, layoutAfterShot, placeCueBall } from "./play";
import type { RackChoice, SceneBall } from "./play";

/**
 * A first look at the engine: one table (pool 8 ft pro), a rack, and shot after shot from
 * wherever the balls come to rest. No rules of any game are applied.
 * Layout and styling are throwaway; the table and path drawing carry over to the editor.
 */

const TABLE_ID = "pool-8-pro@1";
const MARGIN_M = 0.17; // space around the playing area for cushions, pockets and rails
const CUSHION_DEPTH_M = 0.05; // drawn depth of the cushion rubber behind the nose
const CLOTH_COLOUR = "#1d7a5f";

const RACKS: { id: RackChoice; label: string }[] = [
  { id: "pool-9ball", label: "9-ball rack" },
  { id: "pool-8ball", label: "8-ball rack" },
  { id: "pool-15", label: "15-ball rack" },
  { id: "two-balls", label: "Cue ball and one ball" },
];

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
  if (!table || !set || cue?.kind !== "cue") return { ms: 0 };
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

function initialBalls(rack: RackChoice): SceneBall[] {
  const table = getTablePreset(TABLE_ID);
  const set = table ? getBallSet(table.defaultBallSetId) : undefined;
  return table && set ? freshRack(table, set, rack) : [];
}

function ballName(kind: BallKind): string {
  return kind === "cue" ? "cue ball" : kind;
}

const START_MESSAGE = "Aim by clicking the table, then press Shoot.";

export function Playground() {
  const table = getTablePreset(TABLE_ID);
  const set = table ? getBallSet(table.defaultBallSetId) : undefined;

  const [rack, setRack] = useState<RackChoice>("pool-9ball");
  const [balls, setBalls] = useState<SceneBall[]>(() => initialBalls("pool-9ball"));
  const [pottedSoFar, setPottedSoFar] = useState<BallKind[]>([]);
  const [shots, setShots] = useState(0);
  const [message, setMessage] = useState(START_MESSAGE);
  const [placing, setPlacing] = useState(false);

  const [clothSpeed, setClothSpeed] = useState<ClothSpeed>("medium");
  const [aimDeg, setAimDeg] = useState(90);
  const [speed, setSpeed] = useState(6);
  const [side, setSide] = useState(0);
  const [vertical, setVertical] = useState(0);
  const [showAllPaths, setShowAllPaths] = useState(true);

  // The shot being played, frozen at the moment Shoot was pressed. Undefined while aiming.
  const [running, setRunning] = useState<SimResult | undefined>(undefined);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [rate, setRate] = useState(1);

  const geometry = useMemo(() => (table ? buildTableGeometry(table) : undefined), [table]);

  // Keep the tip inside the miscue limit of half a ball radius.
  const tipLength = Math.hypot(side, vertical);
  const tipScale = tipLength > 0.5 ? 0.5 / tipLength : 1;
  const tipSide = side * tipScale;
  const tipVertical = vertical * tipScale;

  // Live preview of the shot being aimed.
  const preview = useMemo(
    () => runShot(table, set, balls, clothSpeed, aimDeg, speed, tipSide, tipVertical),
    [table, set, balls, clothSpeed, aimDeg, speed, tipSide, tipVertical],
  );

  const shown = running ?? preview.result;
  const duration = shown?.durationS ?? 0;

  /** The running shot is over: the table carries on from where the balls stopped. */
  const finishShot = (): void => {
    if (!running || !table || !set) return;
    const after = layoutAfterShot(running, balls, table, set);
    setBalls(after.balls);
    setPottedSoFar((p) => [...p, ...after.potted]);
    setShots((n) => n + 1);
    setRunning(undefined);
    setPlaying(false);
    setTime(0);
    setPlacing(after.scratch);
    const down =
      after.potted.length > 0 ? `Potted: ${after.potted.join(", ")}.` : "Nothing potted.";
    const objectBalls = after.balls.filter((b) => b.kind !== "cue").length;
    setMessage(
      after.scratch
        ? `${down} The cue ball went in and is back on the head spot. Click the table to place it, then press Done.`
        : objectBalls === 0
          ? `${down} The table is clear. Press Re-rack to play again.`
          : `${down} Aim the next shot.`,
    );
  };
  const finishRef = useRef(finishShot);
  useEffect(() => {
    finishRef.current = finishShot;
  });

  // Playback clock. When it reaches the end of the shot, the shot is finished.
  const last = useRef<number | undefined>(undefined);
  const clock = useRef(0);
  useEffect(() => {
    if (!playing) {
      last.current = undefined;
      return;
    }
    let frame = 0;
    const tick = (now: number): void => {
      const dt = last.current === undefined ? 0 : (now - last.current) / 1000;
      last.current = now;
      clock.current += dt * rate;
      if (clock.current >= duration) {
        finishRef.current();
        return;
      }
      setTime(clock.current);
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
  const cue = balls[0]?.kind === "cue" ? balls[0] : undefined;
  const aiming = running === undefined;
  const now = running ? sampleAt(running, time) : undefined;
  const final = shown ? sampleAt(shown, duration + 1) : undefined;
  const firstHit = shown?.events.find((e) => e.type === "ball-ball");
  const firstObjectId = firstHit?.type === "ball-ball" ? firstHit.otherBallId : undefined;
  const shotPots = shown?.events.filter((e) => e.type === "pocket") ?? [];
  const cueTrack = shown?.tracks[0];
  const objectBallsLeft = balls.filter((b) => b.kind !== "cue").length;

  const reRack = (choice: RackChoice): void => {
    setRack(choice);
    setBalls(freshRack(table, set, choice));
    setPottedSoFar([]);
    setShots(0);
    setRunning(undefined);
    setPlaying(false);
    setTime(0);
    setPlacing(false);
    setAimDeg(90);
    setMessage(START_MESSAGE);
  };

  const shoot = (): void => {
    if (!preview.result || preview.result.durationS === 0) return;
    clock.current = 0;
    setTime(0);
    setRunning(preview.result);
    setPlaying(true);
    setPlacing(false);
    setMessage("Shot in progress.");
  };

  const onTableClick = (event: MouseEvent<SVGSVGElement>): void => {
    if (!aiming || !cue) return;
    const matrix = event.currentTarget.getScreenCTM();
    if (!matrix) return;
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    const target = toTable({ x: point.x, y: point.y });
    if (placing) {
      setBalls(placeCueBall(balls, target, table, set));
      return;
    }
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
  const drawn =
    now ?? balls.map((b) => ({ id: b.id, state: "stationary", position: { x: b.x, y: b.y } }));

  return (
    <div className="playground">
      <div className="table-wrap">
        <svg
          className={placing ? "table placing" : "table"}
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

          {/* Paths of the shot being aimed or played. */}
          {placing
            ? null
            : shown?.tracks.map((track, i) => {
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

          {/* Where the cue ball first meets a ball. */}
          {!placing && firstHit?.type === "ball-ball" ? (
            <circle
              cx={toScreen(firstHit.point).x}
              cy={toScreen(firstHit.point).y}
              r={0.012}
              fill="none"
              stroke="#ffe27a"
              strokeWidth={0.004}
            />
          ) : null}

          {/* Where each ball will come to rest. */}
          {placing
            ? null
            : final?.map((b) => {
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

          {/* Aim line while aiming. */}
          {aiming && !placing && cueStart && aimEnd ? (
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

          {/* Balls: where they are now. */}
          {drawn.map((b) => {
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
          {table.name}, {(L * 1000).toFixed(0)} × {(W * 1000).toFixed(0)} mm.
        </p>
        <p className="message" role="status">
          {message}
        </p>

        <div className="row">
          {aiming && placing ? (
            <button
              type="button"
              className="primary"
              onClick={() => {
                setPlacing(false);
                setMessage("Aim the next shot.");
              }}
            >
              Done
            </button>
          ) : null}
          {aiming && !placing ? (
            <>
              <button
                type="button"
                className="primary"
                onClick={shoot}
                disabled={!preview.result || preview.result.durationS === 0 || !cue}
              >
                Shoot
              </button>
              <button
                type="button"
                onClick={() => {
                  setPlacing(true);
                  setMessage("Click the table to place the cue ball, then press Done.");
                }}
              >
                Move cue ball
              </button>
            </>
          ) : null}
          {!aiming ? (
            <>
              <button
                type="button"
                className="primary"
                onClick={() => {
                  setPlaying((p) => !p);
                }}
              >
                {playing ? "Pause" : "Resume"}
              </button>
              <button type="button" onClick={finishShot}>
                Skip to end
              </button>
            </>
          ) : null}
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

        <fieldset disabled={!aiming}>
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
            {tipSide === 0
              ? "centre"
              : `${Math.abs(tipSide).toFixed(2)} ${tipSide > 0 ? "right" : "left"}`}
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
            {tipVertical === 0
              ? "centre"
              : `${Math.abs(tipVertical).toFixed(2)} ${tipVertical > 0 ? "above (follow)" : "below (draw)"}`}
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
        </fieldset>

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

        <div className="row">
          <select
            value={rack}
            onChange={(e) => {
              reRack(e.target.value as RackChoice);
            }}
            aria-label="Balls"
          >
            {RACKS.map((r) => (
              <option key={r.id} value={r.id}>
                {r.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => {
              reRack(rack);
            }}
          >
            Re-rack
          </button>
        </div>

        {preview.error ? <p className="error">{preview.error}</p> : null}
        <dl className="readout">
          <dt>Shots played</dt>
          <dd>{shots}</dd>
          <dt>Balls left</dt>
          <dd>{objectBallsLeft}</dd>
          <dt>Potted so far</dt>
          <dd>{pottedSoFar.length === 0 ? "nothing" : pottedSoFar.join(", ")}</dd>
          {shown ? (
            <>
              <dt>{aiming ? "This shot would pot" : "This shot pots"}</dt>
              <dd>
                {shotPots.length === 0
                  ? "nothing"
                  : shotPots.map((e) => ballName(kindOf.get(e.ballId) ?? "cue")).join(", ")}
              </dd>
              <dt>Cue ball travel</dt>
              <dd>{cueTrack ? `${trackLength(cueTrack).toFixed(2)} m` : "none"}</dd>
              <dt>Shot length</dt>
              <dd>
                {aiming
                  ? `${duration.toFixed(1)} s`
                  : `${time.toFixed(1)} of ${duration.toFixed(1)} s`}
              </dd>
              <dt>Events</dt>
              <dd>
                {shown.stats.eventCount}
                {aiming ? `, computed in ${preview.ms.toFixed(1)} ms` : ""}
              </dd>
            </>
          ) : null}
        </dl>
        <p className="note">
          No rules are applied. Physics v1: no throw, squirt, swerve or nap yet.
        </p>
      </div>
    </div>
  );
}
