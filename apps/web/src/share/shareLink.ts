import { docFromHash, docToHash } from "../doc/codec";
import type { DecodeResult } from "../doc/codec";
import type { DiagramDoc } from "../doc/types";

/**
 * Sharing by link: the whole diagram lives in the URL hash, so there is no server and nothing
 * is uploaded. These helpers are free of React and of the DOM, so they can be tested.
 */

/** The full link for a document, given the address of the page it is opened on. */
export async function shareUrl(doc: DiagramDoc, pageUrl: string): Promise<string> {
  const url = new URL(pageUrl);
  url.hash = "";
  // The playground switch is not part of a shared diagram.
  url.searchParams.delete("playground");
  return url.toString() + (await docToHash(doc));
}

/** JSON with object keys in a fixed order and absent values left out, for comparing documents. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) => {
    if (v === null || typeof v !== "object" || Array.isArray(v)) return v;
    const sorted: Record<string, unknown> = {};
    for (const k of Object.keys(v).sort()) sorted[k] = (v as Record<string, unknown>)[k];
    return sorted;
  });
}

export interface SharedLink {
  url: string;
  /**
   * The diagram exactly as the link carries it. A link stores positions to a hundredth of a
   * millimetre, and a hard shot into a pack is sensitive even to that, so the editor shows
   * this document after sharing: what the sender sees is what the receiver will see.
   */
  doc: DiagramDoc;
  /** True if `doc` differs from the document that was shared (it was rounded). */
  rounded: boolean;
}

/** Makes the link for a document, and reads back the document that the link carries. */
export async function shareLink(doc: DiagramDoc, pageUrl: string): Promise<SharedLink> {
  const url = await shareUrl(doc, pageUrl);
  const back = await docFromUrl(url);
  if (!back?.ok) return { url, doc, rounded: false };
  const rounded = canonical(back.doc) !== canonical(doc);
  return { url, doc: rounded ? back.doc : doc, rounded };
}

/**
 * The document in a link, if it has one. Undefined means the link carries no diagram; a
 * result with `ok: false` means it carries one that cannot be opened, with the reason.
 */
export async function docFromUrl(pageUrl: string): Promise<DecodeResult | undefined> {
  let hash: string;
  try {
    hash = new URL(pageUrl).hash;
  } catch {
    return undefined;
  }
  return docFromHash(hash);
}
