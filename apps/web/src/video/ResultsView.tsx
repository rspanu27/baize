import { useId } from "react";
import type { ReactNode, Ref } from "react";
import type { DiagramTheme } from "../doc/types";
import type { UnitSystem } from "../units/units";
import { THEME_LABELS } from "../view/theme";
import {
  MESSAGE_PICK_SHOT,
  NO_SHOTS,
  NO_SHOTS_HINT,
  clipTimeText,
  shotDetails,
  shotLabel,
} from "./resultsModel";
import type { ShotChoice } from "./resultsModel";
import type { ClipShot, OverlayOptions } from "./types";
import { CLIP_STAYS, ScreenShell } from "./VideoScreenView";

/**
 * The video screen once the clip is analysed (task 7.10): the shots found, what the video
 * covers, the overlays, a preview with a scrubber and Play, and saving. Markup only; the
 * clip, the drawing and the writing are in `ClipResults`.
 */

/** The overlay switches, in the order offered, with their labels. */
export const OVERLAY_FLAGS = [
  ["cueTrail", "Cue ball's path"],
  ["allTrails", "Every ball's path"],
  ["ghostBall", "Ghost ball at the contact"],
  ["slowMotion", "Slow motion around the contact"],
  ["speed", "Cue ball's speed"],
  ["minimap", "Table from above"],
  ["labels", "Ball labels on the table from above"],
] as const satisfies readonly (readonly [keyof OverlayOptions, string])[];

export type OverlayFlag = (typeof OVERLAY_FLAGS)[number][0];

export const PREVIEW_BEHIND =
  "The preview plays slower than real time on this device. The saved video plays at full speed.";

/** Writing the video: progress, or how it ended. */
export type SaveState =
  | { kind: "idle" }
  | { kind: "saving"; done: number; total: number }
  | { kind: "saved"; fileName: string }
  | { kind: "cancelled" }
  | { kind: "failed"; message: string };

export interface ResultsViewProps {
  /** The clip's details, under the title. */
  details: ReactNode;
  durationS: number;
  shots: readonly ClipShot[];
  choice: ShotChoice;
  options: OverlayOptions;
  units: UnitSystem;
  /** The preview canvas: drawn by the caller, at the size of the video. */
  canvasRef: Ref<HTMLCanvasElement>;
  widthPx: number;
  heightPx: number;
  /** Frames of the video, the one shown and its time. */
  frameCount: number;
  frameIndex: number;
  /** Video seconds of the frame shown and of the whole video. */
  timeS: number;
  lengthS: number;
  playing: boolean;
  behind: boolean;
  save: SaveState;
  onChoose: (choice: ShotChoice) => void;
  onFlag: (flag: OverlayFlag, on: boolean) => void;
  onTheme: (theme: DiagramTheme) => void;
  onScrub: (index: number) => void;
  onPlay: () => void;
  onPause: () => void;
  onSave: () => void;
  onCancelSave: () => void;
  onOpen: () => void;
  onAdjust: () => void;
  onClose: () => void;
}

function share(done: number, total: number): number {
  return total > 0 ? Math.min(1, Math.max(0, done / total)) : 0;
}

function SaveStatus({ save, onCancel }: { save: SaveState; onCancel: () => void }) {
  if (save.kind === "saving") {
    const pct = Math.round(share(save.done, save.total) * 100);
    return (
      <div className="clip-progress">
        <p role="status">Writing the video: {pct} %</p>
        <progress max={1} value={share(save.done, save.total)} aria-label="Writing progress" />
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    );
  }
  if (save.kind === "saved") return <p role="status">Saved as {save.fileName}.</p>;
  if (save.kind === "cancelled") return <p role="status">The video was not saved.</p>;
  if (save.kind === "failed") {
    return (
      <p role="alert" className="photo-error clip-error">
        {save.message}
      </p>
    );
  }
  return null;
}

