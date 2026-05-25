<script setup lang="ts">
/// Notifications section of the SettingsPanel — turnEnd / waitingForInput
/// toggles plus a permission-request button when the OS permission is
/// still in the default state.

import { computed } from 'vue';
import { storeToRefs } from 'pinia';
import Button from 'primevue/button';
import ToggleSwitch from 'primevue/toggleswitch';
import { useSettingsStore } from '@/stores/app/settingsStore';
import { useNotificationsStore } from '@/stores/app/notificationsStore';
import SettingsGroup from '@/components/settings/SettingsGroup.vue';

defineProps<{ collapsed: boolean }>();
const emit = defineEmits<{ (e: 'update:collapsed', value: boolean): void }>();

const settingsStore = useSettingsStore();
const notificationsStore = useNotificationsStore();
const { settings } = storeToRefs(settingsStore);

/// Two booleans bound to settings.notifications.{turnEnd,waitingForInput}.
/// Setter routes through settingsStore.setNotifications so the
/// changes persist immediately.
const notifyTurnEnd = computed<boolean>({
  get: () => settings.value.notifications?.turnEnd ?? false,
  set: (value) => {
    void settingsStore.setNotifications({ turnEnd: value });

    // If the user just turned ON a notification and the browser
    // doesn't have permission yet, kick off the prompt so they
    // don't enable a no-op toggle. Skipped when turning OFF.
    if (value && notificationsStore.permission === 'default') {
      void notificationsStore.requestPermission();
    }
  },
});

const notifyWaitingForInput = computed<boolean>({
  get: () => settings.value.notifications?.waitingForInput ?? true,
  set: (value) => {
    void settingsStore.setNotifications({ waitingForInput: value });

    if (value && notificationsStore.permission === 'default') {
      void notificationsStore.requestPermission();
    }
  },
});

const notificationPermissionLabel = computed(() => {
  switch (notificationsStore.permission) {
    case 'granted':
      return 'Granted';
    case 'denied':
      return 'Denied — enable in your OS / browser settings.';
    case 'default':
      return 'Not yet asked — toggle a notification on to grant.';
    case 'unsupported':
    default:
      return 'Not supported in this WebView.';
  }
});

async function askPermission() {
  await notificationsStore.requestPermission();
}
</script>

<template>
  <SettingsGroup
    id="notifications"
    icon="pi-bell"
    label="Notifications"
    :collapsed="collapsed"
    @update:collapsed="(v) => emit('update:collapsed', v)"
  >
    <div class="field field-inline">
      <label class="field-inline-label">
        <ToggleSwitch v-model="notifyWaitingForInput" />
        <span>Waiting for input</span>
      </label>
      <p class="field-hint">
        OS notification when a tool needs permission or a session asks for input, and you're not
        on its panel.
      </p>
    </div>
    <div class="field field-inline">
      <label class="field-inline-label">
        <ToggleSwitch v-model="notifyTurnEnd" />
        <span>Turn complete</span>
      </label>
      <p class="field-hint">
        OS notification on every <code>assistant.turn_end</code> for a background session. Off
        by default — can be noisy.
      </p>
    </div>
    <div class="field">
      <p class="field-hint">
        Browser permission: <strong>{{ notificationPermissionLabel }}</strong>
      </p>
      <Button
        v-if="notificationsStore.permission === 'default'"
        label="Request permission"
        icon="pi pi-shield"
        severity="secondary"
        size="small"
        @click="askPermission"
      />
    </div>
  </SettingsGroup>
</template>
