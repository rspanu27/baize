import { useRef, useState } from "react";
import type { PointerEvent } from "react";
import type { Scene } from "../doc/resolve";
import type { DiagramDoc, DocShot } from "../doc/types";
import type { PathModel } from "../sim/pathModel";
import { useTuning } from "../sim/tuning";
import { simulationFor } from "../sim/useSimulation";
import {
  AIM_STEPS_DEG,
  MAX_TIP,
  SPEED_MAX,
  SPEED_MIN,
  SPEED_STOPS,
  aimAt,
  aimReadout,
  clampTip,
  describeHit,
  angleToDegrees,
  describeTip,
  nudgeAngle,
  rollInTableLengths,
  speedName,
  tipKeyStep,
  tipFromWidget,
} from "../shot/shotModel";
import { useDoc, useEditor } from "../store/store";
import type { ChangeMode } from "../store/store";
import { formatAngle, formatDistance, formatSpeed } from "../units/units";
import type { UnitSystem } from "../units/units";
import { useUnitSystem } from "../units/usePreference";
import { ballName } from "../view/ballLook";
import "./ShotPanel.css";

export interface ShotPanelActions {
  setShot: (patch: Partial<Omit<DocShot, "elevationRad">>, mode?: ChangeMode) => void;
  clearShot: () => void;
  endGesture: () => void;
  setShowAllPaths: (value: boolean) => void;
}

export interface ShotPanelViewProps {
  doc: DiagramDoc;
  scene: Scene | undefined;
  paths: PathModel | undefined;
  selectedBallId: string | undefined;
  units: UnitSystem;
  /** Ball mass over cue end mass, when the debug panel has changed it. */
  endMassRatio?: number | undefined;
  actions: ShotPanelActions;
}

/** Size of the drawn ball face in the tip widget, in svg units. */
const FACE = 100;
const FACE_R = 44;

