// Settings store — mirrors the on-disk JSON document owned by
// `app::settings::SettingsService`. `load()` should be called once at app
// startup; `update()` does a full-replace (the backend persists to disk
// and returns the canonical document, including the stamped version).

import { defineStore } from "pinia";
import { ref } from "vue";
import { invokeCommand } from "../ipc/invoke";
import type { Settings, ThemeChoice } from "../ipc/types";
import { useToastStore } from "./toastStore";

function defaultSettings(): Settings {
  return { version: 1, appearance: { theme: "system" } };
}

export const useSettingsStore = defineStore("settings", () => {
  const settings = ref<Settings>(defaultSettings());
  const loaded = ref(false);
  const isSaving = ref(false);

  async function load(): Promise<Settings> {
    try {
      const next = await invokeCommand("get_settings", {});
      settings.value = next;
      loaded.value = true;
      return next;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      useToastStore().error("Failed to load settings", message);
      throw err;
    }
  }

  async function update(next: Settings): Promise<Settings> {
    isSaving.value = true;
    try {
      const written = await invokeCommand("update_settings", { next });
      settings.value = written;
      return written;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      useToastStore().error("Failed to save settings", message);
      throw err;
    } finally {
      isSaving.value = false;
    }
  }

  async function setTheme(theme: ThemeChoice): Promise<Settings> {
    return update({
      ...settings.value,
      appearance: { ...settings.value.appearance, theme },
    });
  }

  return { settings, loaded, isSaving, load, update, setTheme };
});
