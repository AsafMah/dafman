// Composer attachment ingestion — drag/drop + clipboard paste pipelines
// for converting File/Blob into the SDK's `SendMessageAttachment`
// blob shape. Extracted from MessageComposer.vue (Phase D.4.3).
//
// The caller passes:
// - `addAttachment` — typically the same function that inserts an
//   `AttachmentNode` into the Lexical editor
// - `toasts` — a toast port to surface size-rejected files
//
// `MAX_BLOB_BYTES` (8 MiB) is a safety cap on what we'll base64-encode
// inline; anything larger surfaces a warn toast and is skipped.

import type { SendMessageAttachment } from '@/ipc/types';

export const MAX_BLOB_BYTES = 8 * 1024 * 1024;

export interface ComposerAttachmentToasts {
  warn(summary: string, detail?: string): void;
}

export interface UseComposerAttachmentsOptions {
  addAttachment: (attachment: SendMessageAttachment) => void;
  toasts: ComposerAttachmentToasts;
}

export interface UseComposerAttachmentsReturn {
  onDrop: (event: DragEvent) => Promise<void>;
  onPaste: (event: ClipboardEvent) => Promise<void>;
}

/// Read a File/Blob into a base64 SDK blob attachment. Wraps the
/// FileReader API in a promise so drag-drop / paste handlers stay
/// flat. Returns `null` (after a toast) when the file exceeds the
/// inline size cap.
export async function blobFromFile(
  file: File,
  toasts: ComposerAttachmentToasts,
): Promise<SendMessageAttachment | null> {
  if (file.size > MAX_BLOB_BYTES) {
    toasts.warn(
      'File too large',
      `${file.name} is ${(file.size / 1024 / 1024).toFixed(1)} MiB. Max is 8 MiB.`,
    );

    return null;
  }

  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  // Chunk to avoid stack overflows on String.fromCharCode(...big-array).
  let bin = '';
  const CHUNK = 0x8000;

  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }

  const data = btoa(bin);

  return {
    type: 'blob',
    data,
    mimeType: file.type || 'application/octet-stream',
    displayName: file.name,
  };
}

export function useComposerAttachments(
  opts: UseComposerAttachmentsOptions,
): UseComposerAttachmentsReturn {
  async function onDrop(event: DragEvent): Promise<void> {
    event.preventDefault();
    const files = event.dataTransfer?.files;

    if (!files || files.length === 0) return;

    for (const f of Array.from(files)) {
      const a = await blobFromFile(f, opts.toasts);

      if (a) opts.addAttachment(a);
    }
  }

  async function onPaste(event: ClipboardEvent): Promise<void> {
    const items = event.clipboardData?.items;

    if (!items) return;

    for (const item of Array.from(items)) {
      if (item.kind !== 'file') continue;

      const f = item.getAsFile();

      if (!f) continue;

      event.preventDefault();
      const a = await blobFromFile(f, opts.toasts);

      if (a) opts.addAttachment(a);
    }
  }

  return { onDrop, onPaste };
}
