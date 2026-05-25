<script setup lang="ts">
/// Lexical editor body for MessageEditor. Lives in its own SFC so
/// it can be mounted inside LexicalComposer and call
/// `useLexicalComposer()` (which only resolves inside the provider).

import { onBeforeUnmount, onMounted } from 'vue';
import { useLexicalComposer } from 'lexical-vue/LexicalComposer';
import { ContentEditable } from 'lexical-vue/LexicalContentEditable';
import { PlainTextPlugin } from 'lexical-vue/LexicalPlainTextPlugin';
import { HistoryPlugin } from 'lexical-vue/LexicalHistoryPlugin';
import { AutoFocusPlugin } from 'lexical-vue/LexicalAutoFocusPlugin';
import {
  $getRoot,
  $createParagraphNode,
  $createTextNode,
  COMMAND_PRIORITY_HIGH,
  KEY_ENTER_COMMAND,
  KEY_ESCAPE_COMMAND,
} from 'lexical';

const props = defineProps<{
  originalText: string;
  canFork: boolean;
}>();

const emit = defineEmits<{
  save: [text: string];
  saveAndFork: [text: string];
  cancel: [];
  draftChange: [text: string];
}>();

const editor = useLexicalComposer();
let cleanups: Array<() => void> = [];

onMounted(() => {
  // Populate with the original text — one paragraph per line so
  // newlines round-trip cleanly.
  editor.update(() => {
    const root = $getRoot();

    root.clear();
    const lines = props.originalText.split('\n');

    for (const line of lines) {
      const para = $createParagraphNode();

      if (line.length > 0) para.append($createTextNode(line));

      root.append(para);
    }
  });
  setTimeout(() => editor.focus(), 0);

  cleanups.push(
    editor.registerCommand(
      KEY_ENTER_COMMAND,
      (event: KeyboardEvent | null) => {
        if (!event) return false;

        if (!(event.ctrlKey || event.metaKey)) return false;

        event.preventDefault();
        const text = editor
          .getEditorState()
          .read(() => $getRoot().getTextContent())
          .trimEnd();

        if (text.length === 0) return true;

        if (event.shiftKey && props.canFork) emit('saveAndFork', text);
        else emit('save', text);

        return true;
      },
      COMMAND_PRIORITY_HIGH,
    ),
  );

  cleanups.push(
    editor.registerCommand(
      KEY_ESCAPE_COMMAND,
      () => {
        emit('cancel');

        return true;
      },
      COMMAND_PRIORITY_HIGH,
    ),
  );

  cleanups.push(
    editor.registerUpdateListener(({ editorState }) => {
      editorState.read(() => {
        emit('draftChange', $getRoot().getTextContent());
      });
    }),
  );
});

onBeforeUnmount(() => {
  for (const fn of cleanups) fn();

  cleanups = [];
});
</script>

<template>
  <div class="me-lexical-host">
    <PlainTextPlugin>
      <template #contentEditable>
        <ContentEditable class="me-contenteditable" />
      </template>
      <template #placeholder>
        <div class="me-placeholder">Edit your message…</div>
      </template>
    </PlainTextPlugin>
    <HistoryPlugin />
    <AutoFocusPlugin />
  </div>
</template>

<style scoped>
.me-lexical-host {
  position: relative;
}

.me-placeholder {
  position: absolute;
  top: 0.5rem;
  left: 0.65rem;
  pointer-events: none;
  color: var(--p-text-muted-color);
  font-size: 0.85rem;
}

:deep(.me-contenteditable) {
  min-height: 3rem;
  max-height: 16rem;
  overflow-y: auto;
  padding: 0.4rem 0.5rem;
  border: 1px solid var(--p-surface-border);
  border-radius: var(--p-border-radius-sm);
  background: var(--p-content-background);
  font-size: 0.9rem;
  outline: none;
}

:deep(.me-contenteditable):focus {
  border-color: var(--p-primary-500);
}
</style>
