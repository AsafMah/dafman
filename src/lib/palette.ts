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

/// Tokens for a child command that participate in `shouldExpand`'s
/// auto-expand check. When the live palette query matches any of
/// these on any child of a parent, the parent renders its children
/// (the library's fuse then filters which children actually display).
///
/// Note (2026-05-27): child tokens are NO LONGER folded into the
/// parent's `searchValueFor` corpus. Earlier they were, which made
/// `vue-command-palette`'s fuse match the parent row too — typing
/// "claude" surfaced both "Switch Model" and "Claude Opus 4.7" as
/// peers, doubling the clutter. The user expected to see ONLY the
/// matching child. Today the parent matches by its own fields
/// (label / id / group / hint / keywords); auto-expand still happens
/// when a child token matches, so the library can show the child
/// directly and the parent row stays hidden.
export function childMatchTokens(child: Command): string[] {
  const tokens: string[] = [child.label];

  if (child.keywords && child.keywords.length > 0) {
    tokens.push(...child.keywords);
  }

  return tokens;
}

/// Tokens that match the PARENT itself. Used by `shouldExpand` to
/// also auto-expand when the parent's own fields match (e.g. typing
/// "model" expands the "Switch Model" parent's children so the user
/// can pick a specific model without a second click).
export function parentSelfTokens(cmd: Command): string[] {
  const tokens: string[] = [cmd.id, cmd.label];

  if (cmd.group) tokens.push(cmd.group);

  if (cmd.hint) tokens.push(cmd.hint);

  if (cmd.keywords && cmd.keywords.length > 0) tokens.push(...cmd.keywords);

  return tokens;
}

export function searchValueFor(cmd: Command): string {
  // Parent commands are matched by their OWN fields only. Children
  // surface via the per-child Command.Item (rendered when shouldExpand
  // fires) — not by folding child tokens into the parent corpus.
  // See `childMatchTokens` for the history of this decision.
  return parentSelfTokens(cmd).join(' ');
}
