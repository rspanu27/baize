import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { loadLayout, setShot } from "../doc/ops";
import { newDoc } from "../doc/resolve";
import { TUNING_FIELDS } from "../sim/tuning";
import type { Tuning } from "../sim/tuning";
import { simulateDoc } from "../sim/useSimulation";
import { mainThreadSimulator } from "../sim/simulator";
import { DebugPanelView, formatTuning } from "./DebugPanel";

function render(tuning: Tuning, withShot = true): string {
  const base = loadLayout(
    newDoc("pool-9@1"),
    { balls: [{ kind: "cue", x: 0.6, y: 0.6 }] },
    { source: "manual", mode: "replace" },
  );
  const doc = withShot ? setShot(base, { aimAngleRad: 1, speedMps: 2 }) : base;
  const simulation = simulateDoc(doc, mainThreadSimulator, tuning);
  if (!simulation.scene) throw new Error("no scene");
  return renderToStaticMarkup(
    <DebugPanelView
      scene={simulation.scene}
      tuning={tuning}
      outcome={simulation.outcome}
      onChange={() => undefined}
      onReset={() => undefined}
    />,
  );
}

describe("DebugPanelView", () => {
  test("lists every number with its label, standard value and a hint", () => {
    const markup = render({});
    for (const f of TUNING_FIELDS) {
      expect(markup).toContain(f.label);
      expect(markup).toContain(f.hint);
    }
    expect(markup).toContain("Standard: 0.85.");
    expect(markup).toContain("not saved in the link");
    expect(markup).toContain("Cloth friction is under Setup");
  });

  test("with nothing changed there is no warning and the reset button is off", () => {
    const markup = render({});
    expect(markup).not.toContain("changed numbers");
    expect(markup).toContain("<summary>Physics numbers</summary>");
    expect(markup).toMatch(/<button[^>]*disabled[^>]*>Back to standard numbers/);
  });

  test("a changed number is shown, marked, and warned about", () => {
    const markup = render({ cushionRestitution: 0.6 });
    expect(markup).toContain("Physics numbers (changed)");
    expect(markup).toContain("Paths are drawn with changed numbers");
    expect(markup).toMatch(
      /value="0\.6"[^>]*class="debug-changed"|class="debug-changed"[^>]*value="0\.6"/,
    );
    expect(markup).toContain("Standard: 0.85.");
    expect(markup).not.toMatch(/<button[^>]*disabled[^>]*>Back to standard numbers/);
  });

  test("shows how the last shot was computed, or that there is none", () => {
    expect(render({})).toMatch(/Last shot: \d+ steps, \d+\.\d s on the table, computed in/);
    expect(render({}, false)).toContain("No shot to simulate.");
  });

  test("numbers are shown without rounding noise", () => {
    expect(formatTuning(0.1 + 0.2)).toBe("0.3");
    expect(formatTuning(0.009951)).toBe("0.009951");
    expect(formatTuning(28)).toBe("28");
  });
});
