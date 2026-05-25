<script setup lang="ts">
/// Repeating chrome for one section of the SettingsPanel: the collapse
/// toggle, the chevron, the icon, and the section title. Body content
/// goes in the default slot.
///
/// Collapsed state is owned by the parent — pass `collapsed` and emit
/// `update:collapsed`. Section ids are still managed in one place
/// (`SettingsPanel`'s `collapsed` reactive map) so a future search
/// field can expand-on-match across all sections.

const props = defineProps<{
  id: string;
  icon: string;
  label: string;
  collapsed: boolean;
}>();

const emit = defineEmits<{
  (e: 'update:collapsed', value: boolean): void;
}>();

function toggle(): void {
  emit('update:collapsed', !props.collapsed);
}
</script>

<template>
  <section class="settings-group">
    <button
      type="button"
      class="group-header"
      :aria-expanded="!collapsed"
      @click="toggle"
    >
      <i
        class="pi group-chevron"
        :class="collapsed ? 'pi-chevron-right' : 'pi-chevron-down'"
        aria-hidden="true"
      />
      <i
        class="pi group-icon"
        :class="icon"
        aria-hidden="true"
      />
      <span class="group-label">{{ label }}</span>
    </button>

    <div
      v-show="!collapsed"
      class="group-body"
    >
      <slot />
    </div>
  </section>
</template>
