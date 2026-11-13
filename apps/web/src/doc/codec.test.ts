import { simulate } from "@baize/physics";
import { TABLE_PRESETS, getBallSet, getTablePreset, makeCloth, rackLayout } from "@baize/tables";
import { describe, expect, test } from "vitest";
import { decodeDoc, docFromHash, docToHash, encodeDoc } from "./codec";
import { runMigrations } from "./migrations";
import type { MigrationTable } from "./migrations";
import { loadLayout, setShot } from "./ops";
import { newDoc, resolveDoc } from "./resolve";
import type { DiagramDoc } from "./types";

function must<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`missing ${what}`);
  return value;
}

const pool9 = must(getTablePreset("pool-9@1"), "pool-9");
const poolSet = must(getBallSet("pool-57@1"), "pool set");

function racked(): DiagramDoc {
  return setShot(
    loadLayout(newDoc("pool-9@1"), rackLayout(pool9, poolSet, "pool-9ball"), {
      source: "rack",
      mode: "replace",
    }),
    { aimAngleRad: 1.2345678901234567, speedMps: 3.25, tipOffset: { side: 0.1, vertical: -0.2 } },
  );
}

function photoDoc(): DiagramDoc {
  const base = loadLayout(
    newDoc("pool-9@1"),
    {
      balls: [
        { kind: "cue", x: 0.5, y: 0.5 },
        { kind: "3", x: 0.8, y: 1.5, confidence: 0.4 },
        { kind: "8", x: 0.6, y: 2.1, confidence: 0.85 },
      ],
    },
    { source: "photo", mode: "replace" },
  );
  return {
    ...base,
    ballSet: { preset: "pool-57@1", diameterM: 0.0572, cueDiameterM: 0.0571 },
    cloth: {
      colour: "#2a6f9e",
      speedPreset: "custom",
      slidingFriction: 0.21,
      rollingResistance: 0.0123,
      spinningFriction: 0.0111,
      nap: { directionRad: Math.PI / 2, strength: 0.3 },
    },
    annotations: [
      { kind: "measure", id: "m1", from: { x: 0.4, y: 0.6 }, to: { x: 0.9123456, y: 1.7 } },
    ],
    style: { showAllPaths: true },
  };
}

function customDoc(): DiagramDoc {
  return {
    ...newDoc("pool-9@1"),
    table: {
      custom: {
        game: "pool",
        lengthM: 2.2,
        widthM: 1.1,
        cornerMouthM: 0.115,
        middleMouthM: 0.125,
        jawStyle: "rounded",
      },
    },
    balls: [{ id: "b1", kind: "cue", x: 0.55, y: 0.5 }],
  };
}

/** The input with positions and rounded values replaced by the decoded ones, once they are close. */
function expectRoundTrip(input: DiagramDoc, output: DiagramDoc): void {
  expect(output.balls).toHaveLength(input.balls.length);
  const balls = input.balls.map((b, i) => {
    const o = must(output.balls[i], "ball");
    expect(Math.abs(o.x - b.x)).toBeLessThanOrEqual(5e-6 + 1e-12);
    expect(Math.abs(o.y - b.y)).toBeLessThanOrEqual(5e-6 + 1e-12);
    if (b.confidence !== undefined) {
      expect(Math.abs(must(o.confidence, "confidence") - b.confidence)).toBeLessThanOrEqual(1e-6);
    }
    return {
      ...b,
      x: o.x,
      y: o.y,
      ...(o.confidence === undefined ? {} : { confidence: o.confidence }),
    };
  });
  const annotations = input.annotations.map((a, i) => {
    const o = must(output.annotations[i], "annotation");
    for (const k of ["from", "to"] as const) {
      expect(Math.abs(o[k].x - a[k].x)).toBeLessThanOrEqual(5e-6 + 1e-12);
      expect(Math.abs(o[k].y - a[k].y)).toBeLessThanOrEqual(5e-6 + 1e-12);
    }
    return { ...a, from: o.from, to: o.to };
  });
  let shot = input.shot;
  if (input.shot) {
    const o = must(output.shot, "shot");
    expect(o.aimAngleRad).toBe(input.shot.aimAngleRad);
    expect(Math.abs(o.speedMps - input.shot.speedMps)).toBeLessThanOrEqual(1e-6);
    expect(Math.abs(o.tipOffset.side - input.shot.tipOffset.side)).toBeLessThanOrEqual(1e-6);
    expect(Math.abs(o.tipOffset.vertical - input.shot.tipOffset.vertical)).toBeLessThanOrEqual(
      1e-6,
    );
    shot = { ...input.shot, speedMps: o.speedMps, tipOffset: o.tipOffset };
  }
  expect(output).toEqual({ ...input, balls, annotations, ...(shot ? { shot } : {}) });
}

