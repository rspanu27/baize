import type { PhotoImage } from "@baize/vision";
import { useEffect, useId, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { simulationFor } from "../sim/useSimulation";
import { useDoc } from "../store/store";
import { createAnalyser } from "./analyser";
import type { PhotoAnalyser } from "./analyser";
import { decodePhoto } from "./decode";
import { PhotoReviewDialog } from "./PhotoReview";
import type { PhotoReviewDialogProps } from "./PhotoReview";
import { reviewBalls } from "./reviewModel";
import "./PhotoReview.css";

export const PHOTO_GUIDANCE =
  "Stand at a corner of the table at about standing height. Keep all six pockets in the picture. Avoid glare from lamps. The photo stays on this device.";

export interface PhotoImportViewProps {
  disabled: boolean;
  /** "Reading the photo…" while the photo is being read and analysed. */
  busy: boolean;
  error: string | undefined;
  /** Changes (to a higher number) when the focus should return to the button. */
  focusToken: number;
  onChoose: (file: File) => void;
}

/** The "Import from photo" button, its hidden file input and the guidance. */
export function PhotoImportView(props: PhotoImportViewProps) {
  const id = useId();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const { focusToken } = props;
  useEffect(() => {
    if (focusToken > 0) buttonRef.current?.focus();
  }, [focusToken]);
  return (
    <div className="toolbar-group photo-import">
      <h2 id={`${id}-title`}>Photo</h2>
      <button
        ref={buttonRef}
        type="button"
        disabled={props.disabled || props.busy}
        aria-describedby={`${id}-about`}
        onClick={() => {
          inputRef.current?.click();
        }}
      >
        Import from photo
      </button>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        aria-label="Photo of the table"
        tabIndex={-1}
        onChange={(e: ChangeEvent<HTMLInputElement>) => {
          const file = e.target.files?.[0];
          // The same photo can be chosen again.
          e.target.value = "";
          if (file) props.onChoose(file);
        }}
      />
      <p id={`${id}-about`} className="toolbar-note">
        {PHOTO_GUIDANCE}
      </p>
      {props.busy ? (
        <p className="toolbar-note" role="status">
          Reading the photo…
        </p>
      ) : null}
      {props.error ? (
        <p className="photo-error" role="alert">
          {props.error}
        </p>
      ) : null}
    </div>
  );
}

interface Review {
  image: PhotoImage;
  analyser: PhotoAnalyser;
  photoUrl: string;
  initial: PhotoReviewDialogProps["initial"];
}

/**
 * Photo import. The chosen file is read into memory here and in the review; the photo, its
 * pixels and its object URL are kept in this component's state only, and are dropped (and the
 * URL revoked) when the review closes. The analysis runs in a worker of this page, which holds
 * a copy of the pixels and is ended when the review closes. Nothing is stored, shared or sent
 * anywhere.
 */
export function PhotoImport() {
  const doc = useDoc();
  const scene = simulationFor(doc).scene;
  const [focusToken, setFocusToken] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [review, setReview] = useState<Review | undefined>(undefined);

  // Revoke the object URL and end the worker when the review closes or this component goes
  // away.
  useEffect(() => {
    if (!review) return;
    const { photoUrl: url, analyser } = review;
    return () => {
      URL.revokeObjectURL(url);
      analyser.dispose();
    };
  }, [review]);

  const choose = (file: File) => {
    if (!scene) return;
    setError(undefined);
    setBusy(true);
    void (async () => {
      let photoUrl: string | undefined;
      let analyser: PhotoAnalyser | undefined;
      try {
        const image = await decodePhoto(file);
        analyser = createAnalyser(image);
        const result = await analyser.run(scene.table, scene.ballSet);
        photoUrl = URL.createObjectURL(file);
        setReview({
          image,
          analyser,
          photoUrl,
          initial: {
            ...(result.problem ? { problem: result.problem } : {}),
            ...(result.corners ? { corners: result.corners } : {}),
            ...(result.diagnostics.camera ? { camera: result.diagnostics.camera } : {}),
            cornersDetected: result.diagnostics.cornersDetected,
            balls: reviewBalls(result.layout),
          },
        });
      } catch (e) {
        if (photoUrl) URL.revokeObjectURL(photoUrl);
        analyser?.dispose();
        setError(e instanceof Error ? e.message : "The photo could not be read.");
      } finally {
        setBusy(false);
      }
    })();
  };

  return (
    <>
      <PhotoImportView
        disabled={!scene}
        busy={busy}
        error={error}
        focusToken={focusToken}
        onChoose={choose}
      />
      {review && scene ? (
        <PhotoReviewDialog
          image={review.image}
          analyser={review.analyser}
          photoUrl={review.photoUrl}
          initial={review.initial}
          table={scene.table}
          ballSet={scene.ballSet}
          onClose={() => {
            setReview(undefined);
            setFocusToken((t) => t + 1);
          }}
        />
      ) : null}
    </>
  );
}
