// In-repo Lexical helper plugins.
//
// These are tiny Vue components rendered as children of `LexicalComposer`
// that use `useLexicalComposer()` to drive imperative editor APIs the
// `lexical-vue` package doesn't expose declaratively. They render nothing
// (return `null`) and exist only for their setup-time side effects.

import {
  $convertToMarkdownString,
  TRANSFORMERS,
  registerMarkdownShortcuts,
} from '@lexical/markdown';
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isElementNode,
  $isRangeSelection,
  COMMAND_PRIORITY_HIGH,
  KEY_ENTER_COMMAND,
  type LexicalEditor,
  type LexicalNode,
} from 'lexical';
import { defineComponent, onBeforeUnmount, onMounted, watch } from 'vue';
import { useLexicalComposer } from 'lexical-vue/LexicalComposer';
import { rendererLog } from '../ipc/rendererLog';
import { $isAttachmentNode } from './AttachmentNode';
import type { SendMessageAttachment } from '../ipc/types';
import { toErrorMessage } from '../lib/errorMessage';

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
export function consumeComposerText(
  editor: LexicalEditor,
): { text: string; attachments: SendMessageAttachment[] } | null {
  const state = editor.getEditorState();
  const plain = state.read(() => $getRoot().getTextContent());

  if (plain.trim().length === 0) return null;

  const markdown = state.read(() => $convertToMarkdownString(TRANSFORMERS));
  // Walk in document order picking up every AttachmentNode payload.
  // This is read OUTSIDE the editor.update() so the editor state is
  // still intact when we walk; the clear() below then discards
  // everything we already captured.
  const attachments: SendMessageAttachment[] = [];

  state.read(() => {
    const visit = (node: LexicalNode): void => {
      if ($isAttachmentNode(node)) {
        attachments.push(node.getAttachment());

        return;
      }

      if ($isElementNode(node)) {
        for (const child of node.getChildren()) visit(child);
      }
    };

    visit($getRoot());
  });
  editor.update(() => {
    $getRoot().clear();
  });
  const trimmed = markdown.trim();
  const text = trimmed.length === 0 ? plain.trim() : trimmed;

  return { text, attachments };
}

