// Inline-pill Lexical node for composer attachments.
//
// Approach: subclass `TextNode` (rather than `DecoratorNode`) so the
// pill survives Lexical's normal text editing model — caret-walks
// across it, Backspace deletes it as a unit (`setMode("token")`),
// markdown export pipes its text through `$convertToMarkdownString`
// naturally. The chip styling lives on `.composer-attachment-pill`
// in `lexical.css`.
//
// On submit, `MessageComposer.onSubmit` walks the root in document
// order, picks up every `AttachmentNode`'s `getAttachment()` payload,
// and forwards them to `session.send` in that order — matching the
// user's mental model: "the pill at position N in the prompt is the
// Nth attachment in the array."

import {
  TextNode,
  type EditorConfig,
  type LexicalNode,
  type NodeKey,
  type SerializedTextNode,
  type Spread,
} from "lexical";
import type { SendMessageAttachment } from "../ipc/types";

export type SerializedAttachmentNode = Spread<
  { attachment: SendMessageAttachment },
  SerializedTextNode
>;

export class AttachmentNode extends TextNode {
  __attachment: SendMessageAttachment;

  static getType(): string {
    return "dafman-attachment";
  }

  static clone(node: AttachmentNode): AttachmentNode {
    return new AttachmentNode(node.__attachment, node.__text, node.__key);
  }

  constructor(attachment: SendMessageAttachment, text: string, key?: NodeKey) {
    super(text, key);
    this.__attachment = attachment;
    // Token mode = atomic deletion + caret can't land inside.
    this.setMode("token");
  }

  getAttachment(): SendMessageAttachment {
    return this.__attachment;
  }

  createDOM(config: EditorConfig): HTMLElement {
    const dom = super.createDOM(config);
    dom.classList.add("composer-attachment-pill");
    dom.setAttribute("data-attachment-type", this.__attachment.type);
    if (this.__attachment.type === "blob") {
      const mime = this.__attachment.mimeType ?? "";
      if (mime.startsWith("image/")) {
        dom.setAttribute("data-attachment-kind", "image");
      }
    }
    dom.setAttribute("title", labelForAttachment(this.__attachment));
    return dom;
  }

  static importJSON(json: SerializedAttachmentNode): AttachmentNode {
    return new AttachmentNode(json.attachment, json.text);
  }

  exportJSON(): SerializedAttachmentNode {
    return {
      ...super.exportJSON(),
      attachment: this.__attachment,
      type: "dafman-attachment",
      version: 1,
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

export function $createAttachmentNode(a: SendMessageAttachment): AttachmentNode {
  const label = labelForAttachment(a);
  return new AttachmentNode(a, `(${label})`);
}

export function $isAttachmentNode(
  node: LexicalNode | null | undefined,
): node is AttachmentNode {
  return node instanceof AttachmentNode;
}
