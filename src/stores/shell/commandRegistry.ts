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
  /// `["Ctrl", "K"]`. Transitional display field — long-term this
  /// will be derived from shortcutRegistry.displayKeysForCommand().
  shortcut?: string[];
  /// Optional accent color (CSS color string) that overrides the
  /// category accent on this specific row.
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
  /// Optional inline-children for sub-menu drill-down. When present:
  ///   - The palette renders this row with a `›` (collapsed) / `⌄`
  ///     (expanded) arrow and Enter toggles expansion instead of
  ///     calling `run` (you can still provide `run` for keyboard-
  ///     shortcut firing, but the palette UI ignores it for parents).
  ///   - Children render INDENTED under the parent only when expanded.
  ///   - Fuse search corpus on the parent includes every child's
  ///     label + keywords, so typing a child name matches the parent
  ///     row when collapsed; the parent then auto-expands on match.
  ///   - Each child renders as its own `Command.Item` with its own
  ///     `data-value` when the parent is expanded, so children
  ///     participate independently in fuse filtering and selection.
  children?: Command[];
  /// Palette presentation hints. `visible: false` suppresses the
  /// command from Ctrl/Cmd+K while still listing it in Keyboard Settings.
  palette?: {
    visible?: boolean; // default true
    group?: string;
  };
  /// Scopes in which this command's shortcut is active (display/filter
  /// hint only — shortcutRegistry owns the actual binding).
  shortcutContext?: import('@/lib/shortcuts/types').ShortcutScope[];
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

  /**
   * Looks up a command by id — searches top-level commands AND their
   * visible children. Returns `null` when nothing matches.
   */
  function getCommand(id: string): Command | null {
    const top = commands.value.get(id);

    if (top) return top;

    for (const cmd of commands.value.values()) {
      if (cmd.children) {
        const child = cmd.children.find((c) => c.id === id);

        if (child) return child;
      }
    }

    return null;
  }

  /**
   * Flat list of all commands + their children whose `when()` returns true.
   * Useful for palette search, settings search, and shortcut resolution.
   */
  const visibleFlattenedCommands = computed<Command[]>(() => {
    const result: Command[] = [];

    for (const cmd of commands.value.values()) {
      if (!safeWhen(cmd)) continue;

      result.push(cmd);

      if (cmd.children) {
        for (const child of cmd.children) {
          if (safeWhen(child)) result.push(child);
        }
      }
    }

    return result;
  });

  /**
   * Runs the command with the given id if it is currently visible (i.e.
   * `when()` returns true). Parent commands with children are skipped —
   * they are structural, not executable.
   *
   * Returns `true` when the command ran, `false` otherwise (not found,
   * invisible, or has children). Errors thrown by `run()` are caught and
   * logged to the console so they do not bubble up to callers.
   */
  async function runCommand(id: string): Promise<boolean> {
    const cmd = getCommand(id);

    if (!cmd) return false;

    // Parent commands that own children are structural — not directly runnable.
    if (cmd.children && cmd.children.length > 0) return false;

    if (!safeWhen(cmd)) return false;

    try {
      await cmd.run();

      return true;
    } catch (err) {
      console.error(`[commandRegistry] runCommand("${id}") threw:`, err);

      return false;
    }
  }

  return {
    commands,
    register,
    unregister,
    visibleCommands,
    getCommand,
    visibleFlattenedCommands,
    runCommand,
  };
});
