<script setup lang="ts">
/// Phase 19 — Library panel.
///
/// Hosts cross-session configuration and project/user instruction
/// discovery: MCP servers, Skills, Agents, and read-only Instructions.
/// Opens from the ActivityBar as a left-edge sidebar like Sessions /
/// Settings.
///
/// Each tab body is its own component so loading / state stays
/// scoped — switching tabs doesn't re-fetch the other tab's data.

import { onBeforeUnmount, onMounted, ref } from "vue";
import Tabs from "primevue/tabs";
import TabList from "primevue/tablist";
import Tab from "primevue/tab";
import TabPanels from "primevue/tabpanels";
import TabPanel from "primevue/tabpanel";
import LibraryMcpTab from "./LibraryMcpTab.vue";
import LibraryToolsTab from "./LibraryToolsTab.vue";
import LibrarySkillsTab from "./LibrarySkillsTab.vue";
import LibraryAgentsTab from "./LibraryAgentsTab.vue";
import LibraryInstructionsTab from "./LibraryInstructionsTab.vue";

// Persist the last-active tab across panel re-mounts so toggling the
// activity bar doesn't lose the user's place.
const STORAGE_KEY = "dafman.library.activeTab";
function readActiveTab(): string {
  if (typeof localStorage === "undefined") return "mcp";
  try {
    return localStorage.getItem(STORAGE_KEY) ?? "mcp";
  } catch {
    return "mcp";
  }
}
const activeTab = ref<string>(readActiveTab());
function onTabChange(value: string | number) {
  const next = String(value);
  activeTab.value = next;
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    /* private mode — ignore */
  }
}

// Cross-component activation: the right-rail Skills section dispatches
// `dafman:library-activate-tab` so a "Manage globally" click can both
// open the Library panel AND focus the right tab even when Library is
// already mounted (a localStorage write alone would only take effect
// on next reload).
function onActivateRequest(e: Event) {
  const detail = (e as CustomEvent<{ tab?: string }>).detail;
  if (detail?.tab) onTabChange(detail.tab);
}
onMounted(() => {
  window.addEventListener("dafman:library-activate-tab", onActivateRequest);
});
onBeforeUnmount(() => {
  window.removeEventListener("dafman:library-activate-tab", onActivateRequest);
});
</script>

<template>
  <div class="library-panel">
    <header class="library-header">
      <span class="library-title">Library</span>
    </header>
    <Tabs :value="activeTab" @update:value="onTabChange" class="library-tabs">
      <TabList>
        <Tab value="mcp">MCP</Tab>
        <Tab value="tools">Tools</Tab>
        <Tab value="skills">Skills</Tab>
        <Tab value="agents">Agents</Tab>
        <Tab value="instructions">Instructions</Tab>
      </TabList>
      <TabPanels>
        <TabPanel value="mcp">
          <LibraryMcpTab />
        </TabPanel>
        <TabPanel value="tools">
          <LibraryToolsTab />
        </TabPanel>
        <TabPanel value="skills">
          <LibrarySkillsTab />
        </TabPanel>
        <TabPanel value="agents">
          <LibraryAgentsTab />
        </TabPanel>
        <TabPanel value="instructions">
          <LibraryInstructionsTab />
        </TabPanel>
      </TabPanels>
    </Tabs>
  </div>
</template>

<style scoped>
.library-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-width: 0;
  max-width: 100%;
  box-sizing: border-box;
  color: var(--p-text-color);
}

.library-header {
  display: flex;
  align-items: center;
  padding: 0.6rem 0.75rem 0.4rem;
  border-bottom: 1px solid var(--p-surface-border);
}

.library-title {
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--p-text-muted-color);
}

.library-tabs {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-height: 0;
  overflow: hidden;
}

.library-tabs :deep(.p-tablist) {
  flex-shrink: 0;
}

.library-tabs :deep(.p-tabpanels) {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding: 0.5rem 0.75rem 0.75rem;
}

.library-tabs :deep(.p-tabpanel) {
  min-width: 0;
}
</style>
