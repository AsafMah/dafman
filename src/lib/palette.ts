// Helpers for the command palette. Lives outside `CommandPalette.vue`
// so the searchValue mapping is unit-testable without mounting Vue.
//
// The crucial piece is `searchValueFor` — the composite searchable
// string used as the `data-value` on every `<Command.Item>`. The
// `vue-command-palette` library's bundled fuse instance reads the
// `data-value` attribute (NOT slot text content) for fuzzy matching,
// and `@select-item` emits `{ key, value }` where `value` is that
// same string. We therefore need:
//
//   1. A search-friendly composite (label + group + hint + keywords).
//   2. A unique prefix so the value can be the lookup key in our
//      command-by-value map (the command id satisfies both — it's
//      unique by construction).

import type { Command } from '../stores/shell/commandRegistry';

export function searchValueFor(cmd: Command): string {
  const parts: string[] = [cmd.id, cmd.label];

  if (cmd.group) parts.push(cmd.group);

  if (cmd.hint) parts.push(cmd.hint);

  if (cmd.keywords && cmd.keywords.length > 0) parts.push(...cmd.keywords);

  return parts.join(' ');
}
