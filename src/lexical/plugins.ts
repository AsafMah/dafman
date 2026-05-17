// In-repo Lexical helper plugins.
//
// These are tiny Vue components rendered as children of `LexicalComposer`
// that use `useLexicalComposer()` to drive imperative editor APIs the
// `lexical-vue` package doesn't expose declaratively. They render nothing
// (return `null`) and exist only for their setup-time side effects.

import {
  $convertFromMarkdownString,
  $convertToMarkdownString,
  TRANSFORMERS,
  registerMarkdownShortcuts,
} from "@lexical/markdown";
import {
  $getRoot,
  COMMAND_PRIORITY_HIGH,
  KEY_ENTER_COMMAND,
  type LexicalEditor,
} from "lexical";
import { defineComponent, onBeforeUnmount, watch } from "vue";
import { useLexicalComposer } from "lexical-vue/LexicalComposer";

/// Extract the editor content as a markdown string, trim it, clear the
/// editor, and return the result. Returns `null` when the buffer was
/// empty/whitespace-only. Shared between the Enter keybinding and the
/// click-to-send button so there's a single submit code path.
///
/// We round-trip through `$convertToMarkdownString` so any rich
/// formatting the user produced via `registerMarkdownShortcuts`
/// (`**bold**`, `# heading`, fenced code, lists, links, etc.) survives
/// the send and is rendered consistently by `MessageContent` on the
/// other end.
export function consumeComposerText(editor: LexicalEditor): string | null {
  const state = editor.getEditorState();
  const plain = state.read(() => $getRoot().getTextContent());
  if (plain.trim().length === 0) return null;
  const markdown = state.read(() => $convertToMarkdownString(TRANSFORMERS));
  editor.update(() => {
    $getRoot().clear();
  });
  const trimmed = markdown.trim();
  return trimmed.length === 0 ? plain.trim() : trimmed;
}

/// Registers the built-in markdown keystroke shortcuts (`# `, `** **`,
/// fenced code, lists, blockquote, link, hr, etc.) on the editor. Mounts
/// inside `LexicalComposer` so it has access to the provided editor.
export const RegisterMarkdownShortcuts = defineComponent({
  name: "RegisterMarkdownShortcuts",
  setup() {
    const editor = useLexicalComposer();
    const unregister = registerMarkdownShortcuts(editor, TRANSFORMERS);
    onBeforeUnmount(() => unregister());
    return () => null;
  },
});

/// Keeps `editor.setEditable` in sync with a reactive prop. Lexical only
/// reads `initialConfig.editable` on mount, so without this the composer
/// would stay editable forever even after `disabled` flips to `true`.
export const EditableSync = defineComponent({
  name: "EditableSync",
  props: { editable: { type: Boolean, required: true } },
  setup(props) {
    const editor = useLexicalComposer();
    watch(
      () => props.editable,
      (next) => editor.setEditable(next),
      { immediate: true },
    );
    return () => null;
  },
});

/// Submit-on-Enter behaviour for the composer.
///
/// * Plain Enter -> emit `submit` with the current plain-text content and
///   clear the editor. Empty/whitespace-only buffers are ignored.
/// * Shift+Enter -> fall through to Lexical's default (newline).
/// * IME composition (`event.isComposing` or `keyCode === 229`) -> no-op.
export const SubmitOnEnter = defineComponent({
  name: "SubmitOnEnter",
  emits: ["submit"],
  setup(_, { emit }) {
    const editor = useLexicalComposer();
    const unregister = editor.registerCommand(
      KEY_ENTER_COMMAND,
      (event) => {
        const e = event as KeyboardEvent | null;
        if (!e) return false;
        if (e.shiftKey) return false;
        if (e.isComposing || e.keyCode === 229) return false;
        e.preventDefault();
        const text = consumeComposerText(editor);
        if (text !== null) emit("submit", text);
        return true;
      },
      COMMAND_PRIORITY_HIGH,
    );
    onBeforeUnmount(() => unregister());
    return () => null;
  },
});

/// One-way binding from a markdown `text` prop into the editor state.
///
/// Used by `MessageContent` to render streaming assistant output. We
/// coalesce rapid prop changes via `requestAnimationFrame` so a burst of
/// 5-30 deltas/sec doesn't trigger one full reconcile per delta. The
/// last pending value always wins.
export const MarkdownSync = defineComponent({
  name: "MarkdownSync",
  props: { markdown: { type: String, required: true } },
  setup(props) {
    const editor = useLexicalComposer();
    let pending: string | null = null;
    let rafHandle: number | null = null;

    const flush = () => {
      rafHandle = null;
      if (pending === null) return;
      const next = pending;
      pending = null;
      editor.update(() => {
        const root = $getRoot();
        root.clear();
        $convertFromMarkdownString(next, TRANSFORMERS, root, false, false);
      });
    };

    const schedule = (value: string) => {
      pending = value;
      if (rafHandle !== null) return;
      const raf =
        typeof requestAnimationFrame !== "undefined"
          ? requestAnimationFrame
          : (cb: FrameRequestCallback) => {
              return setTimeout(
                () => cb(typeof performance !== "undefined" ? performance.now() : Date.now()),
                16,
              ) as unknown as number;
            };
      rafHandle = raf(flush);
    };

    watch(
      () => props.markdown,
      (next) => schedule(next),
      { immediate: true },
    );

    onBeforeUnmount(() => {
      if (rafHandle !== null && typeof cancelAnimationFrame !== "undefined") {
        cancelAnimationFrame(rafHandle);
      }
      pending = null;
      rafHandle = null;
    });

    return () => null;
  },
});

export { useLexicalComposer };
