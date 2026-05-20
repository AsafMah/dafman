<script setup lang="ts">
/// Inline editor that replaces a user message bubble while the user
/// amends its text. Two terminal actions:
/// - Save        — truncate the current session at this message's
///                 eventId and resend the new text in place
/// - Save & Fork — fork the session at this message's eventId (so
///                 the new session inherits everything BEFORE this
///                 message), then send the edited text there as the
///                 new user turn. Original session is left intact.
/// Cancel restores the original text without touching history.

import { onMounted, ref } from "vue";
import Button from "primevue/button";
import Textarea from "primevue/textarea";

const props = defineProps<{
  originalText: string;
  canFork: boolean;
}>();

const emit = defineEmits<{
  (e: "save", text: string): void;
  (e: "saveAndFork", text: string): void;
  (e: "cancel"): void;
}>();

const draft = ref(props.originalText);
const textareaRef = ref<{ $el?: HTMLTextAreaElement } | null>(null);

onMounted(() => {
  // Focus + select all so the user can either retype or amend.
  const el = textareaRef.value?.$el;
  if (el instanceof HTMLTextAreaElement) {
    el.focus();
    el.select();
  }
});

const hasContent = () => draft.value.trim().length > 0;

function onSave() {
  if (!hasContent()) return;
  emit("save", draft.value);
}

function onSaveFork() {
  if (!hasContent()) return;
  emit("saveAndFork", draft.value);
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === "Escape") {
    e.preventDefault();
    emit("cancel");
  } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    if (e.shiftKey && props.canFork) onSaveFork();
    else onSave();
  }
}
</script>

<template>
  <div class="message-editor">
    <header class="me-header">
      <span class="me-label">Editing</span>
      <span class="me-hint" aria-hidden="true">
        Ctrl+Enter to save<span v-if="canFork">, Ctrl+Shift+Enter to fork</span>, Esc to cancel
      </span>
    </header>
    <Textarea
      ref="textareaRef"
      v-model="draft"
      class="me-textarea"
      auto-resize
      rows="2"
      @keydown="onKeydown"
    />
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

.me-textarea {
  width: 100%;
  font-size: 0.9rem;
}

.me-actions {
  display: flex;
  justify-content: flex-end;
  gap: 0.4rem;
}
</style>
