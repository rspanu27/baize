import { useSyncExternalStore } from "react";
import type { Orientation } from "./transform";

const QUERY = "(orientation: portrait) and (max-width: 800px)";

function subscribe(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  const media = window.matchMedia(QUERY);
  media.addEventListener("change", onChange);
  return () => {
    media.removeEventListener("change", onChange);
  };
}

function snapshot(): Orientation {
  if (typeof window === "undefined") return "landscape";
  return window.matchMedia(QUERY).matches ? "portrait" : "landscape";
}

/** The table is drawn upright on a phone held upright, and lengthways everywhere else. */
export function useOrientation(): Orientation {
  return useSyncExternalStore(subscribe, snapshot, () => "landscape");
}
