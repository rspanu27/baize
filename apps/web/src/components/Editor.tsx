import { useSimulation } from "../sim/useSimulation";
import { useDoc } from "../store/store";
import { useOrientation } from "../view/useOrientation";
import { BallsLayer } from "./BallsLayer";
import "./Editor.css";
import { PathsLayer } from "./PathsLayer";
import { SetupPanel } from "./SetupPanel";
import { ShotPanel } from "./ShotPanel";
import { TableView } from "./TableView";
import { Toolbar } from "./Toolbar";

/**
 * The editor shell: the table on one side, panels on the other. Each part is its own
 * component so that they can be built independently.
 */
export function Editor() {
  const doc = useDoc();
  const simulation = useSimulation(doc);
  const orientation = useOrientation();
  const { scene, problems, paths } = simulation;

  return (
    <div className="editor">
      <main className="editor-table">
        {scene ? (
          <TableView scene={scene} orientation={orientation}>
            <PathsLayer paths={paths} />
            <BallsLayer scene={scene} />
          </TableView>
        ) : (
          <p className="editor-problem">This diagram cannot be shown.</p>
        )}
      </main>
      <aside className="editor-panels">
        <h1 className="editor-title">Baize</h1>
        <Toolbar />
        {problems.length > 0 ? (
          <ul className="editor-problems" role="alert">
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        ) : null}
        <SetupPanel />
        <ShotPanel />
        <p className="editor-note">Physics v1: no throw, squirt, swerve or nap yet.</p>
      </aside>
    </div>
  );
}
