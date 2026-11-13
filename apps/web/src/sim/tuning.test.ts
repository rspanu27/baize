import { sampleAt } from "@baize/physics";
import {
  BALL_BALL_FRICTION,
  BALL_TO_CUE_END_MASS_RATIO,
  NAP_FULL_DRIFT_RATIO,
} from "@baize/tables";
import { beforeEach, describe, expect, test } from "vitest";
import { loadLayout, setShot } from "../doc/ops";
import { newDoc, resolveDoc } from "../doc/resolve";
import type { Scene } from "../doc/resolve";
import type { DiagramDoc } from "../doc/types";
import { withNap } from "../setup/cloth";
import { shareLink } from "../share/shareLink";
import { mainThreadSimulator } from "./simulator";
import {
  NO_TUNING,
  TUNING_FIELDS,
  acceptTuning,
  isTuned,
  useTuningStore,
  withTuning,
} from "./tuning";
import type { Tuning, TuningField, TuningKey } from "./tuning";
import { simulationFor } from "./useSimulation";

function field(key: TuningKey): TuningField {
  const f = TUNING_FIELDS.find((x) => x.key === key);
  if (!f) throw new Error(`no field ${key}`);
  return f;
}

function sceneOf(doc: DiagramDoc): Scene {
  const r = resolveDoc(doc);
  if (!r.ok) throw new Error(r.problems.join("; "));
  return r.scene;
}

/** A cut shot with side into a cushion: every tunable number matters to where balls stop. */
function cutShot(): DiagramDoc {
  const base = loadLayout(
    newDoc("snooker-12@1"),
    {
      balls: [
        { kind: "cue", x: 0.6, y: 1.0 },
        { kind: "red", x: 0.9, y: 1.6 },
      ],
    },
    { source: "manual", mode: "replace" },
  );
  return setShot(
    { ...base, cloth: withNap(base.cloth, "heavy") },
    { aimAngleRad: 1.08, speedMps: 2.5, tipOffset: { side: 0.3, vertical: 0.1 } },
  );
}

function rests(scene: Scene, tuning?: Tuning): string {
  const result = mainThreadSimulator.run(scene, tuning).result;
  if (!result) throw new Error("no result");
  return JSON.stringify(sampleAt(result, result.durationS + 1).map((b) => b.position));
}

beforeEach(() => {
  useTuningStore.getState().reset();
});

describe("tuning fields", () => {
  const scene = sceneOf(cutShot());

  test("standard values come from the table, the ball set and the tables package", () => {
    expect(field("cushionRestitution").standard(scene)).toBe(scene.table.cushion.restitution);
    expect(field("cushionFriction").standard(scene)).toBe(scene.table.cushion.friction);
    expect(field("ballRestitution").standard(scene)).toBe(scene.ballSet.restitution);
    expect(field("ballFrictionA").standard(scene)).toBe(BALL_BALL_FRICTION.a);
    expect(field("ballFrictionB").standard(scene)).toBe(BALL_BALL_FRICTION.b);
    expect(field("ballFrictionC").standard(scene)).toBe(BALL_BALL_FRICTION.c);
    expect(field("cueEndMassRatio").standard(scene)).toBe(BALL_TO_CUE_END_MASS_RATIO);
    expect(field("napFullRatio").standard(scene)).toBe(NAP_FULL_DRIFT_RATIO);
  });

  test("every standard value is inside its field's range", () => {
    for (const f of TUNING_FIELDS) {
      expect(acceptTuning(f, f.standard(scene)), f.key).toBe(f.standard(scene));
    }
  });

  test("values outside the range, or not numbers, are refused", () => {
    const f = field("napFullRatio");
    expect(acceptTuning(f, 0.81)).toBeUndefined();
    expect(acceptTuning(f, -0.01)).toBeUndefined();
    expect(acceptTuning(f, Number.NaN)).toBeUndefined();
    expect(acceptTuning(f, 0.8)).toBe(0.8);
  });

  test("setting a value back to standard removes the change", () => {
    const f = field("cushionFriction");
    const changed = withTuning(NO_TUNING, f, 0.4, scene);
    expect(changed).toEqual({ cushionFriction: 0.4 });
    expect(isTuned(changed)).toBe(true);
    const back = withTuning(changed, f, f.standard(scene), scene);
    expect(back).toBe(NO_TUNING);
    expect(isTuned(back)).toBe(false);
  });
});

describe("simulating with tuning", () => {
  const scene = sceneOf(cutShot());
  const standard = rests(scene);

  test("no tuning, and every value set to its standard, give the same shot", () => {
    expect(rests(scene, NO_TUNING)).toBe(standard);
    const all: Partial<Record<TuningKey, number>> = {};
    for (const f of TUNING_FIELDS) all[f.key] = f.standard(scene);
    expect(rests(scene, all)).toBe(standard);
  });

  test.each(TUNING_FIELDS.map((f) => [f.key, f] as const))(
    "changing %s changes where the balls stop",
    (_key, f) => {
      const s = f.standard(scene);
      // A clearly different value inside the range.
      const other = s * 1.5 <= f.max ? s * 1.5 : s * 0.5;
      expect(rests(scene, { [f.key]: other })).not.toBe(standard);
    },
  );

  test("the values at the ends of every range can be simulated", () => {
    for (const f of TUNING_FIELDS) {
      for (const v of [f.min, f.max]) {
        const outcome = mainThreadSimulator.run(scene, { [f.key]: v });
        expect(outcome.problem, `${f.key} = ${String(v)}`).toBeUndefined();
        expect(outcome.result?.status).toBe("complete");
      }
    }
  });
});

describe("tuning and the document", () => {
  test("the store's tuning is used by simulationFor, and resetting brings the standard shot back", () => {
    const doc = cutShot();
    const before = simulationFor(doc);
    useTuningStore.getState().setTuning({ cushionRestitution: 0.5 });
    const tuned = simulationFor(doc);
    expect(tuned).not.toBe(before);
    expect(tuned.paths).not.toEqual(before.paths);
    // Asked again with the same tuning: the cached one.
    expect(simulationFor(doc)).toBe(tuned);
    useTuningStore.getState().reset();
    expect(simulationFor(doc).paths).toEqual(before.paths);
  });

  test("tuning is not part of the link", () => {
    const doc = cutShot();
    const plain = shareLink(doc, "https://example.test/");
    useTuningStore.getState().setTuning({ ballFrictionA: 0.2, napFullRatio: 0.5 });
    expect(shareLink(doc, "https://example.test/")).toEqual(plain);
  });
});
