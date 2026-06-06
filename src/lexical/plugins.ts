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
  INSERT_LINE_BREAK_COMMAND,
  INSERT_PARAGRAPH_COMMAND,
  KEY_ENTER_COMMAND,
  type LexicalEditor,
  type LexicalNode,
} from 'lexical';
import { defineComponent, onBeforeUnmount, onMounted, watch } from 'vue';
import { useLexicalComposer } from 'lexical-vue/LexicalComposer';
import { rendererLog } from '@/ipc/rendererLog';
import { $isAttachmentNode } from '@/lexical/AttachmentNode';
import { isComposerMenuActive } from '@/lexical/composerMenuState';
import type { SendMessageAttachment } from '@/ipc/types';
import { toErrorMessage } from '@/lib/errorMessage';

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

/// Fixed composer keybinding scheme (conventional chat — plain Enter
/// sends). Mapping:
///   * `Enter`              -> submit `default` (resolves to the session's
///                             Steer/Queue toggle), UNLESS a slash/mention
///                             typeahead menu is open with a selectable
///                             option — then we DEFER so Enter selects the
///                             menu item.
///   * `Shift+Enter`        -> soft line break. While a menu is open we
///                             consume + dispatch `INSERT_LINE_BREAK_COMMAND`
///                             (the LOW typeahead handler is modifier-blind
///                             and would otherwise SELECT an option); with
///                             no menu we pass through to Lexical's default.
///   * `Ctrl/Cmd+Enter`     -> hard newline (new paragraph). Consumed at
///                             HIGH + dispatched explicitly so it inserts a
///                             break even while a menu is open.
///   * `Ctrl+Shift+Enter`   -> submit `queue` (force, regardless of default)
///   * `Alt+Enter`          -> submit `steer` (force, regardless of default)
///   * `Ctrl+Alt+Enter`     -> submit `interrupt` (abort then send, force)
///   * IME composition (`event.isComposing` / `key === 'Process'`) -> never
///     consumed.
///
/// Lexical command priority: HIGH, so we run before the default Enter
/// handler AND before the typeahead menus' LOW handler. We `return true`
/// (consume) when we submit or insert a break; `return false`
/// (passthrough/defer) otherwise.
///
/// `mode` (submit) semantics:
///   "default"   -> use the session's `defaultSendMode` (Steer by default)
///   "steer"     -> force steer (send immediately into the current turn)
///   "queue"     -> force queue (wait behind the current turn)
///   "interrupt" -> abort then send (force, regardless of default)
export type ComposerSubmitMode = 'default' | 'steer' | 'queue' | 'interrupt';
export interface ComposerSubmitPayload {
  text: string;
  mode: ComposerSubmitMode;
  attachments?: SendMessageAttachment[];
}

/// The action a given Enter keystroke should produce. Split out as a
/// pure value so the keybinding decision matrix is unit-testable without
/// mounting a Lexical editor, and so the command handler stays well under
/// the ESLint complexity cap.
export type EnterAction =
  | { type: 'submit'; mode: ComposerSubmitMode }
  | { type: 'insertParagraph' }
  | { type: 'insertLineBreak' }
  | { type: 'passthrough' };

