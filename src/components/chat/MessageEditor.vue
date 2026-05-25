<script setup lang="ts">
/// Inline editor that replaces a user message bubble. Uses the same
/// Lexical plain-text stack as the main composer so behavior (paste,
/// undo, cursor, future @mentions / slash-commands) matches.
///
/// Two terminal actions:
/// - Save        — truncate the current session at this message's
///                 eventId and resend the new text in place
/// - Save & Fork — fork the session at this message's eventId, open
///                 the new session as a tab, send the edited text
///                 there as the new user turn. Original session
///                 left intact.
/// Cancel restores the original text without touching history.

import { ref } from 'vue';
import Button from 'primevue/button';
import { LexicalComposer } from 'lexical-vue/LexicalComposer';
import { markdownNodes } from '../../lexical/nodes';
import { lexicalTheme } from '../../lexical/theme';
import MessageEditorBody from './MessageEditorBody.vue';

const props = defineProps<{
  originalText: string;
  canFork: boolean;
}>();

const emit = defineEmits<{
  (e: 'save', text: string): void;
  (e: 'saveAndFork', text: string): void;
  (e: 'cancel'): void;
}>();

const draftText = ref(props.originalText);

const lexicalConfig = {
  namespace: 'DafmanMessageEditor',
  editable: true,
  nodes: markdownNodes,
  theme: lexicalTheme,
  onError(error: Error) {
    console.error('[lexical message editor]', error);
  },
};

const hasContent = () => draftText.value.trim().length > 0;

function onSave() {
  if (!hasContent()) return;

  emit('save', draftText.value.trimEnd());
}

function onSaveFork() {
  if (!hasContent()) return;

  emit('saveAndFork', draftText.value.trimEnd());
}

function onDraftChange(text: string) {
  draftText.value = text;
}
</script>

<template>
  <div class="message-editor">
    <header class="me-header">
      <span class="me-label">Editing</span>
      <span
        class="me-hint"
        aria-hidden="true"
      >
        Ctrl+Enter to save<span v-if="canFork">, Ctrl+Shift+Enter to fork</span>, Esc to cancel
      </span>
    </header>
    <LexicalComposer :initial-config="lexicalConfig">
      <MessageEditorBody
        :original-text="originalText"
        :can-fork="canFork"
        @save="(text) => emit('save', text)"
        @save-and-fork="(text) => emit('saveAndFork', text)"
        @cancel="emit('cancel')"
        @draft-change="onDraftChange"
      />
    </LexicalComposer>
    <footer class="me-actions">
      <Button
        label="Cancel"
        severity="secondary"
        size="small"
        text
        @click="emit('cancel')"
      />
      <Button
        v-if="canFork"
        label="Save & fork"
        icon="pi pi-share-alt"
        severity="secondary"
        size="small"
        :disabled="!hasContent()"
        @click="onSaveFork"
      />
      <Button
        label="Save"
        icon="pi pi-check"
        severity="primary"
        size="small"
        :disabled="!hasContent()"
        @click="onSave"
      />
    </footer>
  </div>
</template>

<style scoped>
.message-editor {
  border: 1px solid var(--p-primary-500);
  border-radius: var(--p-border-radius-md);
  padding: 0.5rem 0.75rem;
  background: color-mix(in srgb, var(--p-primary-500) 5%, var(--p-content-background));
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.me-header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.5rem;
}

.me-label {
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  font-weight: 600;
  color: var(--p-primary-500);
}

.me-hint {
  font-size: 0.7rem;
  color: var(--p-text-muted-color);
}

.me-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.4rem;
}
</style>
