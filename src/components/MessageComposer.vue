<script setup lang="ts">
// Lexical-backed chat composer.
//
// Plain-text input today; the EditorState model leaves room for future
// custom nodes (slash commands, @mentions, #hashtags, inline images)
// without changing the parent contract. Markdown keystroke shortcuts
// (`# heading`, `**bold**`, fenced code, lists, links, hr) were tried
// in an earlier revision but interfered with typing under Electrobun's
// WebView2 surface; deferred until we can run that combo against real
// devtools. The assistant/reasoning *display* side still renders the
// full markdown bundle — see `MessageContent.vue`.
//
// Wire contract: emits `submit` with the trimmed plain-text content
// when Enter is pressed or the send button is clicked. Shift+Enter
// inserts a newline. Disabled state flows through `EditableSync` since
// `lexical-vue`'s composer only reads `editable` once on mount.

import { computed, defineComponent, h } from "vue";
import Button from "primevue/button";
import { LexicalComposer, useLexicalComposer } from "lexical-vue/LexicalComposer";
import { ContentEditable } from "lexical-vue/LexicalContentEditable";
import { PlainTextPlugin } from "lexical-vue/LexicalPlainTextPlugin";
import { HistoryPlugin } from "lexical-vue/LexicalHistoryPlugin";
import { AutoFocusPlugin } from "lexical-vue/LexicalAutoFocusPlugin";
import {
  EditableSync,
  SubmitOnEnter,
  consumeComposerText,
} from "../lexical/plugins";
import { lexicalTheme } from "../lexical/theme";

const props = withDefaults(
  defineProps<{
    disabled?: boolean;
    placeholder?: string;
  }>(),
  { disabled: false, placeholder: "Write your message..." },
);

const emit = defineEmits<{ (e: "submit", text: string): void }>();

const editable = computed(() => !props.disabled);

const initialConfig = {
  namespace: "DafmanComposer",
  editable: true,
  theme: lexicalTheme,
  onError(error: Error) {
    console.error("[lexical composer]", error);
  },
};

function onSubmit(text: string) {
  emit("submit", text);
}

/// Submit button rendered inside `LexicalComposer` so it has access to
/// the provided editor via `useLexicalComposer()`. Routes the click
/// through the same `consumeComposerText` path the Enter keybinding
/// uses, and uses `mousedown.prevent` to keep focus on the editor so
/// the next keystroke after a send still goes to the right place.
const SubmitButton = defineComponent({
  name: "SubmitButton",
  props: { disabled: { type: Boolean, default: false } },
  emits: ["submit"],
  setup(p, { emit: emitInner }) {
    const editor = useLexicalComposer();
    function fire() {
      if (p.disabled) return;
      const text = consumeComposerText(editor);
      if (text !== null) emitInner("submit", text);
    }
    return () =>
      h(Button, {
        type: "button",
        icon: "pi pi-send",
        "aria-label": "Send message",
        disabled: p.disabled,
        onMousedown: (event: MouseEvent) => event.preventDefault(),
        onClick: fire,
      });
  },
});
</script>

<template>
  <div class="lex-composer">
    <LexicalComposer :initial-config="initialConfig">
      <EditableSync :editable="editable" />
      <SubmitOnEnter @submit="onSubmit" />
      <div class="lex-composer-shell">
        <PlainTextPlugin>
          <template #contentEditable>
            <ContentEditable
              class="lex-content lex-composer-input"
              role="textbox"
              :aria-multiline="true"
              :aria-disabled="props.disabled"
              :aria-label="placeholder"
            />
          </template>
          <template #placeholder>
            <div class="lex-composer-placeholder">{{ placeholder }}</div>
          </template>
        </PlainTextPlugin>
        <HistoryPlugin />
        <AutoFocusPlugin />
      </div>
      <SubmitButton :disabled="props.disabled" @submit="onSubmit" />
    </LexicalComposer>
  </div>
</template>

