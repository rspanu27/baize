import { Editor } from "./components/Editor";
import { Playground } from "./playground/Playground";

/** The editor, or the playable playground at `?playground`. */
export function App() {
  const playground =
    typeof window !== "undefined" && new URLSearchParams(window.location.search).has("playground");
  return playground ? <Playground /> : <Editor />;
}
