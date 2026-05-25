<script setup lang="ts">
/// Structure-driven JSON value viewer.
///
/// Tool results frequently come back as JSON strings (MCP tool calls,
/// fetch, todo lists, etc.). Showing them as syntax-highlighted text
/// is fine, but you lose the ability to scan for the key you care
/// about. This component walks the parsed value and emits:
///
/// - Objects → key/value rows
/// - Arrays  → numbered list (collapsed for >20 items by default)
/// - Strings → inline; multi-line strings keep their newlines
/// - Numbers / booleans / null → typed inline chip
///
/// Recursive: nested objects/arrays render their own viewer with an
/// expand/collapse toggle. Recursion depth is bounded by `depth` so a
/// pathological input can't blow the stack.
///
/// NOT a JSON editor — read-only on purpose. The "view" surface is what
/// users actually want; for editing we'd ship a dedicated component.

import { computed, ref } from 'vue';

const props = withDefaults(
  defineProps<{
    value: unknown;
    /// Used to decide initial expand state. Roots and shallow nesting
    /// expand by default; deeper levels collapse.
    depth?: number;
    /// Arrays with more than this many items collapse by default.
    collapseArrayThreshold?: number;
  }>(),
  { depth: 0, collapseArrayThreshold: 20 },
);

const kind = computed<'null' | 'boolean' | 'number' | 'string' | 'array' | 'object'>(() => {
  const v = props.value;

  if (v === null) return 'null';

  if (Array.isArray(v)) return 'array';

  switch (typeof v) {
    case 'boolean':
      return 'boolean';
    case 'number':
      return 'number';
    case 'string':
      return 'string';
    case 'object':
      return 'object';
    default:
      return 'string';
  }
});

const asArray = computed<unknown[]>(() => (Array.isArray(props.value) ? props.value : []));
const asObject = computed<Array<[string, unknown]>>(() => {
  if (kind.value !== 'object') return [];

  return Object.entries(props.value as Record<string, unknown>);
});
const asString = computed(() => (typeof props.value === 'string' ? props.value : ''));

const isMultilineString = computed(() => kind.value === 'string' && asString.value.includes('\n'));

const initiallyExpanded = computed(() => {
  if (props.depth >= 3) return false;

  if (kind.value === 'array' && asArray.value.length > props.collapseArrayThreshold) {
    return false;
  }

  return true;
});

const expanded = ref(initiallyExpanded.value);

function toggle(): void {
  expanded.value = !expanded.value;
}

const summary = computed(() => {
  if (kind.value === 'array') return `Array(${asArray.value.length})`;

  if (kind.value === 'object') return `Object(${asObject.value.length})`;

  return '';
});
</script>

<template>
  <!-- Primitive: null -->
  <span
    v-if="kind === 'null'"
    class="jv-primitive jv-null"
    >null</span
  >

  <!-- Primitive: boolean -->
  <span
    v-else-if="kind === 'boolean'"
    class="jv-primitive jv-bool"
  >
    {{ value ? 'true' : 'false' }}
  </span>

  <!-- Primitive: number -->
  <span
    v-else-if="kind === 'number'"
    class="jv-primitive jv-num"
    >{{ value }}</span
  >

  <!-- Primitive: string -->
  <pre
    v-else-if="kind === 'string' && isMultilineString"
    class="jv-multiline"
    >{{ asString }}</pre
  >
  <span
    v-else-if="kind === 'string'"
    class="jv-primitive jv-str"
    >{{ asString }}</span
  >

  <!-- Array -->
  <div
    v-else-if="kind === 'array'"
    class="jv-collection"
  >
    <button
      type="button"
      class="jv-toggle"
      :aria-expanded="expanded"
      @click="toggle"
    >
      <i
        :class="['pi', expanded ? 'pi-chevron-down' : 'pi-chevron-right']"
        aria-hidden="true"
      />
      <span class="jv-summary">{{ summary }}</span>
    </button>
    <ol
      v-if="expanded"
      class="jv-array"
    >
      <li
        v-for="(item, idx) in asArray"
        :key="idx"
        class="jv-array-item"
      >
        <span class="jv-index">{{ idx }}</span>
        <JsonValueView
          :value="item"
          :depth="depth + 1"
          :collapse-array-threshold="collapseArrayThreshold"
        />
      </li>
    </ol>
  </div>

  <!-- Object -->
  <div
    v-else-if="kind === 'object'"
    class="jv-collection"
  >
    <button
      type="button"
      class="jv-toggle"
      :aria-expanded="expanded"
      @click="toggle"
    >
      <i
        :class="['pi', expanded ? 'pi-chevron-down' : 'pi-chevron-right']"
        aria-hidden="true"
      />
      <span class="jv-summary">{{ summary }}</span>
    </button>
    <dl
      v-if="expanded"
      class="jv-object"
    >
      <template
        v-for="[k, v] in asObject"
        :key="k"
      >
        <dt class="jv-key">{{ k }}</dt>
        <dd class="jv-value">
          <JsonValueView
            :value="v"
            :depth="depth + 1"
            :collapse-array-threshold="collapseArrayThreshold"
          />
        </dd>
      </template>
    </dl>
  </div>
</template>

<style scoped>
.jv-primitive {
  font-family: var(--p-font-family-mono, ui-monospace, monospace);
  font-size: 0.85rem;
  padding: 0.05rem 0.35rem;
  border-radius: var(--p-border-radius-sm);
  background: var(--p-content-hover-background);
}

.jv-null {
  color: var(--p-text-muted-color);
  font-style: italic;
}

.jv-bool {
  color: var(--p-orange-500);
}

.jv-num {
  color: var(--p-blue-500);
}

.jv-str {
  color: var(--p-text-color);
  word-break: break-word;
}

.jv-multiline {
  margin: 0;
  padding: 0.4rem 0.6rem;
  background: var(--p-content-hover-background);
  border-radius: var(--p-border-radius-sm);
  font-family: var(--p-font-family-mono, ui-monospace, monospace);
  font-size: 0.82rem;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 320px;
  overflow: auto;
}

.jv-collection {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  min-width: 0;
}

.jv-toggle {
  display: inline-flex;
  align-items: center;
  gap: 0.3rem;
  background: transparent;
  border: 0;
  padding: 0.05rem 0.2rem;
  cursor: pointer;
  font-size: 0.78rem;
  color: var(--p-text-muted-color);
  align-self: flex-start;
}

.jv-toggle:hover {
  color: var(--p-text-color);
}

.jv-summary {
  font-family: var(--p-font-family-mono, ui-monospace, monospace);
}

.jv-array {
  list-style: none;
  margin: 0;
  padding: 0 0 0 1rem;
  border-left: 1px dotted var(--p-surface-border);
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.jv-array-item {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 0.5rem;
  align-items: start;
}

.jv-index {
  font-family: var(--p-font-family-mono, ui-monospace, monospace);
  font-size: 0.78rem;
  color: var(--p-text-muted-color);
  min-width: 1.5em;
  text-align: right;
}

.jv-object {
  margin: 0;
  padding: 0 0 0 1rem;
  border-left: 1px dotted var(--p-surface-border);
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 0.2rem 0.6rem;
  align-items: start;
}

.jv-key {
  font-family: var(--p-font-family-mono, ui-monospace, monospace);
  font-size: 0.82rem;
  font-weight: 500;
  color: var(--p-primary-500);
  white-space: nowrap;
}

.jv-key::after {
  content: ':';
  color: var(--p-text-muted-color);
}

.jv-value {
  margin: 0;
  min-width: 0;
}
</style>
