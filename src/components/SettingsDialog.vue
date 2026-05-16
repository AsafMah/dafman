<script setup lang="ts">
import { computed } from "vue";
import { storeToRefs } from "pinia";
import Button from "primevue/button";
import Dialog from "primevue/dialog";
import SelectButton from "primevue/selectbutton";
import Tabs from "primevue/tabs";
import TabList from "primevue/tablist";
import Tab from "primevue/tab";
import TabPanels from "primevue/tabpanels";
import TabPanel from "primevue/tabpanel";
import { useSettingsStore } from "../stores/settingsStore";
import type { ReasoningVisibility, ThemeChoice } from "../ipc/types";

const props = defineProps<{ visible: boolean }>();
const emit = defineEmits<{
  (e: "update:visible", value: boolean): void;
}>();

const settingsStore = useSettingsStore();
const { settings, isSaving } = storeToRefs(settingsStore);

const themeOptions: { label: string; value: ThemeChoice }[] = [
  { label: "System", value: "system" },
  { label: "Light", value: "light" },
  { label: "Dark", value: "dark" },
];

const reasoningOptions: { label: string; value: ReasoningVisibility }[] = [
  { label: "Hidden", value: "hidden" },
  { label: "Compact", value: "compact" },
  { label: "Expanded", value: "expanded" },
];

const theme = computed<ThemeChoice>({
  get: () => settings.value.appearance.theme,
  set: (value) => {
    void settingsStore.setTheme(value);
  },
});

const reasoningVisibility = computed<ReasoningVisibility>({
  get: () => settings.value.appearance.reasoningVisibility,
  set: (value) => {
    void settingsStore.setReasoningVisibility(value);
  },
});

function close() {
  emit("update:visible", false);
}
</script>

<template>
  <Dialog
    :visible="props.visible"
    modal
    header="Settings"
    :style="{ width: 'min(560px, 90vw)' }"
    :draggable="false"
    @update:visible="(v) => emit('update:visible', v)"
  >
    <Tabs value="appearance">
      <TabList>
        <Tab value="general">General</Tab>
        <Tab value="appearance">Appearance</Tab>
      </TabList>
      <TabPanels>
        <TabPanel value="general">
          <p class="muted">
            Schema version
            <strong>{{ settings.version }}</strong> - stored under
            <code>app_config_dir()/settings.json</code>.
          </p>
        </TabPanel>
        <TabPanel value="appearance">
          <div class="row">
            <label id="theme-label">Theme</label>
            <SelectButton
              v-model="theme"
              :options="themeOptions"
              option-label="label"
              option-value="value"
              :allow-empty="false"
              aria-labelledby="theme-label"
            />
          </div>
          <div class="row">
            <label id="reasoning-label">Reasoning visibility</label>
            <SelectButton
              v-model="reasoningVisibility"
              :options="reasoningOptions"
              option-label="label"
              option-value="value"
              :allow-empty="false"
              aria-labelledby="reasoning-label"
            />
            <p class="muted hint">
              Default for new chats. Each session can override this from its header.
            </p>
          </div>
        </TabPanel>
      </TabPanels>
    </Tabs>

    <template #footer>
      <span v-if="isSaving" class="muted">Saving...</span>
      <Button label="Close" icon="pi pi-times" @click="close" />
    </template>
  </Dialog>
</template>

<style scoped>
.row {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 0.5rem 0;
}

.muted {
  color: var(--p-text-muted-color);
  margin: 0;
}

.hint {
  font-size: 0.85rem;
}
</style>
