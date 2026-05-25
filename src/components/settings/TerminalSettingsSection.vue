<script setup lang="ts">
/// Terminal section of the SettingsPanel — default profile, font,
/// scrollback, colors, addon toggles. All writes go through the
/// typed setters on `settingsStore` (`setDefaultTerminalProfile`,
/// `setTerminalPrefs`).

import { computed } from 'vue';
import { storeToRefs } from 'pinia';
import ColorPicker from 'primevue/colorpicker';
import InputNumber from 'primevue/inputnumber';
import InputText from 'primevue/inputtext';
import Select from 'primevue/select';
import ToggleSwitch from 'primevue/toggleswitch';
import { useSettingsStore } from '@/stores/app/settingsStore';
import type { TerminalAddonPrefs } from '@/ipc/types';
import SettingsGroup from '@/components/settings/SettingsGroup.vue';

defineProps<{ collapsed: boolean }>();
const emit = defineEmits<{ (e: 'update:collapsed', value: boolean): void }>();

const settingsStore = useSettingsStore();
const { settings } = storeToRefs(settingsStore);

const terminalProfileOptions = [
  { label: 'Platform default', value: 'platform-default' },
  { label: 'PowerShell 7 / pwsh', value: 'pwsh' },
  { label: 'Windows PowerShell', value: 'powershell' },
  { label: 'Command Prompt', value: 'cmd' },
  { label: 'Unix shell ($SHELL)', value: 'unix-shell' },
];

const terminalAddonLabels: Array<{ key: keyof TerminalAddonPrefs; label: string }> = [
  { key: 'search', label: 'Search' },
  { key: 'webLinks', label: 'Web links' },
  { key: 'clipboard', label: 'Clipboard' },
  { key: 'unicode11', label: 'Unicode 11' },
  { key: 'webFonts', label: 'Web fonts' },
  { key: 'progress', label: 'Progress' },
  { key: 'ligatures', label: 'Ligatures' },
  { key: 'image', label: 'Images' },
  { key: 'unicodeGraphemes', label: 'Graphemes' },
  { key: 'webgl', label: 'WebGL' },
  { key: 'serialize', label: 'Serialize' },
];

const defaultTerminalProfile = computed<string>({
  get: () => settings.value.terminal?.defaultProfileId ?? 'platform-default',
  set: (value) => {
    void settingsStore.setDefaultTerminalProfile(value);
  },
});

const terminalPrefs = computed(() => settings.value.terminal);

function setTerminalFontFamily(value: string): void {
  void settingsStore.setTerminalPrefs({
    fontFamily: value.trim() || terminalPrefs.value.fontFamily,
  });
}

function setTerminalFontSize(value: number | null | undefined): void {
  if (typeof value === 'number') void settingsStore.setTerminalPrefs({ fontSize: value });
}

function setTerminalScrollback(value: number | null | undefined): void {
  if (typeof value === 'number') void settingsStore.setTerminalPrefs({ scrollback: value });
}

function hexNoHash(value: string): string {
  return value.trim().replace(/^#/, '');
}

function hexWithHash(value: string): string {
  const clean = hexNoHash(value);

  return clean ? `#${clean}` : '';
}

function setTerminalColor(which: 'background' | 'foreground', value: string): void {
  const next = hexWithHash(value) || terminalPrefs.value.theme[which];

  void settingsStore.setTerminalPrefs({ theme: { [which]: next } });
}

function setTerminalAddon(key: keyof TerminalAddonPrefs, value: boolean): void {
  void settingsStore.setTerminalPrefs({ addons: { [key]: value } });
}
</script>

<template>
  <SettingsGroup
    id="terminal"
    icon="pi-window-maximize"
    label="Terminal"
    :collapsed="collapsed"
    @update:collapsed="(v) => emit('update:collapsed', v)"
  >
    <label
      class="field"
      for="terminal-profile-select"
    >
      <span class="field-label">Default terminal profile</span>
      <Select
        id="terminal-profile-select"
        v-model="defaultTerminalProfile"
        :options="terminalProfileOptions"
        option-label="label"
        option-value="value"
        size="small"
        class="field-control"
      />
      <p class="field-hint">
        Used for new terminal panes. Full profile editing is planned for a later slice.
      </p>
    </label>
    <label
      class="field"
      for="terminal-font-family"
    >
      <span class="field-label">Font family</span>
      <InputText
        id="terminal-font-family"
        :model-value="terminalPrefs.fontFamily"
        size="small"
        @update:model-value="(value) => setTerminalFontFamily(String(value))"
      />
    </label>
    <div class="settings-grid">
      <label
        class="field"
        for="terminal-font-size"
      >
        <span class="field-label">Font size</span>
        <InputNumber
          id="terminal-font-size"
          :model-value="terminalPrefs.fontSize"
          size="small"
          :min="8"
          :max="32"
          @update:model-value="setTerminalFontSize"
        />
      </label>
      <label
        class="field"
        for="terminal-scrollback"
      >
        <span class="field-label">Scrollback</span>
        <InputNumber
          id="terminal-scrollback"
          :model-value="terminalPrefs.scrollback"
          size="small"
          :min="1000"
          :max="100000"
          @update:model-value="setTerminalScrollback"
        />
      </label>
    </div>
    <div class="settings-grid">
      <label
        class="field color-field"
        for="terminal-background"
      >
        <span class="field-label">Background</span>
        <div class="color-row">
          <ColorPicker
            input-id="terminal-background"
            :model-value="hexNoHash(terminalPrefs.theme.background)"
            @update:model-value="(value) => setTerminalColor('background', String(value))"
          />
          <code>{{ terminalPrefs.theme.background }}</code>
        </div>
      </label>
      <label
        class="field color-field"
        for="terminal-foreground"
      >
        <span class="field-label">Foreground</span>
        <div class="color-row">
          <ColorPicker
            input-id="terminal-foreground"
            :model-value="hexNoHash(terminalPrefs.theme.foreground)"
            @update:model-value="(value) => setTerminalColor('foreground', String(value))"
          />
          <code>{{ terminalPrefs.theme.foreground }}</code>
        </div>
      </label>
    </div>
    <div class="addon-grid">
      <label
        v-for="addon in terminalAddonLabels"
        :key="addon.key"
        class="addon-toggle"
      >
        <ToggleSwitch
          :model-value="terminalPrefs.addons[addon.key]"
          @update:model-value="(value) => setTerminalAddon(addon.key, value)"
        />
        <span>{{ addon.label }}</span>
      </label>
    </div>
    <p class="field-hint">Display and addon changes apply to newly opened terminal panels.</p>
  </SettingsGroup>
</template>
