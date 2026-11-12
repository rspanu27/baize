import { useId, useState } from "react";
import { BALL_SETS, TABLE_PRESETS, getTablePreset } from "@baize/tables";
import type { GameType, JawStyle } from "@baize/tables";
import { resolveBallSet } from "../doc/resolve";
import {
  ballSetForGame,
  evaluateCustomTable,
  initialTexts,
  reformatTexts,
} from "../setup/customTable";
import type { LengthTextField, TableTexts } from "../setup/customTable";
import { useDoc, useEditor } from "../store/store";
import { formatLength } from "../units/units";
import type { UnitSystem } from "../units/units";
import { useUnitSystem } from "../units/usePreference";
import { ClothSection } from "./ClothSection";
import { FieldMessages, SetupCustomTable } from "./SetupCustomTable";
import { UnitsToggle } from "./UnitsToggle";
import "./SetupPanel.css";

const CUSTOM = "custom";

function playingAreaText(lengthM: number, widthM: number, system: UnitSystem): string {
  return `Playing area ${formatLength(lengthM, system)} by ${formatLength(widthM, system)}`;
}

/** Table, balls, cloth and units. */
export function SetupPanel() {
  const doc = useDoc();
  const setTable = useEditor((s) => s.setTable);
  const setBallSet = useEditor((s) => s.setBallSet);
  const [system, setSystem] = useUnitSystem();
  const id = useId();

  // Custom mode before the document has a custom table: the form starts from this preset.
  const [customFromPreset, setCustomFromPreset] = useState(false);
  // What the person has typed since the last apply; undefined shows the document's values.
  const [drafts, setDrafts] = useState<TableTexts | undefined>(undefined);

  const docCustom = "custom" in doc.table ? doc.table.custom : undefined;
  const docPreset = "preset" in doc.table ? getTablePreset(doc.table.preset) : undefined;
  const showCustom = docCustom !== undefined || customFromPreset;
  const ballSet = resolveBallSet(doc.ballSet);
  const ballDiameterM = ballSet?.object.diameterM ?? 0;

  const documentTexts = docCustom
    ? initialTexts(docCustom, system)
    : docPreset
      ? initialTexts(docPreset, system)
      : undefined;
  const texts = drafts ?? documentTexts;

  // The ball set the table would use if applied (a game change brings that game's default).
  const effectiveBallSpec = texts
    ? ballSetForGame(doc.ballSet, ballSet?.game, texts.game)
    : doc.ballSet;
  const effectiveDiameterM = resolveBallSet(effectiveBallSpec)?.object.diameterM ?? ballDiameterM;
  const result = texts ? evaluateCustomTable(texts, system, effectiveDiameterM) : undefined;

  const game: GameType | undefined = showCustom && texts ? texts.game : docPreset?.game;

  const apply = (t: TableTexts) => {
    const r = evaluateCustomTable(t, system, effectiveBallSpecFor(t));
    if (!r.canApply || !r.fields) return;
    const spec = ballSetForGame(doc.ballSet, ballSet?.game, t.game);
    setTable({ custom: r.fields }, spec === doc.ballSet ? undefined : spec);
    setDrafts(undefined);
  };
  function effectiveBallSpecFor(t: TableTexts): number {
    const spec = ballSetForGame(doc.ballSet, ballSet?.game, t.game);
    return resolveBallSet(spec)?.object.diameterM ?? ballDiameterM;
  }

  const onTableSelect = (value: string) => {
    if (value === CUSTOM) {
      if (!docCustom) setCustomFromPreset(true);
      return;
    }
    const preset = getTablePreset(value);
    if (!preset) return;
    setCustomFromPreset(false);
    setDrafts(undefined);
    setTable({ preset: preset.id }, { preset: preset.defaultBallSetId });
  };

  const edit = (patch: Partial<TableTexts>): TableTexts | undefined => {
    if (!texts) return undefined;
    const next = { ...texts, ...patch };
    setDrafts(next);
    return next;
  };

  const onUnits = (next: UnitSystem) => {
    if (drafts) setDrafts(reformatTexts(drafts, system, next));
    setSystem(next);
  };

  const ballSets = BALL_SETS.filter((b) => b.game === game || b.id === doc.ballSet.preset);

  return (
    <div className="setup-panel">
      <fieldset className="setup-group">
        <legend>Table</legend>
        <div className="setup-field">
          <label htmlFor={`${id}-table`}>Table</label>
          <select
            id={`${id}-table`}
            value={showCustom ? CUSTOM : (docPreset?.id ?? "")}
            onChange={(e) => {
              onTableSelect(e.target.value);
            }}
          >
            {TABLE_PRESETS.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
            <option value={CUSTOM}>Custom table…</option>
          </select>
          {docPreset && !showCustom && (
            <p className="setup-note">
              {playingAreaText(docPreset.playingArea.lengthM, docPreset.playingArea.widthM, system)}
            </p>
          )}
        </div>
      </fieldset>

      {showCustom && texts && result && (
        <SetupCustomTable
          texts={texts}
          result={result}
          onText={(field: LengthTextField, value: string) => {
            edit({ [field]: value });
          }}
          onGame={(g) => {
            const next = edit({ game: g });
            if (next) apply(next);
          }}
          onJaw={(jaw: JawStyle | "auto") => {
            const next = edit({ jawStyle: jaw });
            if (next) apply(next);
          }}
          onCommit={() => {
            if (drafts) apply(drafts);
          }}
        />
      )}

      <fieldset className="setup-group">
        <legend>Balls</legend>
        <div className="setup-field">
          <label htmlFor={`${id}-balls`}>Ball set</label>
          <select
            id={`${id}-balls`}
            value={doc.ballSet.preset}
            onChange={(e) => {
              setBallSet({ preset: e.target.value });
            }}
          >
            {ballSets.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
          {ballSet && (
            <p className="setup-note">
              Ball diameter {formatLength(ballDiameterM, system, { precision: 2 })}
            </p>
          )}
          {showCustom && result && (
            <FieldMessages id={`${id}-ball-msg`} field="ballDiameterM" result={result} />
          )}
        </div>
      </fieldset>

      <ClothSection cloth={doc.cloth} />

      <fieldset className="setup-group">
        <legend>Units</legend>
        <UnitsToggle value={system} onChange={onUnits} />
      </fieldset>
    </div>
  );
}
