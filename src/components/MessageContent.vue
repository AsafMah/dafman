<script setup lang="ts">
// Read-only Lexical-rendered message body.
//
// Renders a markdown `text` prop into Lexical's editor state using the
// stock `@lexical/markdown` `TRANSFORMERS` bundle. The editor is mounted
// non-editable; `MarkdownSync` rAF-throttles incoming changes so a burst
// of streaming deltas doesn't trigger one full reconcile per character.
//
// Accessibility: the contenteditable defaults to `role="textbox"`, which
// is wrong for a rendered message. We override with `role="article"` and
// `aria-readonly` so screen readers treat each message as static content.

import { LexicalComposer } from "lexical-vue/LexicalComposer";
import { ContentEditable } from "lexical-vue/LexicalContentEditable";
import { RichTextPlugin } from "lexical-vue/LexicalRichTextPlugin";
import { ListPlugin } from "lexical-vue/LexicalListPlugin";
import { LinkPlugin } from "lexical-vue/LexicalLinkPlugin";
import { HorizontalRulePlugin } from "lexical-vue/LexicalHorizontalRulePlugin";
import { MarkdownSync, CodeHighlightPlugin } from "../lexical/plugins";
import { markdownNodes } from "../lexical/nodes";
import { lexicalTheme } from "../lexical/theme";

const props = withDefaults(
  defineProps<{
    text: string;
    label?: string;
  }>(),
  { label: "Message content" },
);

const initialConfig = {
  namespace: "DafmanMessage",
  editable: false,
  nodes: markdownNodes,
  theme: lexicalTheme,
  onError(error: Error) {
    console.error("[lexical message]", error);
  },
};
</script>

<template>
  <div class="lex-display">
    <LexicalComposer :initial-config="initialConfig">
      <MarkdownSync :markdown="props.text" />
      <RichTextPlugin>
        <template #contentEditable>
          <ContentEditable
            class="lex-content"
            role="article"
            :aria-readonly="true"
            :aria-label="props.label"
            :spellcheck="false"
            :tabindex="-1"
          />
        </template>
        <template #placeholder>
          <div />
        </template>
      </RichTextPlugin>
      <ListPlugin />
      <LinkPlugin />
      <HorizontalRulePlugin />
      <CodeHighlightPlugin />
    </LexicalComposer>
  </div>
</template>
