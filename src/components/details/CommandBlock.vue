<script setup lang="ts">
// Fenced code block rendered via the same markdown-it + prism pipe
// the chat uses, so syntax highlighting comes free. Used by
// PermissionDetails (shell command) and ToolDetails (shell command,
// write content preview, etc.). Lang is a prism grammar id; pass
// "text" for plain rendering.

import { computed } from "vue";
import { renderMarkdown } from "../../lib/markdown";

const props = withDefaults(
  defineProps<{
    /// Raw code text — newlines preserved.
    code: string;
    /// Prism grammar id (bash, ts, json, …). Falls through to text
    /// rendering when prism doesn't know the grammar.
    lang?: string;
    /// Soft cap on rendered characters. The full text always reaches
    /// markdown-it (so prism can syntax-highlight a full block), but
    /// strings beyond this length get a "truncated" suffix so the
    /// inline card stays compact. Set 0 for no cap.
    maxLength?: number;
  }>(),
  { lang: "text", maxLength: 4000 },
);

const html = computed(() => {
  if (!props.code) return "";
  const capped =
    props.maxLength > 0 && props.code.length > props.maxLength
      ? props.code.slice(0, props.maxLength) + "\n... (truncated)"
      : props.code;
  return renderMarkdown("```" + props.lang + "\n" + capped + "\n```");
});
</script>

<template>
  <div class="command-block" v-html="html" />
</template>

<style scoped>
.command-block :deep(.lex-code) {
  margin: 0;
  font-size: 0.82rem;
  max-height: 14rem;
  overflow: auto;
}
</style>
