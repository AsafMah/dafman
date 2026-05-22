// Per-tool rendering registry.
//
// Each entry decides:
//   - `summary(args, result?)`: short one-liner shown next to the tool
//     name in the collapsed `ToolCallBlock` header. Used to give the
//     transcript skim-readability (e.g. `shell ls -la` rather than just
//     "shell · Running"). Falls back to the existing first-line-of-
//     output preview when no renderer matches.
//   - `argsLanguage`: language tag the expanded view should use when
//     showing the tool's arguments. Drives Lexical's prism highlighter
//     via fenced-code-block markdown.
//   - `resultLanguage(args, result)`: same for the result block.
//     Function form so renderers can sniff e.g. file extension from
//     `args.file_path` when emitting `read_file` output.
//
// Unknown tools / MCP tools without an explicit renderer fall through
// to a safe default: JSON args, plain-text result.

interface ToolRenderResult {
  summary?: string;
  /// Language identifier for the **arguments** code block — must match
  /// a prismjs grammar name. Use "text" for plain text fallback.
  argsLanguage: string;
  /// Language identifier for the **result/output** code block. Can
  /// depend on args (e.g. read_file infers from extension).
  resultLanguage: string;
}

interface ToolRendererArgs {
  args?: Record<string, unknown>;
  result?: string;
  partialOutput?: string;
  toolName: string;
  mcpServerName?: string;
  mcpToolName?: string;
}

export type ToolRenderer = (input: ToolRendererArgs) => ToolRenderResult;