export function ResultsView({ canvasRef, ...props }: ResultsViewProps) {
  const id = useId();
  const saving = props.save.kind === "saving";
  const { shots, choice, options } = props;
  const canOpen = choice !== "whole" && shots[choice] !== undefined;
  const ratio = props.widthPx / props.heightPx;
  const last = Math.max(0, props.frameCount - 1);

  const frame = (
    <div className="clip-preview">
      <div className="photo-frame">
        <canvas
          ref={canvasRef}
          className="clip-canvas"
          width={props.widthPx}
          height={props.heightPx}
          style={{
            aspectRatio: String(ratio),
            width: `min(100cqw, calc(100cqh * ${String(ratio)}))`,
          }}
          role="img"
          aria-label="Preview of the video with the overlays"
        />
      </div>
      <div className="clip-transport">
        {props.playing ? (
          <button type="button" onClick={props.onPause}>
            Pause
          </button>
        ) : (
          <button type="button" onClick={props.onPlay} disabled={saving || props.frameCount === 0}>
            Play
          </button>
        )}
        <input
          type="range"
          min={0}
          max={last}
          step={1}
          value={Math.min(props.frameIndex, last)}
          disabled={saving || props.frameCount === 0}
          aria-label="Preview time"
          aria-valuetext={`${clipTimeText(props.timeS)} of ${clipTimeText(props.lengthS)}`}
          onChange={(e) => {
            props.onScrub(Number(e.target.value));
          }}
        />
        <span className="clip-time" aria-hidden="true">
          {clipTimeText(props.timeS)} / {clipTimeText(props.lengthS)}
        </span>
      </div>
      {props.behind ? <p className="photo-help clip-behind">{PREVIEW_BEHIND}</p> : null}
    </div>
  );

  return (
    <ScreenShell
      phase="analysed"
      details={props.details}
      frame={frame}
      onClose={props.onClose}
      actions={
        <>
          <button type="button" className="photo-primary" onClick={props.onSave} disabled={saving}>
            Save video
          </button>
          <button
            type="button"
            onClick={props.onOpen}
            disabled={!canOpen || saving}
            aria-describedby={canOpen ? undefined : `${id}-open`}
          >
            Open in editor
          </button>
          <button type="button" onClick={props.onAdjust} disabled={saving}>
            Adjust the corners
          </button>
          <button type="button" onClick={props.onClose}>
            Close
          </button>
          {canOpen ? null : (
            <p id={`${id}-open`} className="photo-help clip-open-hint">
              {shots.length > 0 ? MESSAGE_PICK_SHOT : NO_SHOTS}
            </p>
          )}
        </>
      }
    >
      {shots.length === 0 ? (
        <div className="photo-message">
          <p role="status">{NO_SHOTS}</p>
          <p className="photo-help">{NO_SHOTS_HINT}</p>
        </div>
      ) : (
        <p role="status">
          {shots.length === 1 ? "1 shot found." : `${String(shots.length)} shots found.`}
        </p>
      )}
      <fieldset className="photo-panel clip-fieldset" disabled={saving}>
        <legend>The video shows</legend>
        <label className="clip-choice">
          <input
            type="radio"
            name={`${id}-shot`}
            checked={choice === "whole"}
            onChange={() => {
              props.onChoose("whole");
            }}
          />
          <span>
            Whole clip <span className="clip-sub">{clipTimeText(props.durationS)}</span>
          </span>
        </label>
        {shots.map((shot, i) => (
          <label key={shot.index} className="clip-choice">
            <input
              type="radio"
              name={`${id}-shot`}
              checked={choice === i}
              onChange={() => {
                props.onChoose(i);
              }}
            />
            <span>
              {shotLabel(shot)} <span className="clip-sub">{shotDetails(shot, props.units)}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <fieldset className="photo-panel clip-fieldset" disabled={saving}>
        <legend>Overlays</legend>
        {OVERLAY_FLAGS.map(([flag, label]) => (
          <label key={flag} className="clip-choice">
            <input
              type="checkbox"
              checked={options[flag]}
              onChange={(e) => {
                props.onFlag(flag, e.target.checked);
              }}
            />
            <span>{label}</span>
          </label>
        ))}
        <label className="clip-theme">
          <span>Colours</span>
          <select
            value={options.theme}
            onChange={(e) => {
              props.onTheme(e.target.value as DiagramTheme);
            }}
          >
            {THEME_LABELS.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        <p className="photo-help">
          Speeds in {props.units === "metric" ? "m/s" : "mph"}, as set in the editor.
        </p>
      </fieldset>
      <SaveStatus save={props.save} onCancel={props.onCancelSave} />
      <p className="photo-help">{CLIP_STAYS}</p>
    </ScreenShell>
  );
}
