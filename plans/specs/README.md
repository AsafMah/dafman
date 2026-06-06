# `plans/specs/` — design specs awaiting decisions

Design specs for larger future features. Each is a self-contained doc with a
**grounded current-state** section (real `file:line` citations), a concrete
design, **open questions** (with recommended defaults), **alternatives** (with
tradeoffs), and rough implementation phases.

These are drafts for asynchronous review: the **Open questions** sections are the
decision surface — answer them (or accept the recommended default) and the phases
become actionable. None of this is implemented yet.

| Spec | What it covers | Tracking issue |
|---|---|---|
| [`keyboard-shortcuts.md`](keyboard-shortcuts.md) | Unified shortcut system: central registry binding chords/sequences → command ids, scope/focus resolution, conflict detection, default keymap, user customization + Settings editor. Full inventory of today's scattered handlers. | — |
| [`keyboard-shortcuts.md`](keyboard-shortcuts.md) | Unified shortcut system: central registry binding chords/sequences → command ids, scope/focus resolution, conflict detection, default keymap, user customization + Settings editor. Full inventory of today's scattered handlers. | [#183](https://github.com/AsafMah/dafman/issues/183) |
| [`session-pane.md`](session-pane.md) | Session list pane: grouping modes (workspace / dockview group / date / flat), sort, search/filter, color-by-group for open sessions, persisted view prefs. | [#184](https://github.com/AsafMah/dafman/issues/184) |
| [`palette-session-jump.md`](palette-session-jump.md) | Jump to (open) and resume (on-disk) sessions from the command palette; reuses the cross-group reveal path (#173). | [#185](https://github.com/AsafMah/dafman/issues/185) |
| [`copilot-sdk-update.md`](copilot-sdk-update.md) | Bump `@github/copilot-sdk` beta.9 → 1.0.0 stable + audit of SDK/CLI features dafman doesn't yet surface (CLI slash commands, session config/model selectors, custom-agent registration, hooks, metadata persistence). | [#186](https://github.com/AsafMah/dafman/issues/186) |
| [`backend-abstraction-acp.md`](backend-abstraction-acp.md) | Abstract the agent backend behind a thin `Provider` interface; Copilot SDK stays first-class, add an **ACP** (Agent Client Protocol) provider to plug in Claude Code / Gemini / Codex / etc. "for free." Capability negotiation, per-provider auth, RPC↔ACP mapping. | [#187](https://github.com/AsafMah/dafman/issues/187) |

> Convention note: `plans/README.md` says open work lives in GitHub issues (the
> old `TODO.md` was retired). These specs are the long-form design behind issues;
> link each spec from its tracking issue once filed.
