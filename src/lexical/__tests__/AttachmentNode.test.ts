// Lexical-level smoke test for AttachmentNode.
//
// The previous TextNode-subclass implementation infinite-recursed on
// construction because the constructor called `setMode("token")` which
// triggers `getWritable()` -> `clone()` -> `new AttachmentNode(...)` ->
// `setMode(...)`. Build a real editor here so any future regression
// (e.g. accidentally re-adding setMode to the constructor) trips at
// `bun test` instead of in production.

import { describe, expect, test } from "bun:test";
import { createEditor, $getRoot, $createParagraphNode, $isElementNode } from "lexical";
import { AttachmentNode, $createAttachmentNode, $isAttachmentNode } from "../AttachmentNode";
import type { SendMessageAttachment } from "../../ipc/types";

function makeEditor() {
  // No `theme` / `onError` — we only care that construction + state
  // transitions don't throw.
  return createEditor({
    namespace: "AttachmentNodeTest",
    nodes: [AttachmentNode],
    onError: (e) => {
      throw e;
    },
  });
}

const sampleFile: SendMessageAttachment = {
  type: "file",
  path: "/abs/path/to/sample.ts",
  displayName: "src/sample.ts",
};

const sampleImage: SendMessageAttachment = {
  type: "blob",
  data: "Zm9v",
  mimeType: "image/png",
  displayName: "screenshot.png",
};

describe("AttachmentNode", () => {
  test("constructs without infinite recursion (regression: setMode in ctor)", () => {
    const editor = makeEditor();
    editor.update(
      () => {
        const node = new AttachmentNode(sampleFile);
        expect(node).toBeInstanceOf(AttachmentNode);
        expect(node.getAttachment()).toBe(sampleFile);
      },
      { discrete: true },
    );
  });

  test("$createAttachmentNode and $isAttachmentNode discriminate correctly", () => {
    const editor = makeEditor();
    editor.update(
      () => {
        const node = $createAttachmentNode(sampleFile);
        expect($isAttachmentNode(node)).toBe(true);
        expect($isAttachmentNode(null)).toBe(false);
      },
      { discrete: true },
    );
  });

  test("getTextContent returns the bare filename (no brackets)", () => {
    const editor = makeEditor();
    editor.update(
      () => {
        const node = new AttachmentNode(sampleFile);
        expect(node.getTextContent()).toBe("src/sample.ts");
        const imageNode = new AttachmentNode(sampleImage);
        expect(imageNode.getTextContent()).toBe("screenshot.png");
      },
      { discrete: true },
    );
  });

  test("inserts into an editor paragraph and walks back out via getTextContent", () => {
    const editor = makeEditor();
    editor.update(
      () => {
        const root = $getRoot();
        const p = $createParagraphNode();
        p.append($createAttachmentNode(sampleFile));
        root.append(p);
      },
      { discrete: true },
    );
    const text = editor.read(() => $getRoot().getTextContent());
    // No brackets, just the filename embedded in document order.
    expect(text).toContain("src/sample.ts");
  });

  test("exportJSON / importJSON round-trip preserves the attachment payload", () => {
    const editor = makeEditor();
    editor.update(
      () => {
        const node = new AttachmentNode(sampleFile);
        const json = node.exportJSON();
        expect(json.type).toBe("dafman-attachment");
        expect(json.attachment).toEqual(sampleFile);
        const restored = AttachmentNode.importJSON(json);
        expect(restored.getAttachment()).toEqual(sampleFile);
      },
      { discrete: true },
    );
  });

  test("clone preserves attachment (no recursion)", () => {
    const editor = makeEditor();
    editor.update(
      () => {
        const node = new AttachmentNode(sampleFile);
        const cloned = AttachmentNode.clone(node);
        expect(cloned).toBeInstanceOf(AttachmentNode);
        expect(cloned.getAttachment()).toBe(sampleFile);
      },
      { discrete: true },
    );
  });

  test("walks find AttachmentNodes in document order — submit-extraction contract", () => {
    const editor = makeEditor();
    editor.update(
      () => {
        const root = $getRoot();
        const p = $createParagraphNode();
        p.append($createAttachmentNode(sampleFile));
        p.append($createAttachmentNode(sampleImage));
        root.append(p);
      },
      { discrete: true },
    );
    const collected: SendMessageAttachment[] = [];
    editor.read(() => {
      const visit = (n: import("lexical").LexicalNode): void => {
        if ($isAttachmentNode(n)) {
          collected.push(n.getAttachment());
          return;
        }
        if ($isElementNode(n)) {
          for (const c of n.getChildren()) visit(c);
        }
      };
      visit($getRoot());
    });
    expect(collected).toEqual([sampleFile, sampleImage]);
  });
});
