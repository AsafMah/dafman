<script setup lang="ts">
/// `<ArgumentsPreview>` — the `<details><summary>Arguments</summary>
/// <CommandBlock lang="json" /></details>` shape shared by
/// `PermissionDetails.vue` (3 sites) and `ToolDetails.vue` (2 sites).
///
/// Extracted in Phase E.1. Pure template move — no behavior change.
/// The host passes its own scoped class so the existing styles
/// (`.perm-preview`, `.tool-preview`) still apply to the rendered
/// `<details>` element.

import CommandBlock from '@/components/details/CommandBlock.vue';

defineProps<{
  /// JSON-stringified arguments to render in the code block.
  code: string;
  /// `<details>` `open` attribute. Defaults to closed.
  open?: boolean;
  /// Class applied to the `<details>` element so the caller's scoped
  /// styles still target it. Most callers pass `"perm-preview"` or
  /// `"tool-preview"`.
  detailsClass?: string;
  /// Code language hint forwarded to `CommandBlock`. Defaults to
  /// `"json"` since every current caller uses JSON.
  lang?: string;
}>();
</script>

<template>
  <details
    :class="detailsClass"
    :open="open"
  >
    <summary>Arguments</summary>
    <CommandBlock
      :code="code"
      :lang="lang ?? 'json'"
    />
  </details>
</template>
