// Resolves a `ThemeChoice` to the actual `is dark` boolean given the
// system preference. Lives outside the store so it can be unit-tested
// without Pinia.

import type { ThemeChoice } from "../ipc/types";

export function resolveIsDark(theme: ThemeChoice, prefersDark: boolean): boolean {
  switch (theme) {
    case "system":
      return prefersDark;
    case "dark":
      return true;
    case "light":
      return false;
  }
}