async function roundTrip(doc: DiagramDoc): Promise<string> {
  const text = await encodeDoc(doc);
  const decoded = await decodeDoc(text);
  if (!decoded.ok) throw new Error(decoded.problem);
  expectRoundTrip(doc, decoded.doc);
  // The encoding is stable: the decoded document encodes to the same text.
  expect(await encodeDoc(decoded.doc)).toBe(text);
  return text;
}

describe("round trip", () => {
  test("an empty document", async () => {
    const doc = newDoc("pool-9@1");
    const text = await roundTrip(doc);
    expect(text).toMatch(/^v2\.[cu]\.[A-Za-z0-9_-]+$/);
    expect((await decodeDoc(text)).ok && (await decodeDoc(text))).toMatchObject({ doc });
  });

  test("a racked 9-ball document with a shot", async () => {
    await roundTrip(racked());
  });

  test("a custom table", async () => {
    await roundTrip(customDoc());
  });

  test("a photo source, confidences, a measure, custom cloth with nap, and style", async () => {
    await roundTrip(photoDoc());
  });

  test("cloth that names a speed stores just the name; odd labels survive", async () => {
    const slow = { ...newDoc("pool-9@1"), cloth: makeCloth("#123456", "slow") };
    await roundTrip(slow);
    const odd = {
      ...newDoc("pool-9@1"),
      cloth: { ...makeCloth("#123456", "fast"), slidingFriction: 0.5 },
    };
    await roundTrip(odd);
    const customLooksLikeMedium = {
      ...newDoc("pool-9@1"),
      cloth: { ...makeCloth("#123456", "medium"), speedPreset: "custom" as const },
    };
    await roundTrip(customLooksLikeMedium);
  });

  test("a document without a source or with an empty style", async () => {
    const noSource = newDoc("pool-9@1");
    delete noSource.source;
    await roundTrip(noSource);
    await roundTrip({ ...newDoc("pool-9@1"), style: {} });
  });

  test("the aim angle survives bit for bit", async () => {
    for (const angle of [0.1 + 0.2, Math.PI / 3, -2.718281828459045, 1e-300, 6.283185307179586]) {
      const doc = setShot(racked(), { aimAngleRad: angle });
      const decoded = await decodeDoc(await encodeDoc(doc));
      expect(decoded.ok && decoded.doc.shot?.aimAngleRad).toBe(angle);
    }
  });

  test("a racked document is short", async () => {
    const text = await encodeDoc(racked());
    expect(text.length).toBeLessThan(600);
  });

  test("the uncompressed fallback round trips and is marked u", async () => {
    for (const doc of [racked(), photoDoc(), customDoc()]) {
      const text = await encodeDoc(doc, { compression: "off" });
      expect(text.startsWith("v2.u.")).toBe(true);
      const decoded = await decodeDoc(text);
      if (!decoded.ok) throw new Error(decoded.problem);
      expectRoundTrip(doc, decoded.doc);
    }
    expect((await encodeDoc(racked())).startsWith("v2.c.")).toBe(true);
  });

  test("touching balls stay legal for the simulator after quantisation", async () => {
    const decoded = await decodeDoc(await encodeDoc(racked()));
    if (!decoded.ok) throw new Error(decoded.problem);
    const r = resolveDoc(decoded.doc);
    if (!r.ok) throw new Error(r.problems.join(" "));
    const s = r.scene;
    expect(() =>
      simulate({
        table: s.table,
        cloth: s.cloth,
        balls: s.balls,
        ballRestitution: s.ballSet.restitution,
      }),
    ).not.toThrow();
  });
});

