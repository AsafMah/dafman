<script setup lang="ts">
/// Read-only code block, rendered via CodeMirror 6 for proper
/// per-language highlighting. Used wherever we need to show command
/// arguments, command output, file content, JSON, etc.

import { computed } from 'vue';
import CodeEditor from '@/components/shared/CodeEditor.vue';

const props = withDefaults(
  defineProps<{
    /// Raw code text — newlines preserved.
    code: string;
    /// CM6 language id (javascript, typescript, json, markdown, css,
    /// html, python, rust, go) or one of the aliases bash/text. Falls
    /// through to a plain-text editor when CM doesn't ship a pack
    /// for the id.
    lang?: string;
    /// Soft cap on rendered characters. Strings beyond this length
    /// get a "truncated" suffix so the inline card stays compact.
    /// Set 0 for no cap.
    maxLength?: number;
    /// Optional filename for language detection; takes second priority
    /// after `lang`.
    filename?: string;
  }>(),
  { lang: 'text', maxLength: 4000 },
);

const cappedCode = computed(() => {
  if (!props.code) return '';

  if (props.maxLength > 0 && props.code.length > props.maxLength) {
    return props.code.slice(0, props.maxLength) + '\n... (truncated)';
  }

  return props.code;
});

// Map a few shell/markdown aliases into CM6 language ids. Anything
// the lib doesn't recognize falls through to plain-text rendering.
const cmLanguage = computed<string | undefined>(() => {
  const l = props.lang?.toLowerCase();

  switch (l) {
    case 'bash':
    case 'sh':
    case 'shell':
    case 'zsh':
      // We don't ship a shell pack; render as plain text but keep
      // the line wrapping etc. CodeEditor handles this gracefully.
      return undefined;
    case 'diff':
    case 'patch':
      return undefined;
    case 'text':
    case undefined:
      return undefined;
    case 'ts':
      return 'typescript';
    case 'js':
      return 'javascript';
    case 'md':
      return 'markdown';
    case 'py':
      return 'python';
    case 'rs':
      return 'rust';
    default:
      return l;
  }
});
</script>

<template>
  <CodeEditor
    v-if="cappedCode"
    :model-value="cappedCode"
    :language="cmLanguage"
    :filename="filename"
    :readonly="true"
    :max-height="240"
    :show-header="true"
    class="command-block"
  />
</template>

<style scoped>
.command-block {
  align-self: stretch;
}
</style>