/// Minimal shape we read off the Enter `KeyboardEvent`. Declared so the
/// resolver can be tested with plain object literals.
export interface EnterChord {
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

/// The modifier combination of an Enter keystroke, normalized so the
/// action resolver can `switch` instead of chaining boolean guards (keeps
/// each function well under the ESLint complexity cap). `ctrl` folds in
/// `metaKey` (macOS Cmd). The key string is built in a fixed `c`/`s`/`a`
/// order, so e.g. Ctrl+Alt is always `'ca'`. Unrecognized combinations
/// (e.g. Ctrl+Shift+Alt) map to `'other'`.
export type EnterChordKind =
  | 'ctrl'
  | 'ctrl-shift'
  | 'ctrl-alt'
  | 'alt'
  | 'shift'
  | 'plain'
  | 'other';

export function classifyEnterChord(e: EnterChord): EnterChordKind {
  const ctrl = e.ctrlKey || e.metaKey;
  const key = `${ctrl ? 'c' : ''}${e.shiftKey ? 's' : ''}${e.altKey ? 'a' : ''}`;

  switch (key) {
    case 'cs':
      return 'ctrl-shift';
    case 'ca':
      return 'ctrl-alt';
    case 'c':
      return 'ctrl';
    case 'a':
      return 'alt';
    case 's':
      return 'shift';
    case '':
      return 'plain';
    default:
      return 'other';
  }
}

/// Decide what an Enter keystroke does given the chord and whether a
/// composer typeahead menu is currently open with a selectable option.
/// Pure — no editor access, no side effects.
export function resolveEnterAction(e: EnterChord, menuActive: boolean): EnterAction {
  switch (classifyEnterChord(e)) {
    case 'ctrl-shift':
      return { type: 'submit', mode: 'queue' };
    case 'ctrl-alt':
      return { type: 'submit', mode: 'interrupt' };
    case 'alt':
      return { type: 'submit', mode: 'steer' };
    case 'ctrl':
      return { type: 'insertParagraph' };
    case 'shift':
      // Soft line break. Override the menu's modifier-blind select only
      // when a menu is open; otherwise defer to Lexical's default.
      return menuActive ? { type: 'insertLineBreak' } : { type: 'passthrough' };
    case 'plain':
      // Defer to an open typeahead menu, else send at the current mode.
      return menuActive ? { type: 'passthrough' } : { type: 'submit', mode: 'default' };
    default:
      return { type: 'passthrough' };
  }
}

/// Registers the Enter keybinding command on `editor`. Returns the
/// unregister callback. `onSubmit` is invoked with the consumed payload
/// for every send chord; newline chords mutate the editor and never call
/// `onSubmit`.
export function registerSubmitOnEnter(
  editor: LexicalEditor,
  onSubmit: (payload: ComposerSubmitPayload) => void,
): () => void {
  return editor.registerCommand(
    KEY_ENTER_COMMAND,
    (event) => {
      const e = event;

      if (!e) return false;

      if (e.isComposing || e.key === 'Process') return false;

      // Early empty-guard: when the composer has no meaningful content,
      // consume every Enter as a no-op regardless of the menu-active
      // state. This prevents a stale `isComposerMenuActive` value (which
      // can occur when the TypeaheadMenuPlugin closes the menu via a path
      // that does not fire `queryChange`) from falling through to
      // Lexical's default Enter handler and inserting a phantom newline
      // into an otherwise empty editor. Ctrl/Cmd+Enter ("insert
      // paragraph") and modifier-submit chords are intentionally included
      // — inserting structure into an empty editor is also a no-op.
      {
        const plain = editor.getEditorState().read(() => $getRoot().getTextContent());

        if (plain.trim().length === 0) {
          e.preventDefault();

          return true;
        }
      }

      const action = resolveEnterAction(e, isComposerMenuActive(editor));

      if (action.type === 'passthrough') return false;

      e.preventDefault();

      if (action.type === 'insertParagraph') {
        editor.dispatchCommand(INSERT_PARAGRAPH_COMMAND, undefined);

        return true;
      }

      if (action.type === 'insertLineBreak') {
        editor.dispatchCommand(INSERT_LINE_BREAK_COMMAND, false);

        return true;
      }

      const result = consumeComposerText(editor);

      if (result !== null) {
        const payload: ComposerSubmitPayload = {
          text: result.text,
          mode: action.mode,
          ...(result.attachments.length > 0 ? { attachments: result.attachments } : {}),
        };

        onSubmit(payload);
      }

      return true;
    },
    COMMAND_PRIORITY_HIGH,
  );
}

export const SubmitOnEnter = defineComponent({
  name: 'SubmitOnEnter',
  emits: ['submit'],
  setup(_, { emit }) {
    const editor = useLexicalComposer();
    const unregister = registerSubmitOnEnter(editor, (payload) => emit('submit', payload));

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
