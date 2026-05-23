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
import { openAttachment } from "../lib/openAttachment";

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
    // Capture the payload + derived values up-front. Lexical wraps
    // nodes in a read-only proxy after createDOM; reading
    // `this.__attachment` from event listeners later throws
    // "'get' on proxy: property '__attachment' is a read-only and
    // non-configurable data property...". Local-variable captures
    // sidestep the proxy entirely.
    const attachment = this.__attachment;
    const isImage =
      attachment.type === "blob" &&
      (attachment.mimeType ?? "").startsWith("image/");
    const label = labelForAttachment(attachment);

    const dom = document.createElement("span");
    dom.className = "composer-attachment-pill";
    dom.dataset.attachmentType = attachment.type;
    if (attachment.type === "commandResult") {
      dom.dataset.attachmentKind = "command-result";
    }
    if (isImage) {
      dom.dataset.attachmentKind = "image";
    }
    const icon = document.createElement("i");
    icon.className = `pi ${iconClassForAttachment(attachment, isImage)} composer-attachment-pill-icon`;
    icon.setAttribute("aria-hidden", "true");
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
      void openAttachment(attachment);
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
    return promptTextForAttachment(this.__attachment);
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
  if (a.type === "commandResult") return a.displayName ?? `Command: ${a.result.command}`;
  return "selection";
}

function promptTextForAttachment(a: SendMessageAttachment): string {
  return `(see attachment "${labelForAttachment(a)}")`;
}

function iconClassForAttachment(
  a: SendMessageAttachment,
  isImage: boolean,
): string {
  if (a.type === "directory") return "pi-folder";
  if (a.type === "selection") return "pi-bookmark";
  if (a.type === "commandResult") return "pi-terminal";
  if (isImage) return "pi-image";
  return "pi-file";
}

export function $createAttachmentNode(a: SendMessageAttachment): AttachmentNode {
  return new AttachmentNode(a);
}

export function $isAttachmentNode(
  node: LexicalNode | null | undefined,
): node is AttachmentNode {
  return node instanceof AttachmentNode;
}
