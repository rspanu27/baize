import { createContext, useContext } from "react";
import { resolveDrawStyle } from "./theme";
import type { DrawStyle } from "./theme";

/**
 * Provided by `TableView` from the document's style. Without a provider (the ball palette, a
 * component on its own) everything is drawn in the default look.
 */
export const DrawStyleContext = createContext<DrawStyle>(resolveDrawStyle(undefined));

export function useDrawStyle(): DrawStyle {
  return useContext(DrawStyleContext);
}