describe("hash helpers", () => {
  test("docToHash and docFromHash agree; unrelated hashes are ignored", async () => {
    const doc = racked();
    const hash = await docToHash(doc);
    expect(hash.startsWith("#v2.")).toBe(true);
    const back = await docFromHash(hash);
    expect(back?.ok).toBe(true);
    expect(await docFromHash("")).toBeUndefined();
    expect(await docFromHash("#")).toBeUndefined();
    expect(await docFromHash("#section-2")).toBeUndefined();
    expect((await docFromHash("#v1.c.!!"))?.ok).toBe(false);
  });
});

/** A small deterministic generator (linear congruential), so the tests are reproducible. */
function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function randomDoc(rand: () => number): DiagramDoc {
  const pick = <T>(items: readonly T[]): T =>
    must(items[Math.floor(rand() * items.length)], "item");
  const table = pick(TABLE_PRESETS);
  const ballSet = must(getBallSet(table.defaultBallSetId), "ball set");
  const w = table.playingArea.widthM;
  const l = table.playingArea.lengthM;
  const balls = Array.from({ length: Math.floor(rand() * 17) }, () => ({
    kind: pick(ballSet.kinds).kind,
    x: rand() * w,
    y: rand() * l,
    ...(rand() < 0.3 ? { confidence: rand() } : {}),
  }));
  let doc = loadLayout(
    newDoc(table.id),
    { balls },
    { source: rand() < 0.3 ? "photo" : "manual", mode: "replace" },
  );
  if (rand() < 0.6) {
    doc = setShot(doc, {
      aimAngleRad: (rand() - 0.5) * 20,
      speedMps: 0.1 + rand() * 6,
      tipOffset: { side: (rand() - 0.5) * 0.7, vertical: (rand() - 0.5) * 0.7 },
    });
  }
  if (rand() < 0.4) {
    doc = {
      ...doc,
      annotations: Array.from({ length: 1 + Math.floor(rand() * 3) }, (_, i) => ({
        kind: "measure" as const,
        id: `m${String(i + 1)}`,
        from: { x: rand() * w, y: rand() * l },
        to: { x: rand() * w, y: rand() * l },
      })),
    };
  }
  if (rand() < 0.3) doc = { ...doc, style: { showAllPaths: rand() < 0.5 } };
  if (rand() < 0.4) {
    doc = {
      ...doc,
      style: {
        ...doc.style,
        ...(rand() < 0.5 ? { theme: pick(["print", "dark"] as const) } : {}),
        ...(rand() < 0.5 ? { pathLine: pick(["dashed", "dotted"] as const) } : {}),
        ...(rand() < 0.5 ? { pathWeight: pick(["thin", "thick"] as const) } : {}),
        ...(rand() < 0.5 ? { ballLabels: false } : {}),
        ...(rand() < 0.5
          ? { caption: `Drill ${String(Math.floor(rand() * 1000))}: "stun" & roll é` }
          : {}),
      },
    };
  }
  if (rand() < 0.3)
    doc = { ...doc, cloth: makeCloth("#336699", pick(["slow", "medium", "fast"] as const)) };
  return doc;
}

describe("generated documents", () => {
  test("200 pseudo-random valid documents round trip", async () => {
    const rand = lcg(20240607);
    let withShot = 0;
    for (let i = 0; i < 200; i++) {
      const doc = randomDoc(rand);
      if (doc.shot) withShot++;
      await roundTrip(doc);
    }
    expect(withShot).toBeGreaterThan(20);
  });
});

