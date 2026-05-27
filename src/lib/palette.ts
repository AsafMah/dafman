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

import type { Command } from '@/stores/shell/commandRegistry';

/// Single source of truth for which fields of a child command
/// participate in the parent's sub-menu fuzzy match. Used by BOTH:
///
///   1. `searchValueFor(parent)` — folds these tokens into the parent's
///      fuse corpus, so typing a child name matches the collapsed parent.
///   2. `CommandPalette.vue:shouldExpand` — auto-expands the parent if
///      any of the same tokens matches the current query.
///
/// If these two consumers ever read different fields, a query can match
/// the parent corpus without auto-expanding — the user sees the parent
/// highlighted but no children to click. Centralizing here prevents
/// that divergence (locked by `palette.test.ts`).
export function childMatchTokens(child: Command): string[] {
  const tokens: string[] = [child.label];
  if (child.keywords && child.keywords.length > 0) {
    tokens.push(...child.keywords);
  }
  return tokens;
}

export function searchValueFor(cmd: Command): string {
  const parts: string[] = [cmd.id, cmd.label];

  if (cmd.group) parts.push(cmd.group);

  if (cmd.hint) parts.push(cmd.hint);

  if (cmd.keywords && cmd.keywords.length > 0) parts.push(...cmd.keywords);

  // Sub-menu support: when a parent has children, fold their match
  // tokens into the parent's fuse corpus so a query that matches a
  // child name highlights the parent row even when it's collapsed.
  // The palette then auto-expands the parent so the user sees the
  // child hit directly — `shouldExpand` MUST read the same tokens
  // via `childMatchTokens` to stay in sync.
  if (cmd.children && cmd.children.length > 0) {
    for (const child of cmd.children) {
      parts.push(...childMatchTokens(child));
    }
  }

  return parts.join(' ');
}