/** The shot controls: aim, tip position, speed, and what the shot does. */
export function ShotPanelView({
  doc,
  scene,
  paths,
  selectedBallId,
  units,
  endMassRatio,
  actions,
}: ShotPanelViewProps) {
  // Text being typed in the angle box; undefined when the box shows the document's value.
  const [angleDraft, setAngleDraft] = useState<string | undefined>(undefined);
  const draggingTip = useRef(false);

  const cue = scene?.balls.find((b) => b.kind === "cue");
  if (!scene || !cue) {
    return (
      <section className="shot-panel">
        <h2>Shot</h2>
        <p className="shot-hint">Add a cue ball to set up a shot.</p>
      </section>
    );
  }
  const shot = doc.shot;
  if (!shot) {
    return (
      <section className="shot-panel">
        <h2>Shot</h2>
        <button
          type="button"
          className="shot-primary"
          onClick={() => {
            actions.setShot({});
          }}
        >
          Add a shot
        </button>
      </section>
    );
  }

  const degrees = angleToDegrees(shot.aimAngleRad);
  const selected = scene.balls.find((b) => b.id === selectedBallId && b.id !== cue.id);

  const commitAngle = (): void => {
    if (angleDraft === undefined) return;
    const value = Number(angleDraft.replace(",", "."));
    if (Number.isFinite(value)) actions.setShot({ aimAngleRad: nudgeAngle(0, value) });
    setAngleDraft(undefined);
  };

  const tipFromEvent = (e: PointerEvent<SVGSVGElement>): { side: number; vertical: number } => {
    const box = e.currentTarget.getBoundingClientRect();
    const scale = FACE / box.width;
    const dx = ((e.clientX - box.left) * scale - FACE / 2) / FACE_R;
    const dy = ((e.clientY - box.top) * scale - FACE / 2) / FACE_R;
    // The drawn ball has radius 1 in these units; the tip can reach half of that.
    return tipFromWidget(dx, dy);
  };

  const first = paths?.firstObjectBallId
    ? scene.balls.find((b) => b.id === paths.firstObjectBallId)
    : undefined;
  const readout = aimReadout(scene, endMassRatio);
  const potted = paths?.finals.filter((f) => f.pocketed) ?? [];

  return (
    <section className="shot-panel">
      <h2>Shot</h2>

      <div className="shot-group">
        <label htmlFor="shot-angle">Aim</label>
        <div className="shot-row">
          <input
            id="shot-angle"
            className="shot-angle"
            inputMode="decimal"
            value={angleDraft ?? degrees.toFixed(2)}
            onChange={(e) => {
              setAngleDraft(e.target.value);
            }}
            onBlur={commitAngle}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitAngle();
            }}
            aria-describedby="shot-angle-help"
          />
          <span aria-hidden="true">°</span>
        </div>
        <div className="shot-row shot-steps" role="group" aria-label="Turn the aim">
          {[...AIM_STEPS_DEG].map((step) => (
            <button
              key={`m${String(step)}`}
              type="button"
              onClick={() => {
                actions.setShot({ aimAngleRad: nudgeAngle(shot.aimAngleRad, -step) });
              }}
              aria-label={`Turn ${String(step)} degrees clockwise`}
            >
              −{step}°
            </button>
          ))}
          {[...AIM_STEPS_DEG].reverse().map((step) => (
            <button
              key={`p${String(step)}`}
              type="button"
              onClick={() => {
                actions.setShot({ aimAngleRad: nudgeAngle(shot.aimAngleRad, step) });
              }}
              aria-label={`Turn ${String(step)} degrees counter-clockwise`}
            >
              +{step}°
            </button>
          ))}
        </div>
        <p id="shot-angle-help" className="shot-hint">
          Drag anywhere on the cloth, or the yellow handle: the further from the cue ball, the finer
          the aim.
        </p>
        <button
          type="button"
          disabled={!selected}
          title={selected ? undefined : "Select an object ball first."}
          onClick={() => {
            if (!selected) return;
            const angle = aimAt(cue, selected);
            if (angle !== undefined) actions.setShot({ aimAngleRad: angle });
          }}
        >
          Aim at the selected ball
        </button>
      </div>

      <div className="shot-group">
        <span className="shot-label" id="shot-tip-label">
          Tip position
        </span>
        <div className="shot-tip">
          <svg
            viewBox={`0 0 ${String(FACE)} ${String(FACE)}`}
            className="shot-face"
            role="group"
            tabIndex={0}
            aria-labelledby="shot-tip-label shot-tip-text"
            aria-describedby="shot-tip-help"
            onKeyDown={(e) => {
              const step = tipKeyStep(e.key);
              if (!step) return;
              e.preventDefault();
              actions.setShot({
                tipOffset: clampTip(
                  shot.tipOffset.side + step.side,
                  shot.tipOffset.vertical + step.vertical,
                ),
              });
            }}
            onPointerDown={(e) => {
              if (e.pointerType === "mouse" && e.button !== 0) return;
              e.currentTarget.setPointerCapture(e.pointerId);
              draggingTip.current = true;
              actions.setShot({ tipOffset: tipFromEvent(e) }, "live");
            }}
            onPointerMove={(e) => {
              if (draggingTip.current) actions.setShot({ tipOffset: tipFromEvent(e) }, "live");
            }}
            onPointerUp={() => {
              draggingTip.current = false;
              actions.endGesture();
            }}
            onPointerCancel={() => {
              draggingTip.current = false;
              actions.endGesture();
            }}
          >
            <circle cx={FACE / 2} cy={FACE / 2} r={FACE_R} className="shot-face-ball" />
            <circle cx={FACE / 2} cy={FACE / 2} r={FACE_R * MAX_TIP} className="shot-face-limit" />
            <line
              x1={FACE / 2}
              y1={FACE / 2 - FACE_R}
              x2={FACE / 2}
              y2={FACE / 2 + FACE_R}
              className="shot-face-cross"
            />
            <line
              x1={FACE / 2 - FACE_R}
              y1={FACE / 2}
              x2={FACE / 2 + FACE_R}
              y2={FACE / 2}
              className="shot-face-cross"
            />
            <circle
              cx={FACE / 2 + shot.tipOffset.side * FACE_R}
              cy={FACE / 2 - shot.tipOffset.vertical * FACE_R}
              r={5}
              className="shot-face-tip"
            />
          </svg>
          <div>
            <p id="shot-tip-text" className="shot-readout">
              {describeTip(shot.tipOffset.side, shot.tipOffset.vertical)}
            </p>
            <p id="shot-tip-help" className="shot-hint">
              Drag on the ball, or focus it and use the arrow keys.
            </p>
            <button
              type="button"
              onClick={() => {
                actions.setShot({ tipOffset: { side: 0, vertical: 0 } });
              }}
            >
              Centre
            </button>
          </div>
        </div>
      </div>

      <div className="shot-group">
        <label htmlFor="shot-speed">
          Speed: {formatSpeed(shot.speedMps, units)}
          {speedName(shot.speedMps) ? ` (${speedName(shot.speedMps) ?? ""})` : ""}
        </label>
        <input
          id="shot-speed"
          type="range"
          min={SPEED_MIN}
          max={SPEED_MAX}
          step={0.01}
          value={shot.speedMps}
          onChange={(e) => {
            actions.setShot({ speedMps: Number(e.target.value) }, "live");
          }}
          onPointerUp={actions.endGesture}
          onKeyUp={actions.endGesture}
          onBlur={actions.endGesture}
        />
        <div className="shot-row shot-steps" role="group" aria-label="Named speeds">
          {SPEED_STOPS.map((s) => (
            <button
              key={s.name}
              type="button"
              aria-pressed={speedName(shot.speedMps) === s.name}
              onClick={() => {
                actions.setShot({ speedMps: s.speedMps });
              }}
            >
              {s.name}
            </button>
          ))}
        </div>
        <p className="shot-hint">
          Alone on this cloth the ball would roll about{" "}
          {rollInTableLengths(shot.speedMps, scene).toFixed(1)} table lengths.
        </p>
      </div>

      <div className="shot-group">
        <label className="shot-check">
          <input
            type="checkbox"
            checked={doc.style?.showAllPaths === true}
            onChange={(e) => {
              actions.setShowAllPaths(e.target.checked);
            }}
          />
          Show every ball's path
        </label>
      </div>

      {paths ? (
        <dl className="shot-result">
          <dt>First ball hit</dt>
          <dd>{first ? ballName(first.kind) : "none"}</dd>
          {readout && readout.targetBallId === paths.firstObjectBallId ? (
            <>
              <dt>Cut angle</dt>
              <dd>
                {formatAngle(readout.cutAngleRad)} ({describeHit(readout.cutAngleRad)})
              </dd>
              <dt>Distance to it</dt>
              <dd>{formatDistance(readout.distanceM, units)}</dd>
            </>
          ) : null}
          <dt>Cue ball travel</dt>
          <dd>{formatDistance(paths.cueTravelM, units)}</dd>
          <dt>Potted</dt>
          <dd>
            {potted.length === 0 ? "nothing" : potted.map((f) => ballName(f.kind)).join(", ")}
          </dd>
          {paths.complete ? null : (
            <>
              <dt>Note</dt>
              <dd>The shot was too long to finish; the paths are cut short.</dd>
            </>
          )}
        </dl>
      ) : null}

      <button type="button" onClick={actions.clearShot}>
        Remove the shot
      </button>
    </section>
  );
}

/** The shot controls, wired to the editor store. */
export function ShotPanel() {
  const doc = useDoc();
  const selectedBallId = useEditor((s) => s.selectedBallId);
  const setShot = useEditor((s) => s.setShot);
  const clearShot = useEditor((s) => s.clearShot);
  const endGesture = useEditor((s) => s.endGesture);
  const setStyle = useEditor((s) => s.setStyle);
  const [units] = useUnitSystem();
  const tuning = useTuning();
  const simulation = simulationFor(doc, tuning);
  return (
    <ShotPanelView
      doc={doc}
      scene={simulation.scene}
      paths={simulation.paths}
      selectedBallId={selectedBallId}
      units={units}
      endMassRatio={tuning.cueEndMassRatio}
      actions={{
        setShot,
        clearShot,
        endGesture,
        setShowAllPaths: (value) => {
          setStyle({ showAllPaths: value });
        },
      }}
    />
  );
}
