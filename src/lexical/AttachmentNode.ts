// Inline-pill Lexical node for composer attachments.
//
// Implemented as a `DecoratorNode` (not a `TextNode` subclass) because
// the pill is fundamentally a single atomic symbol, not a string of
// characters that happen to be styled:
//
//   * caret nav (Left/Right) crosses the pill in ONE keystroke, not
//     character-by-character — that's the default for DecoratorNode.
//   * Backspace deletes the whole pill — also DecoratorNode default
//     when selected via `isKeyboardSelectable`.
//   * We fully own the DOM (`createDOM`) so we can render the
//     filename without brackets and wire up click-to-open.
//
// Earlier iteration used a TextNode subclass + `setMode("token")` in
// the constructor, which infinitely recursed: setMode -> getWritable
// -> clone -> new AttachmentNode(...) -> setMode -> ...
//
// On submit, `consumeComposerText` walks the root in document order
// and pulls every AttachmentNode's `getAttachment()` payload into the
// `attachments` array. Pill position N in the text === attachments[N]
// in the SDK payload.

import {
  DecoratorNode,
  type EditorConfig,
  type LexicalNode,
  type NodeKey,
  type SerializedLexicalNode,
  type Spread,
} from "lexical";
import type { SendMessageAttachment } from "../ipc/types";
import { invokeCommand } from "../ipc/invoke";

export type SerializedAttachmentNode = Spread<
  { attachment: SendMessageAttachment },
  SerializedLexicalNode
>;

export class AttachmentNode extends DecoratorNode<null> {
  __attachment: SendMessageAttachment;

  static getType(): string {
    return "dafman-attachment";
  }

  static clone(node: AttachmentNode): AttachmentNode {
    return new AttachmentNode(node.__attachment, node.__key);
  }

  constructor(attachment: SendMessageAttachment, key?: NodeKey) {
    super(key);
    this.__attachment = attachment;
  }

  getAttachment(): SendMessageAttachment {
    return this.__attachment;
  }

  isInline(): boolean {
    return true;
  }

  isKeyboardSelectable(): boolean {
    return true;
  }

  createDOM(_config: EditorConfig): HTMLElement {
    const dom = document.createElement("span");
    dom.className = "composer-attachment-pill";
    dom.dataset.attachmentType = this.__attachment.type;
    const isImage =
      this.__attachment.type === "blob" &&
      (this.__attachment.mimeType ?? "").startsWith("image/");
    if (isImage) {
      dom.dataset.attachmentKind = "image";
    }
    const icon = document.createElement("i");
    icon.className = `pi ${iconClassForAttachment(this.__attachment, isImage)} composer-attachment-pill-icon`;
    icon.setAttribute("aria-hidden", "true");
    const label = labelForAttachment(this.__attachment);
    const text = document.createElement("span");
    text.className = "composer-attachment-pill-label";
    text.textContent = label;
    dom.appendChild(icon);
    dom.appendChild(text);
    dom.title = label;
    // contenteditable=false so the browser treats the pill as a single
    // atomic widget for caret nav + selection. Lexical complements
    // this with DecoratorNode's own selection model.
    dom.setAttribute("contenteditable", "false");
    dom.style.cursor = "pointer";
    dom.addEventListener("mousedown", (e) => {
      // Prevent the editor from collapsing the selection inside the
      // pill on mousedown — we want a clean click that opens the
      // attachment without disturbing the caret.
      e.preventDefault();
    });
    dom.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      void openAttachment(this.__attachment);
    });
    return dom;
  }

  updateDOM(): boolean {
    // Pill content is immutable for the lifetime of the node — no
    // re-render needed on Lexical reconcile.
    return false;
  }

  decorate(): null {
    // All visual content lives in createDOM. lexical-vue mounts the
    // (null) decoration as a no-op.
    return null;
  }

  getTextContent(): string {
    // Plain-text serialization for the LLM prompt — just the
    // filename inline, no brackets. The structured attachment is sent
    // separately via the SDK's `attachments` field.
    return labelForAttachment(this.__attachment);
  }

  static importJSON(json: SerializedAttachmentNode): AttachmentNode {
    return new AttachmentNode(json.attachment);
  }

  exportJSON(): SerializedAttachmentNode {
    return {
      type: "dafman-attachment",
      version: 1,
      attachment: this.__attachment,
    };
  }
}

export function labelForAttachment(a: SendMessageAttachment): string {
  if (a.type === "file" || a.type === "directory") {
    return a.displayName ?? a.path.split(/[\\/]/).pop() ?? a.path;
  }
  if (a.type === "blob") return a.displayName ?? "attachment";
  return "selection";
}

function iconClassForAttachment(
  a: SendMessageAttachment,
  isImage: boolean,
): string {
  if (a.type === "directory") return "pi-folder";
  if (a.type === "selection") return "pi-bookmark";
  if (isImage) return "pi-image";
  return "pi-file";
}

/// Open an attachment for inspection. File / directory attachments
/// reveal in the OS file explorer via the bun-side `revealPath`. Blob
/// attachments (pasted screenshots etc.) pop a viewer window via an
/// object URL. Best-effort — errors are swallowed because this is an
/// inspect/preview convenience, not a critical path.
async function openAttachment(a: SendMessageAttachment): Promise<void> {
  if (a.type === "file" || a.type === "directory") {
    try {
      await invokeCommand("revealPath", { path: a.path });
    } catch {
      /* best-effort */
    }
    return;
  }
  if (a.type === "blob") {
    try {
      const bin = atob(a.data);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const blob = new Blob([bytes], { type: a.mimeType });
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank");
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch {
      /* best-effort */
    }
  }
}

export function $createAttachmentNode(a: SendMessageAttachment): AttachmentNode {
  return new AttachmentNode(a);
}

export function $isAttachmentNode(
  node: LexicalNode | null | undefined,
): node is AttachmentNode {
  return node instanceof AttachmentNode;
}