/// Extract a string field from `args` with safe fallback. Returns ""
/// if the field is missing or not a string.
function s(
  args: Record<string, unknown> | undefined,
  ...keys: string[]
): string {
  if (!args) return "";
  for (const key of keys) {
    const value = args[key];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return "";
}

/// Truncate a single-line preview so it fits in a header row. The
/// 160-char cap matches `ToolCallBlock.previewLine`'s historical
/// behaviour so the look-and-feel doesn't jump when summaries arrive.
function clip(value: string, max = 160): string {
  if (!value) return "";
  const oneLine = value.replace(/\s*\n+\s*/g, " ").trim();
  return oneLine.length > max ? `${oneLine.slice(0, max)}…` : oneLine;
}

/// Infer prism language from a filename / extension. Returns "text"
/// for anything not in the explicit map (prism's grammars are
/// case-sensitive ids; @lexical/code maps friendly names → grammars).
function languageForFile(path: string): string {
  if (!path) return "text";
  const dot = path.lastIndexOf(".");
  if (dot === -1) return "text";
  const ext = path.slice(dot + 1).toLowerCase();
  // Keep this map intentionally short — prismjs loads grammars on
  // demand via @lexical/code's lazy loader, but only for the ones it
  // actually knows about. Unknown langs render as plain `text`.
  const map: Record<string, string> = {
    ts: "typescript",
    tsx: "typescript",
    js: "javascript",
    jsx: "javascript",
    mjs: "javascript",
    cjs: "javascript",
    vue: "markup", // closest fit; vue SFC syntax isn't first-class
    json: "json",
    md: "markdown",
    markdown: "markdown",
    sh: "bash",
    bash: "bash",
    zsh: "bash",
    ps1: "powershell",
    py: "python",
    rs: "rust",
    go: "go",
    java: "java",
    c: "c",
    h: "c",
    cpp: "cpp",
    cc: "cpp",
    hpp: "cpp",
    cs: "csharp",
    css: "css",
    html: "markup",
    htm: "markup",
    xml: "markup",
    yml: "yaml",
    yaml: "yaml",
    toml: "toml",
    sql: "sql",
    rb: "ruby",
    php: "php",
    swift: "swift",
    kt: "kotlin",
  };
  return map[ext] ?? "text";
}

// -------- per-tool renderers --------

const shellRenderer: ToolRenderer = ({ args }) => {
  const command = s(args, "command", "cmd", "script");
  return {
    summary: command ? clip(command) : undefined,
    argsLanguage: "bash",
    resultLanguage: "text",
  };
};

const readFileRenderer: ToolRenderer = ({ args }) => {
  const path = s(args, "file_path", "path", "filePath", "filename");
  return {
    summary: path ? clip(path) : undefined,
    argsLanguage: "json",
    resultLanguage: languageForFile(path),
  };
};

const writeFileRenderer: ToolRenderer = ({ args }) => {
  const path = s(args, "file_path", "path", "filePath", "filename");
  return {
    summary: path ? `write ${clip(path)}` : undefined,
    argsLanguage: "json",
    resultLanguage: languageForFile(path),
  };
};

const editRenderer: ToolRenderer = ({ args }) => {
  const path = s(args, "file_path", "path", "filePath", "filename");
  const oldStr = s(args, "old_str", "search");
  return {
    summary: path
      ? `edit ${clip(path)}${oldStr ? `  · ${clip(oldStr, 60)}` : ""}`
      : undefined,
    argsLanguage: "json",
    resultLanguage: "diff",
  };
};

const applyPatchRenderer: ToolRenderer = ({ args }) => {
  const patch = s(args, "patch", "diff");
  const fileMatch = patch.match(/^\*\*\* (?:Update|Add|Delete) File: (.+)$/m);
  const path = fileMatch?.[1] ?? "";
  return {
    summary: path ? `patch ${clip(path)}` : "apply patch",
    argsLanguage: "diff",
    resultLanguage: "diff",
  };
};

const grepRenderer: ToolRenderer = ({ args }) => {
  const pattern = s(args, "pattern", "query", "regex");
  const path = s(args, "path", "paths", "directory");
  return {
    summary: pattern
      ? `grep "${clip(pattern, 60)}"${path ? ` in ${clip(path, 50)}` : ""}`
      : undefined,
    argsLanguage: "json",
    resultLanguage: "text",
  };
};

const globRenderer: ToolRenderer = ({ args }) => {
  const pattern = s(args, "pattern", "glob");
  return {
    summary: pattern ? `glob ${clip(pattern)}` : undefined,
    argsLanguage: "json",
    resultLanguage: "text",
  };
};

const viewRenderer: ToolRenderer = ({ args }) => {
  const path = s(args, "path", "file_path", "filePath");
  const range = args?.view_range;
  let rangeStr = "";
  if (Array.isArray(range) && range.length === 2) {
    rangeStr = ` [${range[0]}–${range[1]}]`;
  }
  return {
    summary: path ? `view ${clip(path)}${rangeStr}` : undefined,
    argsLanguage: "json",
    resultLanguage: languageForFile(path),
  };
};

const fetchRenderer: ToolRenderer = ({ args }) => {
  const url = s(args, "url");
  return {
    summary: url ? clip(url) : undefined,
    argsLanguage: "json",
    resultLanguage: "markdown",
  };
};

const todoRenderer: ToolRenderer = ({ args }) => {
  const todos = args?.todos;
  if (Array.isArray(todos)) {
    return {
      summary: `${todos.length} todo${todos.length === 1 ? "" : "s"}`,
      argsLanguage: "json",
      resultLanguage: "json",
    };
  }
  return { argsLanguage: "json", resultLanguage: "json" };
};

const RENDERERS: Record<string, ToolRenderer> = {
  // Names follow the upstream CLI's tool registry. Aliases listed
  // together where the same logical tool ships under multiple names.
  shell: shellRenderer,
  bash: shellRenderer,
  execute: shellRenderer,

  read: readFileRenderer,
  read_file: readFileRenderer,
  readFile: readFileRenderer,

  write: writeFileRenderer,
  write_file: writeFileRenderer,
  writeFile: writeFileRenderer,
  create: writeFileRenderer,

  edit: editRenderer,
  str_replace_editor: editRenderer,
  str_replace: editRenderer,

  apply_patch: applyPatchRenderer,
  applyPatch: applyPatchRenderer,
  patch: applyPatchRenderer,

  grep: grepRenderer,
  search: grepRenderer,

  glob: globRenderer,

  view: viewRenderer,

  fetch: fetchRenderer,
  web_fetch: fetchRenderer,
  webFetch: fetchRenderer,

  todo_write: todoRenderer,
  todoWrite: todoRenderer,
  todos: todoRenderer,
};

/// Returns the renderer for a given tool. MCP-hosted tools (which
/// carry a `mcpServerName`) currently use the default renderer — the
/// MCP tool name is opaque to us. Future: allow registering per-MCP
/// renderers (e.g. for the standard playwright / github MCP servers).
export function getToolRenderer(
  toolName: string,
  mcpServerName?: string,
): ToolRenderer {
  if (mcpServerName) {
    // Default renderer for MCP tools — args are JSON, result depends
    // on the tool itself; assume markdown for richer MCP outputs.
    return ({ args: _a }) => ({ argsLanguage: "json", resultLanguage: "markdown" });
  }
  const renderer = RENDERERS[toolName];
  if (renderer) return renderer;
  return () => ({ argsLanguage: "json", resultLanguage: "text" });
}
