import { useId } from "react";
import { CAPTION_MAX_LENGTH } from "../doc/types";
import type { DiagramStyle, DiagramTheme, PathLine, PathWeight } from "../doc/types";
import { useDoc, useEditor } from "../store/store";
import type { ChangeMode } from "../store/store";
import { THEME_LABELS } from "../view/theme";
import "./LookPanel.css";

const LINES: readonly { value: PathLine; label: string }[] = [
  { value: "solid", label: "Solid" },
  { value: "dashed", label: "Dashed" },
  { value: "dotted", label: "Dotted" },
];

const WEIGHTS: readonly { value: PathWeight; label: string }[] = [
  { value: "thin", label: "Thin" },
  { value: "normal", label: "Normal" },
  { value: "thick", label: "Thick" },
];

export interface LookPanelViewProps {
  style: DiagramStyle | undefined;
  /** `mode` is "live" while a caption is being typed, so that the whole edit is one undo step. */
  onChange: (patch: DiagramStyle, mode?: ChangeMode) => void;
  /** The caption box lost focus: the edit is finished. */
  onCaptionDone: () => void;
}

/** How the diagram is drawn: theme, path line, numbers on balls and the caption. */
export function LookPanelView({ style, onChange, onCaptionDone }: LookPanelViewProps) {
  const id = useId();
  const caption = style?.caption ?? "";
  // Counted as the limit is: in the units a text box's maxLength uses.
  const length = caption.length;
  return (
    <section className="look-panel">
      <h2>Look</h2>
      <div className="look-field">
        <label htmlFor={`${id}-theme`}>Theme</label>
        <select
          id={`${id}-theme`}
          value={style?.theme ?? "table"}
          onChange={(e) => {
            onChange({ theme: e.target.value as DiagramTheme });
          }}
        >
          {THEME_LABELS.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </div>
      <div className="look-field">
        <label htmlFor={`${id}-line`}>Path line</label>
        <select
          id={`${id}-line`}
          value={style?.pathLine ?? "solid"}
          onChange={(e) => {
            onChange({ pathLine: e.target.value as PathLine });
          }}
        >
          {LINES.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
      <div className="look-field">
        <label htmlFor={`${id}-weight`}>Path weight</label>
        <select
          id={`${id}-weight`}
          value={style?.pathWeight ?? "normal"}
          onChange={(e) => {
            onChange({ pathWeight: e.target.value as PathWeight });
          }}
        >
          {WEIGHTS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
      <div className="look-check">
        <input
          id={`${id}-labels`}
          type="checkbox"
          checked={style?.ballLabels !== false}
          onChange={(e) => {
            onChange({ ballLabels: e.target.checked });
          }}
        />
        <label htmlFor={`${id}-labels`}>Numbers on balls</label>
      </div>
      <div className="look-field">
        <label htmlFor={`${id}-caption`}>Caption</label>
        <input
          id={`${id}-caption`}
          type="text"
          className="look-caption"
          maxLength={CAPTION_MAX_LENGTH}
          autoComplete="off"
          aria-describedby={`${id}-count`}
          value={caption}
          onChange={(e) => {
            onChange({ caption: e.target.value }, "live");
          }}
          onBlur={onCaptionDone}
        />
        <p id={`${id}-count`} className="look-count">
          <span aria-hidden="true">
            {length} / {CAPTION_MAX_LENGTH}
          </span>
          <span className="look-sr">
            {length} of {CAPTION_MAX_LENGTH} characters
          </span>
        </p>
      </div>
    </section>
  );
}

export function LookPanel() {
  const doc = useDoc();
  const setStyle = useEditor((s) => s.setStyle);
  const endGesture = useEditor((s) => s.endGesture);
  return (
    <LookPanelView
      style={doc.style}
      onChange={setStyle}
      onCaptionDone={() => {
        // The space left by typing is dropped when the box is left, as part of the same step.
        const caption = useEditor.getState().history.present.style?.caption;
        if (caption !== undefined && caption !== caption.trimEnd()) {
          setStyle({ caption: caption.trimEnd() }, "live");
        }
        endGesture();
      }}
    />
  );
}
