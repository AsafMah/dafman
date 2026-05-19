<script setup lang="ts">
// Read-only markdown renderer for assistant/user/reasoning/tool bubbles.
//
// History: previously rendered through Lexical so the same engine
// powered both display and composition. The display side only needs
// to render markdown, never edit, and Lexical's bundled
// `@lexical/markdown` `TRANSFORMERS` set is intentionally minimal —
// no GFM tables, no task lists, no images, no autolinks. Owning
// custom transformers for each of those is more code than just
// using a markdown parser that already supports them.
//
// markdown-it covers the GFM subset we want (tables, strikethrough,
// fenced code, autolinks via linkify, task lists via plugin) and
// `renderMarkdown` in `lib/markdown.ts` pipes its output through
// DOMPurify before we hand the HTML to `v-html`. The composer
// (MessageComposer.vue) still uses Lexical — see plan.md / AGENTS.md
// for the rationale: read-only display and rich editing have
// different needs, and Lexical's DecoratorNode + Typeahead primitives
// are the right surface for upcoming features (@file mentions, slash
// commands, attachments) on the composer side.
//
// Accessibility: the rendered HTML is wrapped in a `role="article"`
// container with `aria-readonly` so screen readers treat each
// message as a static document instead of an editable region.

import { computed } from "vue";
import { renderMarkdown } from "../lib/markdown";
// Side-effect import: registers extra prism grammars (bash, json,
// diff, yaml, toml, …) on the global Prism singleton so code fences
// in tool output highlight correctly. See prismExtraLanguages.ts
// for the language list + rationale on the load order.
import "../lexical/prismExtraLanguages";

const props = withDefaults(
  defineProps<{
    text: string;
    label?: string;
  }>(),
  { label: "Message content" },
);

const html = computed(() => renderMarkdown(props.text));
</script>

<template>
  <div
    class="md-content lex-content"
    role="article"
    :aria-readonly="true"
    :aria-label="props.label"
    v-html="html"
  />
</template>