/// Registers the built-in markdown keystroke shortcuts (`# `, `** **`,
/// fenced code, lists, blockquote, link, hr, etc.) on the editor. Mounts
/// inside `LexicalComposer` so it has access to the provided editor.
export const RegisterMarkdownShortcuts = defineComponent({
  name: 'RegisterMarkdownShortcuts',
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
  name: 'EditableSync',
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

/// Submit-on-Ctrl-Enter behaviour for the composer.
///
/// New mapping (IDE convention — plain Enter is reserved for Lexical's
/// own paragraph-break command so markdown block breaks reach the
/// transcript):
///   * `Ctrl+Enter` -> emit `submit` with `mode: "default"`
///   * `Ctrl+Shift+Enter` -> emit `submit` with `mode: "interrupt"`
///   * `Alt+Enter` -> emit `submit` with `mode: "queue"` (explicit
///     non-default queue regardless of the session's default)
///   * `Enter` / `Shift+Enter` -> not consumed (Lexical default — new
///     paragraph / soft break respectively)
///   * IME composition (`event.isComposing` or `keyCode === 229`) ->
///     not consumed.
///
/// Lexical command priority: HIGH, so we run before the default Enter
/// handler. We only `return true` (consume) when one of our chord
/// matches fired — otherwise return false so the default paragraph
/// command can run.
///
/// `mode` semantics:
///   "default"   -> use the session's `defaultSendMode` (Steer by default)
///   "queue"     -> force the queue mode regardless of default
///   "interrupt" -> abort then send (force, regardless of default)
export type ComposerSubmitMode = 'default' | 'queue' | 'interrupt';
export interface ComposerSubmitPayload {
  text: string;
  mode: ComposerSubmitMode;
  attachments?: SendMessageAttachment[];
}

export const SubmitOnEnter = defineComponent({
  name: 'SubmitOnEnter',
  emits: ['submit'],
  setup(_, { emit }) {
    const editor = useLexicalComposer();
    const unregister = editor.registerCommand(
      KEY_ENTER_COMMAND,
      (event) => {
        const e = event;

        if (!e) return false;

        if (e.isComposing || e.key === 'Process') return false;

        // We only handle modifier chords. Plain Enter / Shift+Enter
        // fall through to Lexical's default paragraph / soft-break
        // commands so markdown block breaks work.
        const ctrl = e.ctrlKey || e.metaKey; // metaKey for macOS
        const isCtrlEnter = ctrl && !e.shiftKey && !e.altKey;
        const isCtrlShiftEnter = ctrl && e.shiftKey && !e.altKey;
        const isAltEnter = e.altKey && !ctrl && !e.shiftKey;
        let mode: ComposerSubmitMode | null = null;

        if (isCtrlEnter) mode = 'default';
        else if (isCtrlShiftEnter) mode = 'interrupt';
        else if (isAltEnter) mode = 'queue';

        if (mode === null) return false;

        e.preventDefault();
        const result = consumeComposerText(editor);

        if (result !== null) {
          const payload: ComposerSubmitPayload = {
            text: result.text,
            mode,
            ...(result.attachments.length > 0 ? { attachments: result.attachments } : {}),
          };

          emit('submit', payload);
        }

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
export { useLexicalComposer };

/// Dev-only diagnostic: on mount, log enough state to bun's JSON log so
/// we can figure out why typing might not work without needing WebView2
/// devtools open. Mount this inside `LexicalComposer`. Only fires when
/// the URL has `?diag=1`.
///
/// Logs:
/// - editor.isEditable() result
/// - root node count + first paragraph's text
/// - whether the contentEditable has `contenteditable=true`
/// - the result of programmatically inserting a test character through
///   `editor.update` + `selection.insertText` (bypasses the browser
///   input pipeline)
export const TypingDiagnostic = defineComponent({
  name: 'TypingDiagnostic',
  setup() {
    const editor = useLexicalComposer();

    function probe() {
      try {
        const root = editor.getRootElement();

        rendererLog('info', 'typing-diagnostic probe', {
          editable: editor.isEditable(),
          rootElement: root
            ? {
                tagName: root.tagName,
                contenteditable: root.getAttribute('contenteditable'),
                role: root.getAttribute('role'),
                ariaDisabled: root.getAttribute('aria-disabled'),
                dataLexicalEditor: root.getAttribute('data-lexical-editor'),
                hasChildren: root.childElementCount,
                outerSnippet: root.outerHTML.slice(0, 400),
              }
            : null,
        });

        // Programmatic insert. If this succeeds, the editor itself
        // works; any typing issue is in the browser input pipeline.
        editor.update(() => {
          const r = $getRoot();

          if (r.getChildrenSize() === 0) {
            const p = $createParagraphNode();

            r.append(p);
          }

          const para = r.getFirstChild();

          if (para && 'select' in para && typeof para.select === 'function') {
            (para as { select: () => unknown }).select();
          }

          const sel = $getSelection();

          if ($isRangeSelection(sel)) {
            sel.insertText('X');
          } else {
            const p = r.getFirstChild();

            if (p && 'append' in p && typeof p.append === 'function') {
              (p as { append: (n: ReturnType<typeof $createTextNode>) => unknown }).append(
                $createTextNode('X'),
              );
            }
          }
        });

        setTimeout(() => {
          editor.getEditorState().read(() => {
            const text = $getRoot().getTextContent();

            rendererLog('info', 'typing-diagnostic post-insert', {
              text,
              charCount: text.length,
            });
          });
          // Clean up so the diagnostic doesn't leave junk in the composer.
          editor.update(() => {
            $getRoot().clear();
            $getRoot().append($createParagraphNode());
          });
        }, 50);
      } catch (err) {
        rendererLog('error', 'typing-diagnostic threw', {
          message: toErrorMessage(err),
          stack: err instanceof Error ? err.stack : undefined,
        });
      }
    }

    onMounted(() => {
      // Wait one frame so the contenteditable is mounted by the
      // ContentEditableElement's own onMounted handler.
      setTimeout(probe, 100);
    });

    return () => null;
  },
});
