// Helper for registering and sweeping dynamic command palette entries
// that mirror a reactive data source (e.g. models, workspaces, sessions).
//
// Three callers in registerBuiltinCommands.ts used an identical
// watch + set + sweep pattern. This helper eliminates the duplication
// and makes the lifecycle explicit.

import { watch, type WatchSource } from 'vue';

import type { Command } from '@/stores/shell/commandRegistry';

export interface DynamicCommandsOptions<T> {
  /// Reactive source that returns the current list of items.
  source: WatchSource<T[]>;
  /// Derive a stable command from each item. Return the full Command
  /// object; the `id` field must be unique across the set.
  toCommand: (item: T) => Command;
  /// Registry callbacks — usually `commandRegistry.register` and
  /// `commandRegistry.unregister`.
  register: (cmd: Command) => void;
  unregister: (id: string) => void;
}

/// Watch a reactive list and keep the command registry in sync.
/// Returns an unwatch function for cleanup if needed.
export function watchDynamicCommands<T>(opts: DynamicCommandsOptions<T>): () => void {
  const activeIds = new Set<string>();

  return watch(
    opts.source,
    (items) => {
      const nextIds = new Set<string>();

      for (const item of items) {
        const cmd = opts.toCommand(item);

        nextIds.add(cmd.id);
        opts.register(cmd);
      }

      for (const id of activeIds) {
        if (!nextIds.has(id)) opts.unregister(id);
      }

      activeIds.clear();

      for (const id of nextIds) activeIds.add(id);
    },
    { immediate: true, deep: true },
  );
}
