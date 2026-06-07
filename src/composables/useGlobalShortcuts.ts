import { onMounted, onBeforeUnmount } from 'vue';
import { matchKeybindingPress, parseKeybinding } from 'tinykeys';
import type { KeybindingPress } from 'tinykeys';
import { useShortcutRegistry } from '@/stores/shell/shortcutRegistry';
import { useCommandRegistry } from '@/stores/shell/commandRegistry';
import type { EffectiveBinding } from '@/lib/shortcuts/types';

const SEQUENCE_TIMEOUT_MS = 1000;

const EDITABLE_ALLOWLIST = new Set<string>(['commandPalette.toggle', 'settings.open']);

interface PendingMatch {
  binding: EffectiveBinding;
  presses: KeybindingPress[];
  matchedCount: number;
}

function focusIsEditable(): boolean {
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName.toLowerCase();
  if (tag === 'input' || tag === 'textarea') return true;
  let node: Element | null = el;
  while (node && node !== document.body) {
    if ((node as HTMLElement).isContentEditable) return true;
    node = node.parentElement;
  }
  return false;
}

export function useGlobalShortcuts(): void {
  const shortcutRegistry = useShortcutRegistry();
  const commandRegistry = useCommandRegistry();

  let pending: PendingMatch[] = [];
  let sequenceTimer: ReturnType<typeof setTimeout> | null = null;

  function clearPending(): void {
    pending = [];
    if (sequenceTimer !== null) {
      clearTimeout(sequenceTimer);
      sequenceTimer = null;
    }
  }

  function scheduleReset(): void {
    if (sequenceTimer !== null) clearTimeout(sequenceTimer);
    sequenceTimer = setTimeout(() => {
      pending = [];
      sequenceTimer = null;
    }, SEQUENCE_TIMEOUT_MS);
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (event.isComposing || event.key === 'Process') return;
    if (event.repeat) return;

    const inEditable = focusIsEditable();
    let bindingsToCheck = shortcutRegistry.bindingsForScope('global');
    if (inEditable) {
      bindingsToCheck = bindingsToCheck.filter((b) => EDITABLE_ALLOWLIST.has(b.commandId));
    }

    // Pending sequence advancement
    if (pending.length > 0) {
      let completed: EffectiveBinding | null = null;
      const advancing: PendingMatch[] = [];

      for (const pm of pending) {
        if (matchKeybindingPress(event, pm.presses[pm.matchedCount])) {
          if (pm.matchedCount + 1 >= pm.presses.length) {
            completed = pm.binding;
            break;
          } else {
            advancing.push({ ...pm, matchedCount: pm.matchedCount + 1 });
          }
        }
      }

      clearPending();

      if (completed) {
        event.preventDefault();
        event.stopPropagation();
        void commandRegistry.runCommand(completed.commandId);
        return;
      }

      if (advancing.length > 0) {
        pending = advancing;
        scheduleReset();
        event.preventDefault();
        return;
      }

      // Fall through to fresh match
    }

    // Fresh match
    let directMatch: EffectiveBinding | null = null;
    const newPending: PendingMatch[] = [];

    for (const binding of bindingsToCheck) {
      const presses = parseKeybinding(binding.keys) as KeybindingPress[];
      if (presses.length === 0) continue;
      if (matchKeybindingPress(event, presses[0])) {
        if (presses.length === 1) {
          directMatch = binding;
          break;
        } else {
          newPending.push({ binding, presses, matchedCount: 1 });
        }
      }
    }

    if (directMatch) {
      event.preventDefault();
      event.stopPropagation();
      void commandRegistry.runCommand(directMatch.commandId);
      return;
    }

    if (newPending.length > 0) {
      pending = newPending;
      scheduleReset();
      event.preventDefault();
      return;
    }
  }

  onMounted(() => {
    window.addEventListener('keydown', handleKeydown, true);
  });

  onBeforeUnmount(() => {
    window.removeEventListener('keydown', handleKeydown, true);
    clearPending();
  });
}
