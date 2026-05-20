<script setup lang="ts">
// Read-only markdown renderer for assistant/user/reasoning/tool bubbles.
//
// Top-level fenced code blocks are extracted as separate segments and
// rendered through CodeEditor (CodeMirror 6) so we get per-language
// syntax highlighting + a uniform code surface. Everything else
// (paragraphs, lists, tables, inline code, nested code blocks inside
// lists/blockquotes, KaTeX math) stays on the markdown-it + Prism
// path via v-html. See `renderMarkdownSegments` in lib/markdown.ts
// for the split rationale + streaming notes.

import { computed } from "vue";
import { renderMarkdownSegments } from "../lib/markdown";
// Side-effect import: registers extra prism grammars for the inline /
// nested code path that still goes through markdown-it's highlight
// hook. See prismExtraLanguages.ts for the language list.
import "../lexical/prismExtraLanguages";
import CodeEditor from "./CodeEditor.vue";

const props = withDefaults(
  defineProps<{
    text: string;
    label?: string;
  }>(),
  { label: "Message content" },
);

const segments = computed(() => renderMarkdownSegments(props.text));
</script>

<template>
  <div
    class="md-content lex-content"
    role="article"
    :aria-readonly="true"
    :aria-label="props.label"
  >
    <template v-for="(seg, idx) in segments" :key="idx">
      <div
        v-if="seg.kind === 'html'"
        class="md-html-segment"
        v-html="seg.html"
      />
      <CodeEditor
        v-else
        class="md-code-segment"
        :model-value="seg.code"
        :language="seg.language || undefined"
        :readonly="true"
        :max-height="320"
        :show-header="true"
      />
    </template>
  </div>
</template>

<style scoped>
.md-content {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
}

.md-html-segment > :first-child {
  margin-top: 0;
}

.md-html-segment > :last-child {
  margin-bottom: 0;
}

.md-code-segment {
  align-self: stretch;
}
</style>
