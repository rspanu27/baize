import { useState } from "react";
import {
  PNG_LONG_SIDE_PX,
  download,
  exportFileName,
  pixelSize,
  pngBlob,
  svgText,
} from "../export/exportDiagram";
import { isTuned, useTuning } from "../sim/tuning";
import { simulationFor } from "../sim/useSimulation";
import { useDoc } from "../store/store";

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Saving the diagram as a picture. Nothing leaves the browser. */
export function ExportPanel() {
  const doc = useDoc();
  const tuning = useTuning();
  const [problem, setProblem] = useState("");
  const tableName = simulationFor(doc).scene?.table.name ?? "diagram";

  const save = (kind: "svg" | "png"): void => {
    const svg = document.querySelector<SVGSVGElement>("svg.table-view");
    if (!svg) {
      setProblem("There is no table to save.");
      return;
    }
    setProblem("");
    const text = svgText(svg, PNG_LONG_SIDE_PX, isTuned(tuning));
    const name = exportFileName(tableName, today(), kind);
    if (kind === "svg") {
      download(new Blob([text], { type: "image/svg+xml" }), name);
      return;
    }
    const box = svg.viewBox.baseVal;
    pngBlob(text, pixelSize(box.width, box.height, PNG_LONG_SIDE_PX)).then(
      (blob) => {
        download(blob, name);
      },
      (e: unknown) => {
        setProblem(e instanceof Error ? e.message : "The image could not be saved.");
      },
    );
  };

  return (
    <section className="export-panel">
      <h2>Save as a picture</h2>
      <div className="measure-row">
        <button
          type="button"
          onClick={() => {
            save("png");
          }}
        >
          Download PNG
        </button>
        <button
          type="button"
          onClick={() => {
            save("svg");
          }}
        >
          Download SVG
        </button>
      </div>
      {problem ? (
        <p className="editor-problem" role="alert">
          {problem}
        </p>
      ) : null}
    </section>
  );
}
