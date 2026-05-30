<script setup lang="ts">
/// CodeMirror 6 `MergeView` wrapper.
///
/// Modes:
/// - "inline": unified diff (a above b via CSS column-stack)
/// - "side-by-side": two columns
///
/// Language is resolved BEFORE the MergeView is built so the
/// LanguageSupport extension is present in the initial state. CM6's
/// Compartment.reconfigure() works inside a single EditorView, but
/// `MergeView` wraps its two halves in a way that makes the post-
/// mount reconfigure unreliable for syntax highlighting — resolving
/// up-front and rebuilding on prop change is simpler and always
/// shows tokens correctly.

import { onMounted, onUnmounted, ref, useTemplateRef, watch } from 'vue';
import { EditorView, lineNumbers } from '@codemirror/view';
import { EditorState, type Extension } from '@codemirror/state';
import { MergeView, unifiedMergeView } from '@codemirror/merge';
import { oneDark } from '@codemirror/theme-one-dark';
import Button from 'primevue/button';
import { buildCodeMirrorTheme, resolveLanguageWithFallback } from '@/lib/codeMirrorShared';

type Mode = 'inline' | 'side-by-side';

const props = withDefaults(
  defineProps<{
    oldText: string;
    newText: string;
    language?: string;
    filename?: string;
    initialMode?: Mode;
    /// Max height before scroll. 0 = fit content.
    maxHeight?: number;
  }>(),
  { initialMode: 'inline', maxHeight: 480 },
);

const host = useTemplateRef<HTMLDivElement>('host');
const mode = ref<Mode>(props.initialMode);
let mergeView: MergeView | null = null;
let inlineView: EditorView | null = null;
let resolvedLang: Extension | null = null;

function commonExtensions(): Extension[] {
  return [
    EditorState.readOnly.of(true),
    EditorView.editable.of(false),
    EditorView.lineWrapping,
    lineNumbers(),
    ...(resolvedLang ? [resolvedLang] : []),
    oneDark,
    buildCodeMirrorTheme({
      maxHeight: props.maxHeight,
      contentPadding: '0.3rem 0.5rem',
    }),
  ];
}

async function resolveLang(): Promise<void> {
  resolvedLang = await resolveLanguageWithFallback({
    language: props.language,
    filename: props.filename,
  });
}

function buildSync(): void {
  if (!host.value) return;

  if (mergeView) {
    mergeView.destroy();
    mergeView = null;
  }

  if (inlineView) {
    inlineView.destroy();
    inlineView = null;
  }

  host.value.innerHTML = '';
  host.value.classList.remove('merge-inline');

  if (mode.value === 'side-by-side') {
    mergeView = new MergeView({
      a: { doc: props.oldText, extensions: commonExtensions() },
      b: { doc: props.newText, extensions: commonExtensions() },
      parent: host.value,
      orientation: 'a-b',
      highlightChanges: true,
      gutter: true,
      collapseUnchanged: { margin: 3, minSize: 6 },
    });
  } else {
    // Unified inline diff: a single EditorView whose doc is the NEW
    // text, with `unifiedMergeView` decorating removed lines from
    // `original` inline (deletion strikethrough + insertion bg).
    inlineView = new EditorView({
      doc: props.newText,
      extensions: [
        ...commonExtensions(),
        unifiedMergeView({
          original: props.oldText,
          mergeControls: false,
          highlightChanges: true,
          gutter: true,
          collapseUnchanged: { margin: 3, minSize: 6 },
        }),
      ],
      parent: host.value,
    });
    host.value.classList.add('merge-inline');
  }
}

async function rebuild(): Promise<void> {
  await resolveLang();
  buildSync();
}

onMounted(() => {
  void rebuild();
});

onUnmounted(() => {
  mergeView?.destroy();
  inlineView?.destroy();
  mergeView = null;
  inlineView = null;
});

watch(
  () => [props.oldText, props.newText, mode.value] as const,
  () => buildSync(),
);

watch(
  () => [props.language, props.filename] as const,
  () => {
    void rebuild();
  },
);

function toggleMode(): void {
  mode.value = mode.value === 'inline' ? 'side-by-side' : 'inline';
}
</script>

<template>
  <div class="diff-editor">
    <header class="diff-editor-header">
      <Button
        :icon="mode === 'inline' ? 'pi pi-objects-column' : 'pi pi-bars'"
        :label="mode === 'inline' ? 'Side by side' : 'Inline'"
        text
        size="small"
        @click="toggleMode"
      />
    </header>
    <div
      ref="host"
      class="diff-editor-host"
    />
  </div>
</template>

<style scoped>
.diff-editor {
  display: flex;
  flex-direction: column;
  align-self: stretch;
  border: 1px solid var(--p-surface-border);
  border-radius: var(--p-border-radius-sm);
  background: var(--p-content-background);
  overflow: hidden;
}

.diff-editor-header {
  display: flex;
  justify-content: flex-end;
  padding: 0.2rem 0.4rem;
  border-bottom: 1px solid var(--p-surface-border);
  background: var(--p-content-hover-background);
}

.diff-editor-host {
  min-height: 60px;
}

/* Inline mode mounts a single EditorView with `unifiedMergeView`;
 * side-by-side mounts MergeView (two columns). No CSS stacking
 * trickery needed — both modes render the right shape natively. */

.diff-editor-host :deep(.cm-mergeView) {
  background: transparent;
}

.diff-editor-host :deep(.cm-deletedChunk) {
  background: color-mix(in srgb, var(--p-red-500) 14%, transparent);
}

.diff-editor-host :deep(.cm-insertedChunk) {
  background: color-mix(in srgb, var(--p-green-500) 14%, transparent);
}

.diff-editor-host :deep(.cm-changedLine) {
  background: color-mix(in srgb, var(--p-orange-500) 12%, transparent);
}
</style>
