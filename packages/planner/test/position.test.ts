import { describe, expect, test } from "vitest";
import { getPlayerLevel } from "../src/levels";
import { leaveValue, positionAfter, positionValue } from "../src/position";
import { makeContext, potCandidates } from "../src/shots";
import type { Position } from "../src/shots";
import type { PlanBall } from "../src/types";
import { MEDIUM, TABLES, ball, must, runnerFor } from "./helpers";

const CLUB = must(getPlayerLevel("club"), "club");

describe.each(TABLES.map((t) => [t.id === "custom" ? t.name : t.id, t] as const))(
  "on %s",
  (_name, table) => {
    const W = table.playingArea.widthM;
    const L = table.playingArea.lengthM;
    const kind = table.game === "snooker" ? "red" : "3";
    const R = must(ball(table, "x", kind, 0, 0).radiusM, "radius");

    function context(balls: PlanBall[]) {
      return makeContext({
        table,
        balls,
        cueBallId: "cue",
        state: { game: "straight" },
        level: CLUB,
        cloth: MEDIUM,
        run: runnerFor(table),
      });
    }
    const pos = (balls: PlanBall[]): Position => ({
      balls,
      cueBallId: "cue",
      state: { game: "straight" },
    });

    test("a short straight pot is worth more than a long thin cut; a hidden ball is worth nothing", () => {
      const target = ball(table, "a", kind, W * 0.25, L * 0.85);
      const tl = { x: 0, y: L };
      const toward = { x: target.x - tl.x, y: target.y - tl.y };
      const l = Math.hypot(toward.x, toward.y);
      const easyCue = ball(
        table,
        "cue",
        "cue",
        target.x + (toward.x / l) * 8 * R,
        target.y + (toward.y / l) * 8 * R,
      );
      const hardCue = ball(table, "cue", "cue", W * 0.9, L * 0.2);
      const easy = positionValue(context([easyCue, target]), pos([easyCue, target]));
      const hard = positionValue(context([hardCue, target]), pos([hardCue, target]));
      expect(easy).toBeGreaterThan(0.5);
      expect(easy).toBeGreaterThan(hard);
      // The cue ball wrapped by three balls that are not on: no pot is on at all.
      const cue = ball(table, "cue", "cue", W / 2, L / 2);
      const wall = [0, 1, 2, 3, 4, 5].map((k) => {
        const a = (k * Math.PI) / 3;
        return ball(
          table,
          `w${String(k)}`,
          kind,
          W / 2 + 2.05 * R * Math.cos(a),
          L / 2 + 2.05 * R * Math.sin(a),
        );
      });
      const far = ball(table, "a", kind, W * 0.2, L * 0.2);
      const snookered = [cue, ...wall, far];
      const ctx = context(snookered);
      // Only the far ball counts as on: treat the wall as balls of another kind.
      const onlyFar = pos(
        snookered.map((b) => (b.id.startsWith("w") ? { ...b, kind: "cue" as const } : b)),
      );
      expect(positionValue(ctx, onlyFar)).toBe(0);
    });

    test("leave value: the shot that leaves the easier next ball scores higher", () => {
      const balls = [
        ball(table, "cue", "cue", W * 0.5, L * 0.3),
        ball(table, "a", kind, W * 0.5, L * 0.55),
        ball(table, "b", kind, W * 0.3, L * 0.8),
      ];
      const ctx = context(balls);
      const candidates = potCandidates(ctx, pos(balls)).filter((c) => c.targetId === "a");
      expect(candidates.length).toBeGreaterThan(2);
      const scored = candidates.map((c) => {
        const centre = must(c.outcomes[0], "planned outcome");
        const next = positionAfter(ctx, pos(balls), centre);
        return { leave: leaveValue(ctx, pos(balls), c), next: positionValue(ctx, next) };
      });
      // Leave values follow the next position's value (they average it over speed errors).
      const best = scored.reduce((a, b) => (b.leave > a.leave ? b : a));
      const worst = scored.reduce((a, b) => (b.leave < a.leave ? b : a));
      expect(best.leave).toBeGreaterThan(worst.leave);
      expect(best.next).toBeGreaterThanOrEqual(worst.next - 0.2);
      for (const s of scored) {
        expect(s.leave).toBeGreaterThanOrEqual(0);
        expect(s.leave).toBeLessThanOrEqual(1);
      }
    });
  },
);
