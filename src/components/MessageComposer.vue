<script setup lang="ts">
// Lexical-backed chat composer.
//
// Replaces the previous PrimeVue `InputGroup` + `InputText` setup. Plain
// text only for now; the EditorState model leaves room for custom nodes
// (slash commands, @mentions, #hashtags, inline images) without changing
// the parent contract.
//
// Wire contract: emits `submit` with the trimmed plain-text content when
// Enter is pressed or the send button is clicked. Shift+Enter inserts a
// newline. Disabled state flows through `EditableSync` since
// `lexical-vue`'s composer only reads `editable` once on mount.

import { computed, defineComponent, h } from "vue";
import Button from "primevue/button";
import { LexicalComposer, useLexicalComposer } from "lexical-vue/LexicalComposer";
import { ContentEditable } from "lexical-vue/LexicalContentEditable";
import { RichTextPlugin } from "lexical-vue/LexicalRichTextPlugin";
import { HistoryPlugin } from "lexical-vue/LexicalHistoryPlugin";
import { AutoFocusPlugin } from "lexical-vue/LexicalAutoFocusPlugin";
import { ListPlugin } from "lexical-vue/LexicalListPlugin";
import { CheckListPlugin } from "lexical-vue/LexicalCheckListPlugin";
import { LinkPlugin } from "lexical-vue/LexicalLinkPlugin";
import { TabIndentationPlugin } from "lexical-vue/LexicalTabIndentationPlugin";
import { HorizontalRulePlugin } from "lexical-vue/LexicalHorizontalRulePlugin";
import {
  EditableSync,
  RegisterMarkdownShortcuts,
  SubmitOnEnter,
  consumeComposerText,
} from "../lexical/plugins";
import { markdownNodes } from "../lexical/nodes";
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
  nodes: markdownNodes,
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
        <HistoryPlugin />
        <AutoFocusPlugin />
        <ListPlugin />
        <CheckListPlugin />
        <LinkPlugin />
        <HorizontalRulePlugin />
        <TabIndentationPlugin />
        <RegisterMarkdownShortcuts />
      </div>
      <SubmitButton :disabled="props.disabled" @submit="onSubmit" />
    </LexicalComposer>
  </div>
</template>

