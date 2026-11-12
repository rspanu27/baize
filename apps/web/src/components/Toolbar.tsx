import { canRedo, canUndo } from "../store/history";
import { useEditor } from "../store/store";

/** Undo and redo. Task 2.8 extends this with ball and rack controls. */
export function Toolbar() {
  const history = useEditor((s) => s.history);
  const undo = useEditor((s) => s.undo);
  const redo = useEditor((s) => s.redo);
  return (
    <div className="toolbar">
      <button type="button" onClick={undo} disabled={!canUndo(history)}>
        Undo
      </button>
      <button type="button" onClick={redo} disabled={!canRedo(history)}>
        Redo
      </button>
    </div>
  );
}
