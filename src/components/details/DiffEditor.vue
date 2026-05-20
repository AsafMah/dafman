<script setup lang="ts">
/// CodeMirror 6 `MergeView` wrapper.
///
/// Modes:
/// - "inline" (a / b): unified diff, single column with +/- markers
/// - "side-by-side": two columns
///
/// We toggle via a button in the header. State is local to the
/// component (caller sets the initial mode via `initialMode`).

import { onMounted, onUnmounted, ref, watch } from "vue";
import { EditorView, lineNumbers } from "@codemirror/view";
import { EditorState, Compartment } from "@codemirror/state";
import type { Extension } from "@codemirror/state";
import { MergeView } from "@codemirror/merge";
import { oneDark } from "@codemirror/theme-one-dark";
import Button from "primevue/button";
import {
  resolveLanguageExtension,
  resolveLanguageForFile,
} from "../../lib/codeLanguage";

type Mode = "inline" | "side-by-side";

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
  { initialMode: "inline", maxHeight: 480 },
);

const host = ref<HTMLDivElement | null>(null);
const mode = ref<Mode>(props.initialMode);
let mergeView: MergeView | null = null;
const langCompartment = new Compartment();

function commonExtensions(): Extension[] {
  return [
    EditorState.readOnly.of(true),
    EditorView.editable.of(false),
    EditorView.lineWrapping,
    lineNumbers(),
    langCompartment.of([]),
    oneDark,
    EditorView.theme({
      "&": {
        fontSize: "0.82rem",
        backgroundColor: "transparent",
      },
      ".cm-scroller": {
        fontFamily:
          "var(--p-font-family-mono, ui-monospace, SFMono-Regular, Menlo, monospace)",
        maxHeight: props.maxHeight > 0 ? `${props.maxHeight}px` : "none",
      },
      ".cm-content": { padding: "0.3rem 0.5rem" },
      ".cm-gutters": {
        backgroundColor: "transparent",
        borderRight: "1px solid var(--p-surface-border, rgba(255,255,255,0.08))",
      },
    }),
  ];
}

async function loadLanguage(): Promise<void> {
  if (!mergeView) return;
  let ext: Extension | null = null;
  if (props.language) {
    ext = await resolveLanguageExtension(props.language);
  }
  if (!ext && props.filename) {
    ext = await resolveLanguageForFile(props.filename);
  }
  if (!mergeView) return;
  const effects = langCompartment.reconfigure(ext ?? []);
  mergeView.a.dispatch({ effects });
  mergeView.b.dispatch({ effects });
}

function build(): void {
  if (!host.value) return;
  if (mergeView) {
    mergeView.destroy();
    mergeView = null;
  }
  // Clear any prior root DOM contents (MergeView appends children).
  host.value.innerHTML = "";
  mergeView = new MergeView({
    a: { doc: props.oldText, extensions: commonExtensions() },
    b: { doc: props.newText, extensions: commonExtensions() },
    parent: host.value,
    orientation: mode.value === "inline" ? "a-b" : "a-b",
    revertControls: undefined,
    highlightChanges: true,
    gutter: true,
    collapseUnchanged: { margin: 3, minSize: 6 },
    // The renderRevertControl + diffConfig defaults are fine for a
    // read-only viewer.
  });
  // CM6's MergeView always renders side-by-side. For "inline", we
  // stack the two halves vertically via CSS by adding a class.
  if (mode.value === "inline") {
    host.value.classList.add("merge-inline");
  } else {
    host.value.classList.remove("merge-inline");
  }
  void loadLanguage();
}

onMounted(build);

onUnmounted(() => {
  mergeView?.destroy();
  mergeView = null;
});

watch(
  () => [props.oldText, props.newText, mode.value] as const,
  () => build(),
);

watch(
  () => [props.language, props.filename] as const,
  () => {
    void loadLanguage();
  },
);

function toggleMode(): void {
  mode.value = mode.value === "inline" ? "side-by-side" : "inline";
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
    <div ref="host" class="diff-editor-host" />
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

/* CM6's MergeView is side-by-side by default. For "inline" we stack
 * vertically via CSS — both halves still render but each occupies
 * the full width. */
.diff-editor-host.merge-inline :deep(.cm-mergeView) {
  flex-direction: column;
}

.diff-editor-host.merge-inline :deep(.cm-mergeViewEditor) {
  width: 100% !important;
}

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
