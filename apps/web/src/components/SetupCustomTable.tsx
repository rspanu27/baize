import { useId } from "react";
import type { GameType, JawStyle, ValidationIssue } from "@baize/tables";
import type {
  CustomTableResult,
  LengthTextField,
  ProblemField,
  TableTexts,
} from "../setup/customTable";
import { FIELD_OF_TEXT } from "../setup/customTable";

const GAMES: readonly { value: GameType; label: string }[] = [
  { value: "snooker", label: "Snooker" },
  { value: "pool", label: "Pool" },
  { value: "blackball", label: "UK pool" },
];

const JAWS: readonly { value: JawStyle | "auto"; label: string }[] = [
  { value: "auto", label: "Automatic" },
  { value: "angled", label: "Angled (pool)" },
  { value: "rounded", label: "Rounded (snooker)" },
];

const LENGTH_FIELDS: readonly { key: LengthTextField; label: string }[] = [
  { key: "length", label: "Length" },
  { key: "width", label: "Width" },
  { key: "cornerMouth", label: "Corner pocket opening" },
  { key: "middleMouth", label: "Middle pocket opening" },
];

/** Problems and issues for one field: errors in red with role alert, warnings in amber. */
export function FieldMessages({
  id,
  field,
  result,
}: {
  id: string;
  field: ProblemField;
  result: CustomTableResult;
}) {
  const problems = result.fieldProblems[field] ?? [];
  const issues: ValidationIssue[] = result.issues.filter((i) => i.field === field);
  if (problems.length === 0 && issues.length === 0) return null;
  return (
    <div id={id}>
      {problems.map((p) => (
        <p key={p} className="setup-msg setup-error" role="alert">
          {p}
        </p>
      ))}
      {issues.map((i) =>
        i.severity === "error" ? (
          <p key={i.code} className="setup-msg setup-error" role="alert">
            {i.message}
          </p>
        ) : (
          <p key={i.code} className="setup-msg setup-warning">
            {i.message}
          </p>
        ),
      )}
    </div>
  );
}

export function messagesId(base: string, field: ProblemField): string {
  return `${base}-${field}-msg`;
}

export function hasMessages(result: CustomTableResult, field: ProblemField): boolean {
  return (
    (result.fieldProblems[field]?.length ?? 0) > 0 || result.issues.some((i) => i.field === field)
  );
}

interface Props {
  texts: TableTexts;
  result: CustomTableResult;
  onText: (field: LengthTextField, value: string) => void;
  onGame: (game: GameType) => void;
  onJaw: (jaw: JawStyle | "auto") => void;
  /** Enter or leaving a box: apply the table if it is valid. */
  onCommit: () => void;
}

/** The custom table form. It holds no state: the panel owns the text. */
export function SetupCustomTable({ texts, result, onText, onGame, onJaw, onCommit }: Props) {
  const base = useId();
  return (
    <fieldset className="setup-group">
      <legend>Custom table</legend>
      <div className="setup-field">
        <label htmlFor={`${base}-game`}>Game</label>
        <select
          id={`${base}-game`}
          value={texts.game}
          onChange={(e) => {
            onGame(e.target.value as GameType);
          }}
        >
          {GAMES.map((g) => (
            <option key={g.value} value={g.value}>
              {g.label}
            </option>
          ))}
        </select>
      </div>
      {LENGTH_FIELDS.map(({ key, label }) => {
        const field = FIELD_OF_TEXT[key];
        const msgId = messagesId(base, field);
        const invalid = result.issues.some((i) => i.field === field && i.severity === "error");
        const unreadable = (result.fieldProblems[field]?.length ?? 0) > 0;
        return (
          <div className="setup-field" key={key}>
            <label htmlFor={`${base}-${key}`}>{label}</label>
            <input
              id={`${base}-${key}`}
              type="text"
              inputMode="text"
              autoComplete="off"
              spellCheck={false}
              value={texts[key]}
              aria-invalid={invalid || unreadable}
              aria-describedby={hasMessages(result, field) ? msgId : undefined}
              onChange={(e) => {
                onText(key, e.target.value);
              }}
              onBlur={onCommit}
              onKeyDown={(e) => {
                if (e.key === "Enter") onCommit();
              }}
            />
            <FieldMessages id={msgId} field={field} result={result} />
          </div>
        );
      })}
      <details className="setup-advanced">
        <summary>Advanced</summary>
        <div className="setup-field">
          <label htmlFor={`${base}-jaw`}>Jaw shape</label>
          <select
            id={`${base}-jaw`}
            value={texts.jawStyle}
            onChange={(e) => {
              onJaw(e.target.value as JawStyle | "auto");
            }}
          >
            {JAWS.map((j) => (
              <option key={j.value} value={j.value}>
                {j.label}
              </option>
            ))}
          </select>
        </div>
      </details>
    </fieldset>
  );
}
