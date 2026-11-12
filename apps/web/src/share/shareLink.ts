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
