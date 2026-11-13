import { useEffect, useState } from "react";
import { docFromUrl, shareLink } from "../share/shareLink";
import { useDoc, useEditor } from "../store/store";
import "./SharePanel.css";

/**
 * Opens the diagram carried by the page address, and makes a link for the current one.
 * The link is only written to the address bar when the user asks for it, so the browser
 * history is not filled with every small edit.
 */
export function SharePanel() {
  const doc = useDoc();
  const openDoc = useEditor((s) => s.openDoc);
  const replaceDoc = useEditor((s) => s.replaceDoc);
  const [status, setStatus] = useState<{ kind: "idle" | "ok" | "problem"; text: string }>({
    kind: "idle",
    text: "",
  });

  // Open the diagram in the address when the page loads, and whenever the hash is changed
  // by hand or by the back and forward buttons.
  useEffect(() => {
    let cancelled = false;
    const open = (): void => {
      void docFromUrl(window.location.href).then((result) => {
        if (cancelled || !result) return;
        if (result.ok) {
          openDoc(result.doc);
          setStatus({ kind: "ok", text: "Opened the diagram from the link." });
        } else {
          setStatus({ kind: "problem", text: result.problem });
        }
      });
    };
    open();
    window.addEventListener("hashchange", open);
    return () => {
      cancelled = true;
      window.removeEventListener("hashchange", open);
    };
  }, [openDoc]);

  const copy = (): void => {
    void shareLink(doc, window.location.href).then(async ({ url, doc: shared, rounded }) => {
      // Show exactly what the link carries (one undo step), so both ends see the same shot.
      if (rounded && useEditor.getState().history.present === doc) replaceDoc(shared);
      // Put the link in the address bar too, without adding a history entry.
      window.history.replaceState(null, "", url);
      try {
        await navigator.clipboard.writeText(url);
        setStatus({ kind: "ok", text: "Link copied. Anyone with it sees this diagram." });
      } catch {
        setStatus({
          kind: "ok",
          text: "The link is in the address bar. Copy it from there to share.",
        });
      }
    });
  };

  return (
    <section className="share-panel">
      <h2>Share</h2>
      <button type="button" onClick={copy}>
        Copy link
      </button>
      <p className={`share-status share-${status.kind}`} role="status">
        {status.text}
      </p>
    </section>
  );
}
