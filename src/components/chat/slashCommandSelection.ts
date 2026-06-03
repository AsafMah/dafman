export function resolveHighlightedOption<T>(
  options: readonly T[],
  selectedIndex: number | null | undefined,
): T | null {
  if (
    typeof selectedIndex === 'number' &&
    Number.isInteger(selectedIndex) &&
    selectedIndex >= 0 &&
    selectedIndex < options.length
  ) {
    return options[selectedIndex] ?? null;
  }

  return options[0] ?? null;
}
