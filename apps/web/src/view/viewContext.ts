import { createContext, useContext } from "react";
import type { ViewTransform } from "./transform";

/** Provided by `TableView`; children use it to place things in table coordinates. */
export const ViewTransformContext = createContext<ViewTransform | undefined>(undefined);

export function useViewTransform(): ViewTransform {
  const t = useContext(ViewTransformContext);
  if (!t) throw new Error("useViewTransform must be used inside a TableView.");
  return t;
}
