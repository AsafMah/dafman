/// Line-based diff using a simple LCS table. Returns a flat list of
/// rendered rows: `{ kind: "equal" | "added" | "removed", text }`.
///
/// Plenty fast for the sizes we care about (edit args are typically
/// a handful of lines; we cap at MAX_LINES per side to keep this
/// O(n*m) safe). Beyond the cap we fall back to "all removed / all
/// added" — a real Myers diff is overkill for the tool-call surface.

const MAX_LINES = 400;

export type DiffRow = {
  kind: "equal" | "added" | "removed";
  text: string;
  /// 1-based; only set for kept/removed lines (left side) or
  /// kept/added lines (right side). Useful for line gutters.
  oldLine?: number;
  newLine?: number;
};

export function lineDiff(oldText: string, newText: string): DiffRow[] {
  const a = oldText.split("\n");
  const b = newText.split("\n");
  if (a.length > MAX_LINES || b.length > MAX_LINES) {
    const rows: DiffRow[] = [];
    a.forEach((text, i) => rows.push({ kind: "removed", text, oldLine: i + 1 }));
    b.forEach((text, i) => rows.push({ kind: "added", text, newLine: i + 1 }));
    return rows;
  }
  // LCS DP
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () =>
    new Array(m + 1).fill(0),
  );
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      if (a[i] === b[j]) {
        dp[i]![j] = dp[i + 1]![j + 1]! + 1;
      } else {
        dp[i]![j] = Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
      }
    }
  }
  const rows: DiffRow[] = [];
  let i = 0;
  let j = 0;
  let oldLine = 1;
  let newLine = 1;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      rows.push({ kind: "equal", text: a[i]!, oldLine, newLine });
      i++;
      j++;
      oldLine++;
      newLine++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      rows.push({ kind: "removed", text: a[i]!, oldLine });
      i++;
      oldLine++;
    } else {
      rows.push({ kind: "added", text: b[j]!, newLine });
      j++;
      newLine++;
    }
  }
  while (i < n) {
    rows.push({ kind: "removed", text: a[i]!, oldLine });
    i++;
    oldLine++;
  }
  while (j < m) {
    rows.push({ kind: "added", text: b[j]!, newLine });
    j++;
    newLine++;
  }
  return rows;
}

/// Parse a "*** Begin Patch" formatted patch (the apply_patch tool
/// format) into per-file blocks. Format reference:
///
///   *** Begin Patch
///   *** Update File: path/to/file
///   @@
///   -removed line
///   +added line
///    context line
///   *** Add File: path
///   +new content
///   *** Delete File: path
///   *** End Patch
///
/// Tolerates a missing trailing `*** End Patch`. Lines that don't
/// match a header or hunk marker accumulate into the current file's
/// body. Hunks are split on `@@` markers; if a file has no `@@` and
/// is an Update, we still keep the body as a single hunk.

export type PatchOp = "update" | "add" | "delete";

export type PatchHunk = {
  /// Lines as they appear in the patch — prefix `+`, `-`, or ` `
  /// (space). The renderer strips the prefix and styles by kind.
  lines: Array<{ kind: "added" | "removed" | "context"; text: string }>;
};

export type PatchFile = {
  op: PatchOp;
  path: string;
  hunks: PatchHunk[];
};

export function parseApplyPatch(input: string): PatchFile[] {
  const files: PatchFile[] = [];
  let current: PatchFile | null = null;
  let currentHunk: PatchHunk | null = null;

  const lines = input.split("\n");
  for (const raw of lines) {
    if (raw.startsWith("*** Begin Patch") || raw.startsWith("*** End Patch")) {
      continue;
    }
    const op = parseFileHeader(raw);
    if (op) {
      current = { op: op.op, path: op.path, hunks: [] };
      files.push(current);
      currentHunk = null;
      continue;
    }
    if (!current) continue;
    if (raw.startsWith("@@")) {
      currentHunk = { lines: [] };
      current.hunks.push(currentHunk);
      continue;
    }
    if (!currentHunk) {
      currentHunk = { lines: [] };
      current.hunks.push(currentHunk);
    }
    if (raw.startsWith("+")) {
      currentHunk.lines.push({ kind: "added", text: raw.slice(1) });
    } else if (raw.startsWith("-")) {
      currentHunk.lines.push({ kind: "removed", text: raw.slice(1) });
    } else if (raw.startsWith(" ")) {
      currentHunk.lines.push({ kind: "context", text: raw.slice(1) });
    } else if (raw.length > 0) {
      // Bare content (Add File body, no leading prefix). Treat as add.
      currentHunk.lines.push({ kind: "added", text: raw });
    }
  }
  return files;
}

function parseFileHeader(line: string): { op: PatchOp; path: string } | null {
  const match = line.match(/^\*\*\* (Update|Add|Delete) File: (.+)$/);
  if (!match) return null;
  const op = match[1]!.toLowerCase() as PatchOp;
  return { op, path: match[2]!.trim() };
}
