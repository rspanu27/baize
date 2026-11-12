import type { Scene } from "../doc/resolve";
import { useViewTransform } from "../view/viewContext";

/** Placeholder: plain discs where the balls are. Task 2.6 replaces this. */
export function BallsLayer({ scene }: { scene: Scene }) {
  const view = useViewTransform();
  return (
    <g>
      {scene.balls.map((b) => {
        const c = view.toScreen(b);
        return <circle key={b.id} cx={c.x} cy={c.y} r={b.radiusM} fill="#fbfaf2" />;
      })}
    </g>
  );
}
