// Directory autocomplete helper.
//
// Powers the workspace AutoComplete in the topbar and the Sessions
// panel: given a partial path like `C:\repo\dafm`, return immediate
// subdirectories of the parent whose name starts with the leaf
// prefix.
//
// Framework-agnostic — uses node:fs directly so it's unit-testable
// without a webview.
//
// Design notes:
// - Capped at 20 entries so a wide directory (e.g. `C:\Windows\`)
//   doesn't flood the AutoComplete dropdown.
// - Case-insensitive prefix match — matches Windows filesystem
//   semantics and is friendly on macOS / Linux too.
// - Returns absolute paths joined with the platform separator so the
//   AutoComplete dropdown value can be pasted back into the input
//   verbatim.
// - On any filesystem error (path doesn't exist yet, permission
//   denied, network drive offline) we return `[]` — the UI falls
//   back to MRU-only suggestions without surfacing the error.

import { readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";

const MAX_RESULTS = 20;

/// True when `prefix` ends in a path separator. Determines whether
/// we list the directory itself vs. complete against the leaf.
function endsWithSeparator(prefix: string): boolean {
  return prefix.endsWith("/") || prefix.endsWith("\\");
}

/// Cross-platform basename extraction without dragging in `path`'s
/// normalization (which would coerce `/` <-> `\` on Windows).
function leafOf(prefix: string): string {
  const lastSlash = Math.max(
    prefix.lastIndexOf("/"),
    prefix.lastIndexOf("\\"),
  );
  return lastSlash === -1 ? prefix : prefix.slice(lastSlash + 1);
}

export function browseDirectorySync(prefix: string): string[] {
  const trimmed = prefix.trim();
  if (!trimmed) return [];

  // If the input ends with a separator, treat the whole thing as the
  // directory to list and return all subdirectories.
  // Otherwise the trailing segment is the search prefix.
  let parent: string;
  let leafPrefix: string;
  if (endsWithSeparator(trimmed)) {
    parent = trimmed;
    leafPrefix = "";
  } else {
    parent = dirname(trimmed);
    leafPrefix = leafOf(trimmed);
    // dirname("C:") on Windows returns "C:", on a single segment like
    // "foo" returns "." — fine, we just won't find much.
  }

  let entries: string[];
  try {
    entries = readdirSync(parent);
  } catch {
    return [];
  }

  const lowerPrefix = leafPrefix.toLowerCase();
  const matches: string[] = [];
  for (const name of entries) {
    if (
      lowerPrefix.length > 0 &&
      !name.toLowerCase().startsWith(lowerPrefix)
    ) {
      continue;
    }
    // Skip hidden / dot-prefixed entries unless the user is explicitly
    // typing a dot — saves them from `.git` / `.next` / `node_modules`
    // noise on every keystroke.
    if (lowerPrefix.length === 0 && name.startsWith(".")) continue;
    const full = join(parent, name);
    try {
      if (!statSync(full).isDirectory()) continue;
    } catch {
      continue;
    }
    matches.push(full);
    if (matches.length >= MAX_RESULTS) break;
  }
  // Sort case-insensitively — matches the way Explorer presents
  // entries and is more useful than the FS-default insertion order.
  matches.sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
  return matches;
}
