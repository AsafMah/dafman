// ComposerEditorBridge — captures the active Lexical editor instance
// for callers that need to drive the editor from outside its
// `LexicalComposer` subtree (e.g. the MessageComposer SFC reaches
// for the editor to clear it, insert an AttachmentNode at the
// cursor, or apply a format action from the toolbar).
//
// Also registers update + selection-change listeners that drive the
// MessageComposer's reactive `editorFormatState`. `onFormatStateRead`
// is invoked from inside an `editorState.read(...)` block; callers
// pass `computeFormatState` and a setter from
// `@/composables/composerFormat`.
//
// Extracted from MessageComposer.vue (Phase D.4.5).

import { defineComponent, onBeforeUnmount, type PropType } from 'vue';
import { useLexicalComposer } from 'lexical-vue/LexicalComposer';
import { COMMAND_PRIORITY_LOW, SELECTION_CHANGE_COMMAND, type LexicalEditor } from 'lexical';

export default defineComponent({
  name: 'ComposerEditorBridge',
  props: {
    /// Receives the live editor instance once on mount. The parent
    /// stores this in a ref so format / clear / attachment-insert
    /// helpers can dispatch commands.
    onEditor: {
      type: Function as PropType<(editor: LexicalEditor) => void>,
      required: true,
    },
    /// Called from inside an `editorState.read(...)` block on every
    /// update + selection change. Typically wired to
    /// `computeFormatState` from `composables/composerFormat.ts`.
    onFormatStateRead: {
      type: Function as PropType<() => void>,
      required: true,
    },
  },
  setup(props) {
    const editor = useLexicalComposer();

    props.onEditor(editor as unknown as LexicalEditor);
    const unregisterUpdate = editor.registerUpdateListener(({ editorState }) => {
      editorState.read(() => props.onFormatStateRead());
    });
    const unregisterSelection = editor.registerCommand(
      SELECTION_CHANGE_COMMAND,
      () => {
        editor.getEditorState().read(() => props.onFormatStateRead());

        return false;
      },
      COMMAND_PRIORITY_LOW,
    );

    onBeforeUnmount(() => {
      unregisterUpdate();
      unregisterSelection();
    });

    return () => null;
  },
});
