/**
 * Opening a document: its bytes in a dialog (moved from the retired Case Detail
 * screen, ADR-048). Read-only: opening a document is not a decision about it.
 */

import { useEffect, useState, type ReactNode } from "react";

import { apiDownload } from "../api/client.js";
import { documentPreviewMode, previewFallbackMessage } from "../screens/document-preview.js";
import { Button, Modal } from "./index.js";

/**
 * A document's bytes, on screen.
 *
 * The bytes are fetched with the session's bearer token (the storage route is
 * not public, and an `<img src>` cannot carry an Authorization header), turned
 * into an object URL, and handed to whichever element can render that type.
 * The URL is revoked when the dialog closes — an object URL that outlives its
 * dialog keeps the whole file alive in memory for as long as the tab is open,
 * and a login executive works through dozens of these in a morning.
 */
export function DocumentPreview({
  documentId,
  fileName,
}: {
  documentId: string;
  fileName: string | null;
}): ReactNode {
  const [state, setState] = useState<
    | { status: "loading" }
    | { status: "error"; message: string }
    | { status: "ready"; url: string; mimeType: string; name: string }
  >({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    let objectUrl: string | null = null;

    setState({ status: "loading" });
    apiDownload(`/documents/${documentId}/download`)
      .then(({ blob, fileName: served }) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setState({
          status: "ready",
          url: objectUrl,
          mimeType: blob.type,
          name: fileName ?? served,
        });
      })
      .catch(() => {
        if (cancelled) return;
        setState({
          status: "error",
          message: "This document could not be loaded. It may have been removed from storage.",
        });
      });

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [documentId, fileName]);

  if (state.status === "loading") {
    return (
      <div className="flex h-64 items-center justify-center rounded-md bg-ink-50 text-sm text-ink-500">
        Loading document…
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900" role="alert">
        {state.message}
      </p>
    );
  }

  const mode = documentPreviewMode(state.mimeType, state.name);

  return (
    <div className="space-y-2">
      {mode === "image" && (
        <img
          src={state.url}
          alt={state.name}
          className="max-h-[60vh] w-full rounded-md bg-ink-50 object-contain"
        />
      )}

      {mode === "pdf" && (
        // The browser's own PDF viewer. No PDF.js: shipping a renderer to read
        // a PAN card is a large dependency to solve a problem Chrome and Edge
        // already solve, and the office runs both.
        <iframe
          src={state.url}
          title={state.name}
          className="h-[60vh] w-full rounded-md border border-ink-200 bg-ink-50"
        />
      )}

      {mode === "download_only" && (
        <div className="space-y-2 rounded-md bg-ink-50 px-3 py-4">
          <p className="text-sm text-ink-700">{previewFallbackMessage(state.name)}</p>
          {/* A real link, not a scripted click: this is the one place a save is
              what was actually asked for. */}
          <a
            href={state.url}
            download={state.name}
            className="inline-block text-sm text-brand-600 hover:underline"
          >
            Download {state.name}
          </a>
        </div>
      )}

      <p className="tnum text-xs text-ink-500">{state.name}</p>
    </div>
  );
}

/** Read-only. Opening a document is not a decision about it, so this dialog
 * has no verdict buttons — only a way out. */
export function ViewDocumentDialog({
  title,
  documentId,
  fileName,
  onClose,
}: {
  title: string;
  documentId: string;
  fileName: string | null;
  onClose: () => void;
}): ReactNode {
  return (
    <Modal open title={title} onClose={onClose} size="wide">
      <div className="space-y-3">
        <DocumentPreview documentId={documentId} fileName={fileName} />
        <div className="flex justify-end">
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </Modal>
  );
}
