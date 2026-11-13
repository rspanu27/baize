import { usePlayKey, usePlayback } from "../sim/usePlayback";
import { useSimulation } from "../sim/useSimulation";
import { useDoc, useEditor } from "../store/store";
import { AimLayer, AimSurface } from "./AimLayer";
import { BallsLayer } from "./BallsLayer";
import "./Editor.css";
import { DebugPanel } from "./DebugPanel";
import { ExportPanel } from "./ExportPanel";
import { LookPanel } from "./LookPanel";
import { MeasureLayer } from "./MeasureLayer";
import { MeasurePanel } from "./MeasurePanel";
import { PathsLayer } from "./PathsLayer";
import { PlayBar } from "./PlayBar";
import { PlaybackLayer } from "./PlaybackLayer";
import { SetupPanel } from "./SetupPanel";
import { SharePanel } from "./SharePanel";
import { ShotPanel } from "./ShotPanel";
import { TableView } from "./TableView";
import { Toolbar } from "./Toolbar";

/**
 * The editor shell: the play bar and the table on one side, panels on the other. The page
 * itself never scrolls: the table stays in view and the panels scroll on their own.
 *
 * The table is always drawn lengthways. On a phone held upright that is also the larger
 * drawing, because the table has the full width and the panels need the height below it.
 */
export function Editor() {
  const doc = useDoc();
  const setShot = useEditor((s) => s.setShot);
  const continueFromShot = useEditor((s) => s.continueFromShot);
  const simulation = useSimulation(doc);
  const { scene, problems, paths, outcome } = simulation;
  const result = outcome.result;
  const playback = usePlayback(doc, result?.durationS ?? 0);
  const playingAt = result ? playback.t : undefined;
  usePlayKey(playback, result !== undefined);

  return (
    <div className="editor">
      <main className="editor-table">
        <PlayBar
          hasCueBall={scene?.balls.some((b) => b.kind === "cue") === true}
          hasShot={scene?.shot !== undefined}
          durationS={result?.durationS}
          playback={playback}
          onAddShot={() => {
            setShot({});
          }}
          onContinue={() => {
            if (paths) continueFromShot(paths.finals);
          }}
        />
        {scene ? (
          <TableView scene={scene} orientation="landscape" style={doc.style}>
            {result && playingAt !== undefined ? (
              <>
                <PathsLayer paths={paths} />
                <PlaybackLayer scene={scene} result={result} t={playingAt} />
                <MeasureLayer scene={scene} interactive={false} />
              </>
            ) : (
              <>
                <AimSurface scene={scene} />
                <PathsLayer paths={paths} />
                <BallsLayer scene={scene} />
                <AimLayer scene={scene} />
                <MeasureLayer scene={scene} interactive />
              </>
            )}
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
        <MeasurePanel />
        <LookPanel />
        <SharePanel />
        <ExportPanel />
        <DebugPanel />
        <p className="editor-note">
          Physics v2: throw, squirt and nap are modelled; swerve is not. The dashed yellow line is
          where the cue points; with side the ball leaves slightly off it, and the ghost ball shows
          where it really arrives.
        </p>
      </aside>
    </div>
  );
}
