import { getBallSet, getTablePreset, rackLayout } from "@baize/tables";
import { describe, expect, test } from "vitest";
import { loadLayout, placeBall, setShot } from "../doc/ops";
import { newDoc } from "../doc/resolve";
import { docFromUrl, shareLink, shareUrl } from "./shareLink";

function racked() {
  const table = getTablePreset("pool-9@1");
  const set = table ? getBallSet(table.defaultBallSetId) : undefined;
  if (!table || !set) throw new Error("missing preset");
  const doc = loadLayout(newDoc("pool-9@1"), rackLayout(table, set, "pool-9ball"), {
    source: "rack",
    mode: "replace",
  });
  return setShot(doc, { aimAngleRad: 1.2345678901234567, speedMps: 4.5 });
}

describe("share links", () => {
  test("a link reopens as the same diagram", async () => {
    const doc = racked();
    const url = await shareUrl(doc, "https://example.test/baize/");
    expect(url.startsWith("https://example.test/baize/#v1.")).toBe(true);
    const opened = await docFromUrl(url);
    expect(opened?.ok).toBe(true);
    if (!opened?.ok) return;
    expect(opened.doc.table).toEqual(doc.table);
    expect(opened.doc.balls.map((b) => [b.id, b.kind])).toEqual(
      doc.balls.map((b) => [b.id, b.kind]),
    );
    // The aim angle is not rounded: any angle can be shared.
    expect(opened.doc.shot?.aimAngleRad).toBe(1.2345678901234567);
    expect(opened.doc.shot?.speedMps).toBe(4.5);
    // Sharing what was opened gives the very same link.
    expect(await shareUrl(opened.doc, "https://example.test/baize/")).toBe(url);
  });

  test("the link replaces any old hash and drops the playground switch", async () => {
    const url = await shareUrl(racked(), "https://example.test/?playground=1&x=2#old");
    expect(url.startsWith("https://example.test/?x=2#v1.")).toBe(true);
  });

  test("a page address with no diagram, or an unrelated hash, opens nothing", async () => {
    expect(await docFromUrl("https://example.test/")).toBeUndefined();
    expect(await docFromUrl("https://example.test/#section")).toBeUndefined();
    expect(await docFromUrl("not a url")).toBeUndefined();
  });

  test("a damaged link is reported in plain words and does not throw", async () => {
    const url = await shareUrl(racked(), "https://example.test/");
    const damaged = await docFromUrl(url.slice(0, url.length - 25));
    expect(damaged?.ok).toBe(false);
    if (damaged && !damaged.ok) expect(damaged.problem.length).toBeGreaterThan(10);
  });

  test("sharing gives back the diagram as the link carries it, and that one is stable", async () => {
    const page = "https://example.test/";
    // A position finer than a link stores.
    const doc = placeBall(racked(), "b1", { x: 0.4000001234, y: 0.6000004321 });
    const first = await shareLink(doc, page);
    expect(first.rounded).toBe(true);
    expect(first.doc).not.toEqual(doc);
    const opened = await docFromUrl(first.url);
    expect(opened?.ok && opened.doc).toEqual(first.doc);
    // Sharing what the link carries changes nothing further.
    const second = await shareLink(first.doc, page);
    expect(second.rounded).toBe(false);
    expect(second.doc).toBe(first.doc);
    expect(second.url).toBe(first.url);
  });
});