describe("rejections", () => {
  async function pack(compact: unknown): Promise<string> {
    // Build a "u" link by hand from any JSON value.
    const bytes = new TextEncoder().encode(JSON.stringify(compact));
    let binary = "";
    for (const b of bytes) binary += String.fromCharCode(b);
    return `v1.u.${btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}`;
  }

  async function validCompact(): Promise<Record<string, unknown>> {
    const text = await encodeDoc(racked(), { compression: "off" });
    const payload = must(text.split(".")[2], "payload");
    const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    return JSON.parse(json) as Record<string, unknown>;
  }

  async function expectRejected(text: string): Promise<void> {
    const result = await decodeDoc(text);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.problem.length).toBeGreaterThan(0);
      expect(result.problem.endsWith(".")).toBe(true);
    }
  }

  test("empty, garbage and wrong versions", async () => {
    await expectRejected("");
    await expectRejected("   ");
    await expectRejected("hello world");
    await expectRejected("v1");
    await expectRejected("v1.c");
    await expectRejected("v1.x.AAAA");
    await expectRejected("v1.c.!!!!");
    await expectRejected("v1.u.A");
    await expectRejected("v0.u.e30");
    const newer = await decodeDoc("v9.c.xxxx");
    expect(newer).toEqual({
      ok: false,
      problem: "This link was made by a newer version of Baize.",
    });
  });

  test("truncated links, compressed and plain", async () => {
    for (const compression of ["auto", "off"] as const) {
      const text = await encodeDoc(racked(), { compression });
      for (const cut of [
        5,
        6,
        8,
        12,
        30,
        Math.floor(text.length / 2),
        text.length - 10,
        text.length - 1,
      ]) {
        const result = await decodeDoc(text.slice(0, cut));
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.problem.length).toBeGreaterThan(0);
      }
    }
  });

  test("valid base64 of text that is not JSON, and of JSON that is not a diagram", async () => {
    await expectRejected(`v1.u.${btoa("not json at all").replace(/=+$/, "")}`);
    await expectRejected(await pack([1, 2, 3]));
    await expectRejected(await pack(null));
    await expectRejected(await pack("text"));
    await expectRejected(await pack({}));
  });

  test("a ball kind that does not exist", async () => {
    const c = await validCompact();
    const balls = c.b as unknown[][];
    await expectRejected(
      await pack({ ...c, b: [[...must(balls[0], "ball").slice(0, 1), "purple", 1, 1]] }),
    );
  });

  test("duplicate ball ids", async () => {
    const c = await validCompact();
    const balls = c.b as unknown[][];
    const first = must(balls[0], "ball");
    await expectRejected(await pack({ ...c, b: [first, first] }));
  });

  test("a shot pointing at a missing ball", async () => {
    const c = await validCompact();
    const shot = c.h as unknown[];
    await expectRejected(await pack({ ...c, h: ["nope", ...shot.slice(1)] }));
  });

  test("numbers that are not finite or not numbers", async () => {
    const c = await validCompact();
    const shot = c.h as unknown[];
    const balls = c.b as unknown[][];
    // JSON cannot carry NaN or Infinity, so they arrive as null or as text.
    await expectRejected(await pack({ ...c, h: [shot[0], null, 0, 0, 2] }));
    await expectRejected(await pack({ ...c, h: [shot[0], "1.5", 0, 0, 2] }));
    await expectRejected(await pack({ ...c, h: [shot[0], 1, 0, 0, 0] }));
    await expectRejected(
      await pack({ ...c, b: [[...must(balls[0], "ball").slice(0, 2), null, 5]] }),
    );
    await expectRejected(
      await pack({ ...c, b: [[...must(balls[0], "ball").slice(0, 2), 1.5, 5]] }),
    );
    // 1e999 is valid JSON text that parses to Infinity.
    const text = JSON.stringify({ ...c, h: [shot[0], 0, 0, 0, 2] }).replace("2]", "1e999]");
    const bytes = new TextEncoder().encode(text);
    let binary = "";
    for (const b of bytes) binary += String.fromCharCode(b);
    await expectRejected(`v1.u.${btoa(binary).replace(/=+$/, "")}`);
  });

  test("unknown extra keys are ignored", async () => {
    const c = await validCompact();
    const result = await decodeDoc(await pack({ ...c, zzz: { anything: [1, 2] } }));
    expect(result.ok).toBe(true);
  });
});

describe("migrations", () => {
  test("the loop applies one step per version, in order", () => {
    const table: MigrationTable = {
      1: (c) => ({ ...(c as object), step1: true }),
      2: (c) => ({ ...(c as object), step2: "after step1" in (c as object) }),
      3: (c) => ({ ...(c as object), step3: true }),
    };
    expect(runMigrations(table, 4, 1, { a: 1 })).toEqual({
      ok: true,
      compact: { a: 1, step1: true, step2: false, step3: true },
    });
    expect(runMigrations(table, 4, 3, { a: 1 })).toEqual({
      ok: true,
      compact: { a: 1, step3: true },
    });
    expect(runMigrations(table, 4, 4, { a: 1 })).toEqual({ ok: true, compact: { a: 1 } });
  });

  test("newer, unknown, missing-step and failing migrations give a problem", () => {
    const table: MigrationTable = {
      1: (c) => c,
      3: () => {
        throw new Error("boom");
      },
    };
    const newer = runMigrations(table, 3, 4, {});
    expect(!newer.ok && newer.problem).toMatch(/newer version/);
    expect(runMigrations(table, 4, 2, {}).ok).toBe(false);
    expect(runMigrations(table, 4, 3, {}).ok).toBe(false);
    expect(runMigrations(table, 4, 0, {}).ok).toBe(false);
    expect(runMigrations(table, 4, 1.5, {}).ok).toBe(false);
  });
});

