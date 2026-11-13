import { PLAYBACK_RATES } from "../sim/usePlayback";
import type { Playback } from "../sim/usePlayback";
import "./PlayBar.css";

export interface PlayBarProps {
  hasCueBall: boolean;
  hasShot: boolean;
  /** Length of the simulated shot in seconds; undefined when it could not be simulated. */
  durationS: number | undefined;
  playback: Playback;
  onAddShot: () => void;
  /** Keeps the result of the shot as the new layout. */
  onContinue: () => void;
}

function rateLabel(rate: number): string {
  if (rate === 1) return "Full speed";
  if (rate === 0.5) return "Half speed";
  if (rate === 0.25) return "Quarter speed";
  return "Tenth speed";
}

/** Playing the shot: always in view above the table. */
export function PlayBar({
  hasCueBall,
  hasShot,
  durationS,
  playback,
  onAddShot,
  onContinue,
}: PlayBarProps) {
  if (!hasCueBall) {
    return (
      <div className="play-bar">
        <p className="play-hint">Add a cue ball, then a shot, to play it.</p>
      </div>
    );
  }
  if (!hasShot) {
    return (
      <div className="play-bar">
        <button type="button" className="play-main" onClick={onAddShot}>
          Add a shot
        </button>
        <p className="play-hint">Then drag on the table to aim and press Play.</p>
      </div>
    );
  }
  if (durationS === undefined) {
    return (
      <div className="play-bar">
        <p className="play-hint">This shot cannot be played yet; see the note in the panel.</p>
      </div>
    );
  }

  const showing = playback.t !== undefined;
  // With repeat on, the clock runs a little past the end while the result is held.
  const t = Math.min(playback.t ?? 0, durationS);
  return (
    <div className="play-bar">
      {playback.running ? (
        <button
          type="button"
          className="play-main"
          onClick={playback.pause}
          title="Space bar"
          aria-keyshortcuts="Space"
        >
          ❚❚ Pause
        </button>
      ) : (
        <button
          type="button"
          className="play-main"
          onClick={playback.play}
          title="Space bar"
          aria-keyshortcuts="Space"
        >
          ▶ {showing && t < durationS && t > 0 ? "Resume" : showing ? "Play again" : "Play shot"}
        </button>
      )}
      <input
        className="play-scrub"
        type="range"
        min={0}
        max={durationS}
        step={0.01}
        value={Math.min(t, durationS)}
        aria-label="Time in the shot"
        onChange={(e) => {
          playback.seek(Number(e.target.value));
        }}
      />
      <span className="play-time">
        {t.toFixed(1)} / {durationS.toFixed(1)} s
      </span>
      <select
        className="play-rate"
        aria-label="Playback speed"
        value={playback.rate}
        onChange={(e) => {
          playback.setRate(Number(e.target.value));
        }}
      >
        {PLAYBACK_RATES.map((rate) => (
          <option key={rate} value={rate}>
            {rateLabel(rate)}
          </option>
        ))}
      </select>
      <label className="play-repeat">
        <input
          type="checkbox"
          checked={playback.repeat}
          onChange={(e) => {
            playback.setRepeat(e.target.checked);
          }}
        />
        Repeat
      </label>
      {showing ? (
        <button type="button" onClick={playback.stop}>
          Back to setup
        </button>
      ) : null}
      <button
        type="button"
        onClick={onContinue}
        title="Leave the balls where this shot puts them, ready for the next shot. Undo brings the old layout back."
      >
        Continue from result
      </button>
    </div>
  );
}
