// Command registry — the source of truth for everything the command
// palette can fire. Producers (`registerBuiltinCommands`, future
// per-feature contributions) call `register(cmd)`; the palette
// component reads `visibleCommands` for its filtered list.
//
// Design notes:
//
// * **Replace-by-id.** `register` overwrites any existing entry with
//   the same id, so HMR re-runs and "bulk re-register on dependency
//   change" patterns (e.g. re-emitting one Switch Model command per
//   model whenever `modelsStore.models` resolves) are idempotent.
//
// * **`when()` evaluated lazily on read.** `visibleCommands` is a
//   computed that calls each command's `when()` (if provided) on
//   every access. As long as the predicate reads live refs / store
//   state, Vue's reactivity tracks the dependencies correctly and
//   the palette list updates when (say) the active session changes.
//   `when()` is wrapped in try/catch so one badly-written predicate
//   doesn't blank the whole palette.
//
// * **No "open" state here.** Whether the palette overlay is shown
//   belongs to the component; this store only owns the catalog.

import { defineStore } from 'pinia';
import { computed, ref } from 'vue';

export interface Command {
  /// Stable identity. `register` overwrites by id, so registrations
  /// that re-fire on dependency change (model list, MRU workspaces) can
  /// use a derived id like `model.switch.${modelId}` without dedupe
  /// bookkeeping at the call site.
  id: string;
  label: string;
  /// Secondary text rendered to the right of the label (e.g. shortcut
  /// hint, current value, last-used workspace path).
  hint?: string;
  /// PrimeIcons class shown next to the label (e.g. `pi pi-cog`).
  icon?: string;
  /// Group header in the palette. Commands with the same `group` cluster
  /// under a single section heading. Omit for ungrouped entries.
  group?: string;
  /// Extra search corpus for fuzzy match (typed synonyms, command-id
  /// aliases, "vscode-style verbs"). The label + group + hint are
  /// always included; this is purely additive.
  keywords?: string[];
  /// Optional keyboard shortcut, rendered as `<kbd>` pills in the
  /// palette row. Pass the chord segments as an array, e.g.
  /// `["Ctrl", "K"]`. The library also wires this to fire `perform`
  /// when the chord is pressed globally — we leave that wiring on
  /// for free.
  shortcut?: string[];
  /// Optional accent color (CSS color string) that overrides the
  /// category accent on this specific row. Used for "Switch to:
  /// `<session>`" so each session's command picks up its own per-
  /// session palette accent.
  accent?: string;
  /// Visibility predicate. Hidden commands are excluded from the list
  /// (we don't render greyed-out rows — `when()` failure means the
  /// command is irrelevant to the current state). Must read live
  /// reactive state so Vue tracks deps; a literal-closure boolean will
  /// never update.
  when?: () => boolean;
  /// Action. May return a promise; the palette closes optimistically
  /// before resolution, so async work runs in the background.
  run: () => void | Promise<void>;
}

export const useCommandRegistry = defineStore('commandRegistry', () => {
  const commands = ref<Map<string, Command>>(new Map());

  function register(command: Command): () => void {
    commands.value.set(command.id, command);

    return () => unregister(command.id);
  }

  function unregister(id: string): void {
    commands.value.delete(id);
  }

  function safeWhen(cmd: Command): boolean {
    if (!cmd.when) return true;

    try {
      return cmd.when();
    } catch {
      return false;
    }
  }

  const visibleCommands = computed<Command[]>(() =>
    Array.from(commands.value.values()).filter(safeWhen),
  );

  return { commands, register, unregister, visibleCommands };
});