describe("schema version 2", () => {
  // Written by the version 1 encoder (commit fa54b71) for the document below.
  const V1_PLAIN =
    "v1.u.eyJ0Ijoic25vb2tlci0xMkAxIiwicyI6InNub29rZXItNTJAMSIsImsiOnsiYyI6IiMyYTZmOWUiLCJrIjpbMC4yMSwwLjAxMjMsMC4wMTExXSwibiI6WzEuNTcwNzk2MzI2Nzk0ODk2NiwwLjVdfSwiYiI6W1siYjEiLCJjdWUiLDUwMDAwLDUwMDAwXSxbImIyIiwicmVkIiw4MDAwMCwxNTAwMDAsMC40XSxbImIzIiwiYmxhY2siLDYwMDAwLDIxMDAwMF1dLCJoIjpbImIxIiwxLjIzNDUsMC4yNSwtMC4xLDIuNV0sImEiOltbIm0iLCJtMSIsNDAwMDAsNjAwMDAsOTEyMzQsMTcwMDAwXV0sIm8iOjEsInkiOnsiYSI6dHJ1ZX19";
  const V1_PACKED =
    "v1.c.TY_BasMwEET_ZXqdiN21JMc69T-ED7arUnATg5McSvC_l0gUetmFecxb9ok7Em7XbVvLflJ7VxC3f1Fo0Yr0xIKEN5vi51BalMWZUpyodXWpjsQVKasLvfRD7Cz2gz8PMVJcGA9iRsoZ80u6PAoYRETaHJkxG4i9fIDnCrRxcb7SDsT8PS0rGCswrc2R-EJqXnXW-UBxFngSpzQXRmKqhy8gLgr62m6OQa3z1P7PtCEp8fN6eUK6749yHL8";
  const expected: DiagramDoc = {
    schemaVersion: 2,
    table: {
      preset: "snooker-12@1",
    },
    ballSet: {
      preset: "snooker-52@1",
    },
    cloth: {
      colour: "#2a6f9e",
      speedPreset: "custom",
      slidingFriction: 0.21,
      rollingResistance: 0.0123,
      spinningFriction: 0.0111,
      nap: {
        directionRad: 1.5707963267948966,
        strength: 0.5,
      },
    },
    balls: [
      {
        id: "b1",
        kind: "cue",
        x: 0.5,
        y: 0.5,
      },
      {
        id: "b2",
        kind: "red",
        x: 0.8,
        y: 1.5,
        confidence: 0.4,
      },
      {
        id: "b3",
        kind: "black",
        x: 0.6,
        y: 2.1,
      },
    ],
    annotations: [
      {
        kind: "measure",
        id: "m1",
        from: {
          x: 0.4,
          y: 0.6,
        },
        to: {
          x: 0.91234,
          y: 1.7,
        },
      },
    ],
    source: {
      kind: "photo",
    },
    shot: {
      cueBallId: "b1",
      aimAngleRad: 1.2345,
      tipOffset: {
        side: 0.25,
        vertical: -0.1,
      },
      speedMps: 2.5,
    },
    style: {
      showAllPaths: true,
    },
  };

  test("links made before version 2 open as the same document", async () => {
    for (const link of [V1_PLAIN, V1_PACKED]) {
      const decoded = await decodeDoc(link);
      if (!decoded.ok) throw new Error(decoded.problem);
      expectRoundTrip(expected, decoded.doc);
      expect(decoded.doc.schemaVersion).toBe(2);
      // Nothing was added to the style: it is drawn as it always was.
      expect(decoded.doc.style).toEqual({ showAllPaths: true });
    }
  });

  test("every style field round trips, and defaults are not written", async () => {
    const styled: DiagramDoc = {
      ...newDoc("pool-9@1"),
      style: {
        showAllPaths: true,
        theme: "print",
        pathLine: "dotted",
        pathWeight: "thick",
        ballLabels: false,
        caption: "Stop shot: 3 ball to the corner",
      },
    };
    const text = await encodeDoc(styled, { compression: "off" });
    const decoded = await decodeDoc(text);
    if (!decoded.ok) throw new Error(decoded.problem);
    expect(decoded.doc.style).toEqual(styled.style);

    const defaults: DiagramDoc = {
      ...newDoc("pool-9@1"),
      style: { theme: "table", pathLine: "solid", pathWeight: "normal", ballLabels: true },
    };
    const back = await decodeDoc(await encodeDoc(defaults, { compression: "off" }));
    if (!back.ok) throw new Error(back.problem);
    expect(back.doc.style).toEqual({});
  });

  test("unknown style codes and over-long captions are refused", async () => {
    const link = (y: unknown): string => {
      const json = JSON.stringify({
        t: "pool-9@1",
        s: "pool-57@1",
        k: { c: "#1f6b3a", k: "medium" },
        b: [],
        y,
      });
      return `v2.u.${btoa(json).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}`;
    };
    expect((await decodeDoc(link({ t: "p" }))).ok).toBe(true);
    for (const y of [
      { t: "x" },
      { l: "solid" },
      { w: 3 },
      { n: 1 },
      { c: "" },
      { c: 7 },
      { c: "x".repeat(141) },
    ]) {
      expect((await decodeDoc(link(y))).ok, JSON.stringify(y).slice(0, 30)).toBe(false);
    }
  });

  test("a link from a later version is refused in plain words", async () => {
    const decoded = await decodeDoc("v3.u.e30");
    expect(decoded).toEqual({
      ok: false,
      problem: "This link was made by a newer version of Baize.",
    });
  });
});

