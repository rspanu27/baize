import { sampleAt } from "@baize/physics";
import type { SimResult } from "@baize/physics";
import type { Scene } from "../doc/resolve";
import { useViewTransform } from "../view/viewContext";
import { BallBody } from "./BallBody";

/** The balls where the shot has them at time `t`. Balls that have dropped are not drawn. */
export function PlaybackLayer({
  scene,
  result,
  t,
}: {
  scene: Scene;
  result: SimResult;
  t: number;
}) {
  const view = useViewTransform();
  const at = new Map(sampleAt(result, t).map((b) => [b.id, b] as const));
  return (
    <g data-playback-layer="" pointerEvents="none">
      {scene.balls.map((ball) => {
        const now = at.get(ball.id);
        if (now?.state === "pocketed") return null;
        const c = view.toScreen(now ? now.position : ball);
        return (
          <g
            key={ball.id}
            data-playback-ball={ball.id}
            transform={`translate(${String(c.x)} ${String(c.y)})`}
          >
            <BallBody kind={ball.kind} r={ball.radiusM} />
          </g>
        );
      })}
    </g>
  );
}
