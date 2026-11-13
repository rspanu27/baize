import { getBallSet, getTablePreset, rackLayout } from "@baize/tables";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { continueFromShot, loadLayout, placeBall, setShot } from "../doc/ops";
import { newDoc } from "../doc/resolve";
import type { DiagramDoc } from "../doc/types";
import { advance } from "../sim/usePlayback";
import type { Playback } from "../sim/usePlayback";
import { simulateDoc } from "../sim/useSimulation";
import { makeViewTransform } from "../view/transform";
import { ViewTransformContext } from "../view/viewContext";
import { PlayBar } from "./PlayBar";
import { PlaybackLayer } from "./PlaybackLayer";

function must<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`missing ${what}`);
  return value;
}

const table = must(getTablePreset("pool-9@1"), "table");
const set = must(getBallSet(table.defaultBallSetId), "set");

function racked(): DiagramDoc {
  return loadLayout(newDoc("pool-9@1"), rackLayout(table, set, "pool-9ball"), {
    source: "rack",
    mode: "replace",
  });
}

function playback(patch: Partial<Playback> = {}): Playback {
  return {
    t: undefined,
    running: false,
    rate: 1,
    play: () => undefined,
    pause: () => undefined,
    stop: () => undefined,
    seek: () => undefined,
    setRate: () => undefined,
    ...patch,
  };
}

function bar(props: {
  hasCueBall: boolean;
  hasShot: boolean;
  durationS?: number;
  playback?: Playback;
}): string {
  return renderToStaticMarkup(
    <PlayBar
      hasCueBall={props.hasCueBall}
      hasShot={props.hasShot}
      durationS={props.durationS}
      playback={props.playback ?? playback()}
      onAddShot={() => undefined}
      onContinue={() => undefined}
    />,
  );
}

describe("PlayBar", () => {
  test("says what is missing until there is a shot", () => {
    expect(bar({ hasCueBall: false, hasShot: false })).toContain("Add a cue ball");
    const noShot = bar({ hasCueBall: true, hasShot: false });
    expect(noShot).toContain("Add a shot");
    expect(noShot).not.toContain("Play shot");
  });

  test("with a shot: Play, a time slider, speeds and continue", () => {
    const html = bar({ hasCueBall: true, hasShot: true, durationS: 6.4 });
    expect(html).toContain("Play shot");
    expect(html).toContain('max="6.4"');
    expect(html).toContain("0.0 / 6.4 s");
    expect(html).toContain("Quarter speed");
    expect(html).toContain("Continue from result");
    expect(html).not.toContain("Back to setup");
  });

  test("while playing: Pause and a way back; at the end: Play again", () => {
    const running = bar({
      hasCueBall: true,
      hasShot: true,
      durationS: 6.4,
      playback: playback({ t: 2, running: true }),
    });
    expect(running).toContain("Pause");
    expect(running).toContain("Back to setup");
    const paused = bar({
      hasCueBall: true,
      hasShot: true,
      durationS: 6.4,
      playback: playback({ t: 2 }),
    });
    expect(paused).toContain("Resume");
    const ended = bar({
      hasCueBall: true,
      hasShot: true,
      durationS: 6.4,
      playback: playback({ t: 6.4 }),
    });
    expect(ended).toContain("Play again");
  });
});

describe("playback", () => {
  test("time runs at the chosen rate and stops at the end of the shot", () => {
    expect(advance(1, 0.5, 1, 6)).toEqual({ t: 1.5, running: true });
    expect(advance(1, 0.5, 0.25, 6)).toEqual({ t: 1.125, running: true });
    expect(advance(5.9, 0.5, 1, 6)).toEqual({ t: 6, running: false });
    expect(advance(1, -3, 1, 6)).toEqual({ t: 1, running: true });
  });

  test("the playback layer draws moving balls where they are, and not potted ones", () => {
    const doc = setShot(racked(), { aimAngleRad: Math.PI / 2, speedMps: 9 });
    const sim = simulateDoc(doc);
    const scene = must(sim.scene, "scene");
    const result = must(sim.outcome.result, "result");
    const view = makeViewTransform(
      { widthM: table.playingArea.widthM, lengthM: table.playingArea.lengthM },
      "landscape",
    );
    const draw = (t: number): string =>
      renderToStaticMarkup(
        <ViewTransformContext.Provider value={view}>
          <svg>
            <PlaybackLayer scene={scene} result={result} t={t} />
          </svg>
        </ViewTransformContext.Provider>,
      );
    const start = draw(0);
    expect(start.match(/data-playback-ball/g)).toHaveLength(scene.balls.length);
    const end = draw(result.durationS + 1);
    const potted = must(sim.paths, "paths").finals.filter((f) => f.pocketed).length;
    expect(end.match(/data-playback-ball/g) ?? []).toHaveLength(scene.balls.length - potted);
    expect(end).not.toBe(start);
    expect(end).not.toContain("NaN");
  });
});

describe("continueFromShot", () => {
  test("balls end where the shot left them, potted balls go, the shot is kept", () => {
    const doc = setShot(racked(), { aimAngleRad: Math.PI / 2, speedMps: 9 });
    const finals = must(simulateDoc(doc).paths, "paths").finals;
    const next = continueFromShot(doc, finals);
    const potted = finals.filter((f) => f.pocketed);
    expect(next.balls).toHaveLength(doc.balls.length - potted.length);
    for (const b of next.balls) {
      const f = must(
        finals.find((x) => x.ballId === b.id),
        "final",
      );
      expect(Math.hypot(b.x - f.position.x, b.y - f.position.y)).toBeLessThan(1e-3);
    }
    const cuePotted = potted.some((f) => f.kind === "cue");
    expect(next.shot === undefined).toBe(cuePotted);
    // The new layout is a legal one: it simulates without problems.
    expect(simulateDoc(next).problems).toEqual([]);
  });

  test("a potted cue ball takes the shot with it; nothing moving changes nothing", () => {
    const doc = setShot(racked(), { speedMps: 2 });
    const cue = must(doc.shot, "shot").cueBallId;
    const gone = continueFromShot(doc, [
      { ballId: cue, position: { x: 0, y: 0 }, pocketed: "corner-head-left" },
    ]);
    expect(gone.balls.some((b) => b.id === cue)).toBe(false);
    expect(gone.shot).toBeUndefined();
    const still = doc.balls.map((b) => ({ ballId: b.id, position: { x: b.x, y: b.y } }));
    expect(continueFromShot(doc, still)).toBe(doc);
    // A broken position is ignored rather than stored.
    const moved = placeBall(doc, cue, { x: 0.5, y: 0.5 });
    expect(continueFromShot(moved, [{ ballId: cue, position: { x: Number.NaN, y: 1 } }])).toBe(
      moved,
    );
  });
});