describe("captions in links", () => {
  const link = (caption: unknown): string => {
    const json = JSON.stringify({
      t: "pool-9@1",
      s: "pool-57@1",
      k: { c: "#1f6b3a", k: "medium" },
      b: [],
      y: { c: caption },
    });
    const bytes = new TextEncoder().encode(json);
    let binary = "";
    for (const b of bytes) binary += String.fromCharCode(b);
    return `v2.u.${btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")}`;
  };

  test("a caption the editor could not have written is refused", async () => {
    const bad = [
      "A" + String.fromCharCode(1) + "B",
      "two" + String.fromCharCode(10) + "lines",
      "tab" + String.fromCharCode(9) + "bed",
      "   ",
      " leading space",
      "double  space",
      "lone " + String.fromCharCode(0xd800),
      "non-character " + String.fromCharCode(0xffff),
      "x".repeat(141),
    ];
    for (const caption of bad) {
      expect((await decodeDoc(link(caption))).ok, JSON.stringify(caption).slice(0, 40)).toBe(false);
    }
  });

  test("ordinary text, accents, symbols and emoji are accepted as written", async () => {
    for (const caption of ['Stop shot <3 & "draw"', "Übung für Anfänger", "Break 🎱 practice"]) {
      const decoded = await decodeDoc(link(caption));
      if (!decoded.ok) throw new Error(decoded.problem);
      expect(decoded.doc.style?.caption).toBe(caption);
    }
  });

  test("whatever a document holds, its link opens, without the space left by typing", async () => {
    const messy: DiagramDoc = {
      ...newDoc("pool-9@1"),
      style: { caption: "  Typed " + String.fromCharCode(7) + " badly  " },
    };
    const decoded = await decodeDoc(await encodeDoc(messy, { compression: "off" }));
    if (!decoded.ok) throw new Error(decoded.problem);
    expect(decoded.doc.style?.caption).toBe("Typed badly");

    const long: DiagramDoc = { ...newDoc("pool-9@1"), style: { caption: "🎱".repeat(100) } };
    const back = await decodeDoc(await encodeDoc(long, { compression: "off" }));
    if (!back.ok) throw new Error(back.problem);
    // 70 whole emoji fit in 140 units; none is cut in half.
    expect(back.doc.style?.caption).toBe("🎱".repeat(70));
  });
});
