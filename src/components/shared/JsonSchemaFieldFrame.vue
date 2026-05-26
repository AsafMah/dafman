<script setup lang="ts">
/// Shared chrome for `JsonSchemaField` — the `<label>` + `*` required
/// marker + `<p class="jsf-description">` shell used by array / enum /
/// number / string field renderers. Boolean fields don't use this
/// frame (their layout is inline — switch + label + description on
/// one row).
///
/// Extracted in Phase E.4 per the 2026-05-26 rubber-duck: splitting
/// JsonSchemaField into per-type subcomponents would move the
/// duplication unless the shared label/description chrome was hoisted
/// first. This file is that hoist.

defineProps<{
  fieldId: string;
  label: string;
  required: boolean;
  description?: string;
}>();
</script>

<template>
  <div class="jsf-field">
    <label
      class="jsf-label"
      :for="fieldId"
    >
      {{ label
      }}<span
        v-if="required"
        class="jsf-required"
        aria-label="required"
        >*</span
      >
    </label>
    <p
      v-if="description"
      class="jsf-description"
    >
      {{ description }}
    </p>
    <slot />
  </div>
</template>
