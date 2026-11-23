import { Component, Suspense, lazy, useEffect, useId, useRef, useState } from "react";
import type { ChangeEvent, ReactNode } from "react";
import type { Scene } from "../doc/resolve";
import type { DiagramTheme } from "../doc/types";
import { useTuning } from "../sim/tuning";
import type { Tuning } from "../sim/tuning";
import { simulationFor } from "../sim/useSimulation";
import { useDoc } from "../store/store";
import { VideoScreenView } from "./VideoScreenView";
import "./VideoScreen.css";

// The screen, the video code and Mediabunny are downloaded only when a clip is chosen.
const VideoScreen = lazy(() => import("./VideoScreen"));

export const CLIP_GUIDANCE =
  "Keep the camera still (a tripod or a propped phone), with the whole table in view and the diamonds visible. The clip stays on this device.";

/** File types offered when choosing a clip. */
export const CLIP_ACCEPT = "video/*,.mp4,.mov,.webm";

export const MESSAGE_SCREEN_FAILED =
  "The video screen could not be loaded. Check the connection and try again.";

export interface ClipImportViewProps {
  disabled: boolean;
  /** Changes (to a higher number) when the focus should return to the button. */
  focusToken: number;
  onChoose: (file: File) => void;
}

/** The "Overlay a clip" button, its hidden file input and the guidance. */
export function ClipImportView(props: ClipImportViewProps) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const { focusToken } = props;
  useEffect(() => {
    if (focusToken > 0) buttonRef.current?.focus();
  }, [focusToken]);
  return (
    <div className="toolbar-group clip-import">
      <h2>Video</h2>
      <button
        ref={buttonRef}
        type="button"
        disabled={props.disabled}
        aria-describedby={`${id}-about`}
        onClick={() => {
          inputRef.current?.click();
        }}
      >
        Overlay a clip
      </button>
      <input
        ref={inputRef}
        type="file"
        accept={CLIP_ACCEPT}
        hidden
        aria-label="Video clip of the table"
        tabIndex={-1}
        onChange={(e: ChangeEvent<HTMLInputElement>) => {
          const file = e.target.files?.[0];
          // The same clip can be chosen again.
          e.target.value = "";
          if (file) props.onChoose(file);
        }}
      />
      <p id={`${id}-about`} className="toolbar-note">
        {CLIP_GUIDANCE}
      </p>
    </div>
  );
}

/** Shows a plain message if the screen's code cannot be downloaded. */
class ScreenBoundary extends Component<
  { fileName: string; onClose: () => void; children: ReactNode },
  { failed: boolean }
> {
  override state = { failed: false };
  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }
  override render() {
    if (this.state.failed) {
      return (
        <VideoScreenView
          phase="error"
          message={MESSAGE_SCREEN_FAILED}
          fileName={this.props.fileName}
          onClose={this.props.onClose}
        />
      );
    }
    return this.props.children;
  }
}

/** What the screen works with, fixed when the clip is chosen. */
interface Opened {
  file: File;
  scene: Scene;
  tuning: Tuning;
  theme: DiagramTheme;
}

/**
 * Overlaying a clip: the entry in the editor, and the video screen while a clip is open. The
 * chosen file is held in this component's state only and handed to the screen; it is dropped
 * when the screen closes. Nothing is stored, shared or sent anywhere.
 */
export function ClipImport() {
  const doc = useDoc();
  const tuning = useTuning();
  const scene = simulationFor(doc, tuning).scene;
  const [focusToken, setFocusToken] = useState(0);
  const [opened, setOpened] = useState<Opened | undefined>(undefined);

  const close = () => {
    setOpened(undefined);
    setFocusToken((t) => t + 1);
  };

  return (
    <>
      <ClipImportView
        disabled={!scene}
        focusToken={focusToken}
        onChoose={(file) => {
          if (scene) {
            setOpened({ file, scene, tuning, theme: doc.style?.theme ?? "table" });
          }
        }}
      />
      {opened ? (
        <ScreenBoundary fileName={opened.file.name} onClose={close}>
          <Suspense
            fallback={
              <VideoScreenView phase="opening" fileName={opened.file.name} onClose={close} />
            }
          >
            <VideoScreen
              file={opened.file}
              scene={opened.scene}
              tuning={opened.tuning}
              theme={opened.theme}
              onClose={close}
            />
          </Suspense>
        </ScreenBoundary>
      ) : null}
    </>
  );
}
