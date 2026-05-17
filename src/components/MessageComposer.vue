<script setup lang="ts">
// Lexical-backed chat composer.
//
// Plain-text input today; the EditorState model leaves room for future
// custom nodes (slash commands, @mentions, #hashtags, inline images)
// without changing the parent contract. The display side (assistant /
// reasoning / user messages) renders full markdown via `MessageContent`.
//
// Wire contract: emits `submit` with the trimmed plain-text content
// when Enter is pressed or the send button is clicked. Shift+Enter
// inserts a newline. Disabled state flows through `EditableSync` since
// `lexical-vue`'s composer only reads `editable` once on mount.
//
// Markdown keystroke shortcuts (`# ` -> heading, `**bold**`, fenced
// code, etc. auto-formatting AS YOU TYPE) are gated behind
// `enableMarkdownShortcuts` so we can ship typing reliably even if a
// plugin combo destabilises input under WebView2. When the gate is on
// we mount `RichTextPlugin` + the markdown plugin stack and register
// shortcuts; when off we use plain text. Either way the same Enter +
// SubmitButton path applies.

import { computed, defineComponent, h } from "vue";
import Button from "primevue/button";
import { LexicalComposer, useLexicalComposer } from "lexical-vue/LexicalComposer";
import { ContentEditable } from "lexical-vue/LexicalContentEditable";
import { PlainTextPlugin } from "lexical-vue/LexicalPlainTextPlugin";
import { RichTextPlugin } from "lexical-vue/LexicalRichTextPlugin";
import { HistoryPlugin } from "lexical-vue/LexicalHistoryPlugin";
import { AutoFocusPlugin } from "lexical-vue/LexicalAutoFocusPlugin";
import { ListPlugin } from "lexical-vue/LexicalListPlugin";
import { LinkPlugin } from "lexical-vue/LexicalLinkPlugin";
import {
  EditableSync,
  RegisterMarkdownShortcuts,
  SubmitOnEnter,
  TypingDiagnostic,
  consumeComposerText,
} from "../lexical/plugins";
import { markdownNodes } from "../lexical/nodes";
import { lexicalTheme } from "../lexical/theme";
import { rendererLog } from "../ipc/rendererLog";

const props = withDefaults(
  defineProps<{
    disabled?: boolean;
    placeholder?: string;
    enableMarkdownShortcuts?: boolean;
  }>(),
  {
    disabled: false,
    placeholder: "Write your message...",
    enableMarkdownShortcuts: true,
  },
);

const isDev = import.meta.env.DEV;
// Toggle the typing-diagnostic via `?diag=1` rather than running it on
// every dev mount; the diagnostic mutates the editor state to test API
// inserts, which is noisy if you're actually trying to type.
const diagEnabled =
  isDev &&
  typeof window !== "undefined" &&
  new URLSearchParams(window.location.search).has("diag");

const emit = defineEmits<{ (e: "submit", text: string): void }>();

const editable = computed(() => !props.disabled);
const richText = computed(() => props.enableMarkdownShortcuts);

const initialConfig = computed(() => ({
  namespace: "DafmanComposer",
  editable: true,
  nodes: markdownNodes,
  theme: lexicalTheme,
  onError(error: Error) {
    // Mirror into both consoles + bun log so we can debug typing /
    // node-registration failures without devtools.
    rendererLog("error", `[lexical composer] ${error.message}`, {
      stack: error.stack,
    });
    console.error("[lexical composer]", error);
  },
}));

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
      <TypingDiagnostic v-if="diagEnabled" />
      <div class="lex-composer-shell">
        <template v-if="richText">
          <RichTextPlugin>
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
          </RichTextPlugin>
          <ListPlugin />
          <LinkPlugin />
          <RegisterMarkdownShortcuts />
        </template>
        <template v-else>
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
        </template>
        <HistoryPlugin />
        <AutoFocusPlugin />
      </div>
      <SubmitButton :disabled="props.disabled" @submit="onSubmit" />
    </LexicalComposer>
  </div>
</template>

