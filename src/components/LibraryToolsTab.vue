<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { storeToRefs } from "pinia";
import Button from "primevue/button";
import ToggleSwitch from "primevue/toggleswitch";
import { invokeCommand } from "../ipc/invoke";
import { useSettingsStore } from "../stores/settingsStore";
import { useToastStore } from "../stores/toastStore";
import MessageContent from "./MessageContent.vue";

type ToolItem = { name: string; description: string; namespacedName?: string };
type ToolGroup = { label: string; items: ToolItem[] };

const settingsStore = useSettingsStore();
const { settings } = storeToRefs(settingsStore);
const toasts = useToastStore();

const tools = ref<ToolItem[]>([]);
const loaded = ref(false);
const error = ref<string | null>(null);
const expanded = ref<Set<string>>(new Set());

function toolKey(tool: ToolItem): string {
  return tool.namespacedName ?? tool.name;
}

const groups = computed<ToolGroup[]>(() => {
  const builtins: ToolItem[] = [];
  const byPrefix = new Map<string, ToolItem[]>();
  for (const tool of tools.value) {
    if (!tool.namespacedName) {
      builtins.push(tool);
      continue;
    }
    const prefix = tool.namespacedName.split("/")[0] || "namespaced";
    const list = byPrefix.get(prefix) ?? [];
    list.push(tool);
    byPrefix.set(prefix, list);
  }
  const out: ToolGroup[] = [];
  if (builtins.length > 0) out.push({ label: "Built-in", items: builtins });
  for (const prefix of [...byPrefix.keys()].sort()) {
    out.push({ label: prefix, items: byPrefix.get(prefix) ?? [] });
  }
  return out;
});

async function load() {
  error.value = null;
  loaded.value = false;
  try {
    tools.value = await invokeCommand("listBuiltinTools", {});
    loaded.value = true;
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err);
    loaded.value = true;
  }
}

function isEnabled(tool: ToolItem): boolean {
  return !(settings.value.tools?.defaultExcluded ?? []).includes(toolKey(tool));
}

async function setToolEnabled(tool: ToolItem, enabled: boolean) {
  const key = toolKey(tool);
  const excluded = (settings.value.tools?.defaultExcluded ?? []).filter((k) => k !== key);
  if (!enabled) excluded.push(key);
  await settingsStore.update({
    ...settings.value,
    tools: {
      defaultAllowed: [],
      defaultExcluded: excluded,
    },
  });
  toasts.info(
    "Tool defaults updated",
    "Restart or recreate sessions to apply global tool changes.",
  );
}

async function setAll(enabled: boolean) {
  await settingsStore.update({
    ...settings.value,
    tools: {
      defaultAllowed: [],
      defaultExcluded: enabled ? [] : tools.value.map(toolKey),
    },
  });
  toasts.info(
    enabled ? "All tools enabled by default" : "All tools disabled by default",
    "Restart or recreate sessions to apply global tool changes.",
  );
}

function isExpanded(key: string): boolean {
  return expanded.value.has(key);
}

function toggleExpanded(key: string) {
  const next = new Set(expanded.value);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  expanded.value = next;
}

onMounted(() => {
  void load();
});
</script>

<template>
  <div class="tools-tab">
    <div class="tab-actions">
      <Button label="Enable all" size="small" severity="secondary" @click="setAll(true)" />
      <Button label="Disable all" size="small" severity="secondary" text @click="setAll(false)" />
      <Button
        icon="pi pi-refresh"
        size="small"
        severity="secondary"
        text
        title="Refresh"
        aria-label="Refresh"
        @click="load"
      />
    </div>
    <p class="hint">
      Global tool toggles apply to newly-created sessions. Existing sessions keep
      their current SDK tool registry.
    </p>
    <div v-if="!loaded" class="empty-hint">Loading…</div>
    <div v-else-if="error" class="empty-hint error">{{ error }}</div>
    <template v-else>
      <section v-for="group in groups" :key="group.label" class="tool-group">
        <h3 class="tool-group-title">{{ group.label }} ({{ group.items.length }})</h3>
        <ul class="tool-list">
          <li v-for="tool in group.items" :key="toolKey(tool)" class="tool-row">
            <button
              type="button"
              class="tool-name-button"
              :aria-expanded="!!tool.description && isExpanded(toolKey(tool))"
              :title="tool.description || tool.name"
              @click="tool.description && toggleExpanded(toolKey(tool))"
            >
              <i
                v-if="tool.description"
                class="pi tool-chevron"
                :class="isExpanded(toolKey(tool)) ? 'pi-chevron-down' : 'pi-chevron-right'"
                aria-hidden="true"
              />
              <span class="tool-name">{{ tool.name }}</span>
              <small v-if="tool.namespacedName" class="tool-tag">{{ tool.namespacedName }}</small>
            </button>
            <ToggleSwitch
              :model-value="isEnabled(tool)"
              :aria-label="`Enable tool ${tool.name}`"
              @update:model-value="(value: boolean) => setToolEnabled(tool, value)"
            />
            <div v-if="tool.description && isExpanded(toolKey(tool))" class="tool-desc">
              <MessageContent :text="tool.description" label="Tool description" />
            </div>
          </li>
        </ul>
      </section>
    </template>
  </div>
</template>

<style scoped>
.tools-tab {
  display: flex;
  flex-direction: column;
  gap: 0.7rem;
  min-width: 0;
}

.tab-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.35rem;
}

.hint,
.empty-hint {
  font-size: 0.78rem;
  color: var(--p-text-muted-color);
  line-height: 1.35;
}

.empty-hint.error {
  color: var(--p-message-error-color);
}

.tool-group {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
}

.tool-group-title {
  margin: 0;
  font-size: 0.7rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--p-text-muted-color);
}

.tool-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}

.tool-row {
  display: grid;
  grid-template-columns: 1fr auto;
  align-items: center;
  gap: 0.35rem 0.5rem;
  padding: 0.3rem 0.45rem;
  border-radius: var(--p-border-radius-sm);
  min-width: 0;
}

.tool-row:hover {
  background: color-mix(in srgb, var(--p-content-hover-background) 40%, transparent);
}

.tool-name-button {
  display: flex;
  align-items: center;
  gap: 0.3rem;
  min-width: 0;
  border: 0;
  background: transparent;
  color: var(--p-text-color);
  cursor: pointer;
  font: inherit;
  text-align: left;
  padding: 0;
}

.tool-chevron {
  font-size: 0.55rem;
  color: var(--p-text-muted-color);
  flex-shrink: 0;
}

.tool-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tool-tag {
  color: var(--p-text-muted-color);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.tool-desc {
  grid-column: 1 / -1;
  padding: 0.25rem 0.25rem 0.15rem 0.85rem;
}

.tool-desc :deep(.md-html-segment) {
  font-size: 0.72rem;
  line-height: 1.35;
}
</style>
