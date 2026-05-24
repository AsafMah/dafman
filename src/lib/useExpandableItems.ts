// Composable: in-memory item expansion state for list rows.
//
// Tracks which items in a list are expanded (e.g. "show full
// description" toggles). Keyed by `${kind}:${name}`. Not persisted
// — resets on component remount.

import { ref, type Ref } from "vue";

export function useExpandableItems(): {
  expandedItems: Ref<Set<string>>;
  isItemExpanded: (kind: string, name: string) => boolean;
  toggleItemExpansion: (kind: string, name: string) => void;
} {
  const expandedItems = ref<Set<string>>(new Set());

  function isItemExpanded(kind: string, name: string): boolean {
    return expandedItems.value.has(`${kind}:${name}`);
  }

  function toggleItemExpansion(kind: string, name: string): void {
    const key = `${kind}:${name}`;
    const next = new Set(expandedItems.value);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    expandedItems.value = next;
  }

  return { expandedItems, isItemExpanded, toggleItemExpansion };
}
