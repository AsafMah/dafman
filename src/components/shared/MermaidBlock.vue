<script setup lang="ts">
/// Lazy-loaded mermaid diagram renderer.
///
/// Mermaid is ~800 KB compressed — we don't want it in the main bundle
/// for users who never touch diagrams. The actual mermaid import + init
/// happens inside `onMounted` via dynamic `import()`, so esbuild emits
/// it as a separate chunk that's only fetched on first use. Gated by
/// `settingsStore.appearance.enableMermaid` upstream; this component
/// only renders when the gate is already on.

import { computed, onMounted, ref, useId, watch } from 'vue';
import { toErrorMessage } from '@/lib/errorMessage';

const props = defineProps<{
  source: string;
}>();

const svg = ref<string>('');
const error = ref<string>('');
const ready = ref(false);

// App-wide unique id so two diagrams in the same message don't collide on
// mermaid's internal element-id allocator. A per-instance counter is always
// 1, and Date.now() ties for diagrams mounted in the same tick — both would
// share an id and render into the same element.
const localId = `mermaid-${useId()}`;

type MermaidModule = {
  default: {
    initialize: (config: Record<string, unknown>) => void;
    render: (id: string, source: string) => Promise<{ svg: string }>;
  };
};

let mermaidPromise: Promise<MermaidModule['default']> | null = null;

function loadMermaid(): Promise<MermaidModule['default']> {
  if (mermaidPromise) return mermaidPromise;

  mermaidPromise = import('mermaid').then((mod) => {
    const m = (mod as unknown as MermaidModule).default;
    // Theme picks up our PrimeVue palette — colors flip with .app-dark
    // because mermaid pulls them from CSS variables on render.
    const isDark =
      typeof document !== 'undefined' && document.documentElement.classList.contains('app-dark');

    m.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: isDark ? 'dark' : 'default',
      fontFamily: 'inherit',
    });

    return m;
  });

  return mermaidPromise;
}

async function renderDiagram() {
  ready.value = false;
  error.value = '';

  try {
    const m = await loadMermaid();
    const { svg: out } = await m.render(localId, props.source);

    svg.value = out;
    ready.value = true;
  } catch (e) {
    error.value = toErrorMessage(e);
  }
}

onMounted(renderDiagram);
watch(() => props.source, renderDiagram);

const showFallback = computed(() => error.value !== '');
</script>

<template>
  <div class="mermaid-block">
    <div
      v-if="ready && !showFallback"
      class="mermaid-svg"
      v-html="svg"
    />
    <pre
      v-else-if="showFallback"
      class="mermaid-error"
      :title="error"
    >
mermaid diagram failed to render: {{ error }}

{{ props.source }}
    </pre>
    <div
      v-else
      class="mermaid-loading"
      aria-label="Rendering diagram"
    >
      <i
        class="pi pi-spin pi-spinner"
        aria-hidden="true"
      />
      <span>Rendering diagram…</span>
    </div>
  </div>
</template>

<style scoped>
.mermaid-block {
  margin: 0.25rem 0;
  padding: 0.5rem;
  background: var(--p-content-background);
  border: 1px solid var(--p-content-border-color);
  border-radius: var(--p-border-radius-md);
  overflow-x: auto;
}

.mermaid-svg :deep(svg) {
  max-width: 100%;
  height: auto;
}

.mermaid-error {
  margin: 0;
  padding: 0.5rem;
  background: color-mix(in srgb, var(--p-red-500, #ef4444) 12%, transparent);
  color: var(--p-text-color);
  font-family: var(--font-mono, ui-monospace, SFMono-Regular, monospace);
  font-size: 0.8rem;
  white-space: pre-wrap;
}

.mermaid-loading {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  color: var(--p-text-muted-color);
  font-size: 0.85rem;
  padding: 0.5rem;
}
</style>
