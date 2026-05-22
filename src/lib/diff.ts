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

type PatchOp = "update" | "add" | "delete";

type PatchHunk = {
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
