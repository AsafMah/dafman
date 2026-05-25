<script setup lang="ts">
/// CodeMirror 6 wrapper component.
///
/// Read-only by default — every existing surface (tool args, tool
/// results, diffs) is read-only. Editable callers pass `:readonly=false`.
///
/// Language is resolved via `resolveLanguageForFile()` (extension /
/// filename) or `resolveLanguageExtension()` (explicit id). Both
/// dynamic-import so users only pay for the packs they hit.
///
/// Why CM6 and not Lexical/Prism: per-line highlighting + diff
/// merging come for free, and CM6 plays well as a true read-only
/// surface (Lexical's CodeNode was actually being styled as an
/// "editable but immutable" surface — confusing and slow on long
/// outputs).

import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { EditorState, Compartment } from '@codemirror/state';
import type { Extension } from '@codemirror/state';
import { EditorView, lineNumbers } from '@codemirror/view';
import { oneDark } from '@codemirror/theme-one-dark';
import Button from 'primevue/button';
import { resolveLanguageExtension, resolveLanguageForFile } from '../lib/codeLanguage';
import { useToastStore } from '../stores/toastStore';
import { toErrorMessage } from '../lib/errorMessage';

const props = withDefaults(
  defineProps<{
    modelValue: string;
    language?: string;
    /// Used as a fallback if `language` isn't given.
    filename?: string;
    readonly?: boolean;
    showLineNumbers?: boolean;
    /// Max height before scroll. Use 0 for "fit content".
    maxHeight?: number;
    /// Show the header bar with language label + copy button. Off by
    /// default; on for markdown code blocks and tool-detail bodies.
    showHeader?: boolean;
  }>(),
  {
    readonly: true,
    showLineNumbers: false,
    maxHeight: 320,
    showHeader: false,
  },
);

const emit = defineEmits<{
  (e: 'update:modelValue', value: string): void;
}>();

const host = ref<HTMLDivElement | null>(null);
const toasts = useToastStore();
let view: EditorView | null = null;
const langCompartment = new Compartment();
const readOnlyCompartment = new Compartment();

/// Resolved display label for the header bar. Falls back through:
/// 1. Explicit `language` prop (e.g. "typescript")
/// 2. Filename extension uppercased ("App.ts" → "TS")
/// 3. "code" generic
const headerLabel = computed<string>(() => {
  if (props.language && props.language.trim().length > 0) {
    return props.language;
  }

  if (props.filename) {
    const ext = props.filename.replace(/^.*[\\\/.]/, '');

    if (ext && ext.length <= 5) return ext;
  }

  return 'code';
});

async function copyAll(): Promise<void> {
  try {
    await navigator.clipboard.writeText(props.modelValue);
    toasts.success('Code copied');
  } catch (err) {
    const message = toErrorMessage(err);

    toasts.error('Copy failed', message);
  }
}

function baseExtensions(): Extension[] {
  return [
    EditorView.editable.of(!props.readonly),
    readOnlyCompartment.of(EditorState.readOnly.of(props.readonly)),
    EditorView.lineWrapping,
    ...(props.showLineNumbers ? [lineNumbers()] : []),
    langCompartment.of([]),
    oneDark,
    EditorView.updateListener.of((update) => {
      if (update.docChanged && !props.readonly) {
        emit('update:modelValue', update.state.doc.toString());
      }
    }),
    EditorView.theme({
      '&': {
        fontSize: '0.82rem',
        backgroundColor: 'transparent',
      },
      '.cm-scroller': {
        fontFamily: 'var(--p-font-family-mono, ui-monospace, SFMono-Regular, Menlo, monospace)',
        maxHeight: props.maxHeight > 0 ? `${props.maxHeight}px` : 'none',
      },
      '.cm-content': {
        padding: '0.4rem 0.6rem',
      },
      '.cm-gutters': {
        backgroundColor: 'transparent',
        borderRight: '1px solid var(--p-surface-border, rgba(255,255,255,0.08))',
      },
    }),
  ];
}

async function loadLanguage(): Promise<void> {
  if (!view) return;

  let ext: Extension | null = null;

  if (props.language) {
    ext = await resolveLanguageExtension(props.language);
  }

  if (!ext && props.filename) {
    ext = await resolveLanguageForFile(props.filename);
  }

  if (!view) return; // disposed during await

  view.dispatch({
    effects: langCompartment.reconfigure(ext ?? []),
  });
}

onMounted(() => {
  if (!host.value) return;

  view = new EditorView({
    state: EditorState.create({
      doc: props.modelValue,
      extensions: baseExtensions(),
    }),
    parent: host.value,
  });
  void loadLanguage();
});

onUnmounted(() => {
  view?.destroy();
  view = null;
});

watch(
  () => props.modelValue,
  (next) => {
    if (!view) return;

    if (next === view.state.doc.toString()) return;

    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: next },
    });
  },
);

watch(
  () => [props.language, props.filename] as const,
  () => {
    void loadLanguage();
  },
);

watch(
  () => props.readonly,
  (ro) => {
    if (!view) return;

    view.dispatch({
      effects: readOnlyCompartment.reconfigure(EditorState.readOnly.of(ro)),
    });
  },
);
</script>

<template>
  <div class="code-editor-wrap">
    <header
      v-if="showHeader"
      class="code-header"
    >
      <span class="code-lang">{{ headerLabel }}</span>
      <Button
        icon="pi pi-copy"
        text
        size="small"
        class="code-copy"
        aria-label="Copy code"
        @click="copyAll"
      />
    </header>
    <div
      ref="host"
      class="code-editor"
    />
  </div>
</template>

<style scoped>
.code-editor-wrap {
  border: 1px solid var(--p-surface-border);
  border-radius: var(--p-border-radius-sm);
  overflow: hidden;
  background: var(--p-content-background);
  display: flex;
  flex-direction: column;
}

.code-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  padding: 0.1rem 0.2rem 0.1rem 0.6rem;
  background: var(--p-content-hover-background);
  border-bottom: 1px solid var(--p-surface-border);
  font-size: 0.7rem;
  text-transform: lowercase;
  color: var(--p-text-muted-color);
  font-family: var(--p-font-family-mono, ui-monospace, monospace);
}

.code-lang {
  user-select: none;
}

.code-copy :deep(.p-button) {
  padding: 0.1rem 0.3rem;
  height: auto;
  min-height: 0;
  color: var(--p-text-muted-color);
}

.code-copy :deep(.p-button):hover {
  color: var(--p-text-color);
  background: transparent;
}

.code-copy :deep(.p-button-icon) {
  font-size: 0.75rem;
}

.code-editor {
  flex: 1 1 auto;
  min-width: 0;
}

:deep(.cm-editor.cm-focused) {
  outline: none;
}
</style>
