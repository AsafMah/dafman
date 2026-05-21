# Security Review — 2026-05-21

Scope: recent dafman commits introducing `@file` mentions + attachments,
slash-command typeahead, and the chat-event coalescing perf fix.

Commits reviewed: `74964a1`, `b72eeb4`, `db53986`, `8832df6`, `8c1d386`,
`a7610d3`.

## Result

**No high-confidence vulnerabilities found.** All new code paths
exercised by the audit either rely on Vue's auto-escaping
`{{ }}` template interpolation (no `v-html` / `innerHTML` sinks in the
new components) or pass through the existing DOMPurify pipeline in
`src/lib/markdown.ts` for assistant-rendered markdown.

## Surfaces examined

### Bun side

- **`src-bun/app/fileSearch.ts`** — workspace file indexer.
  - Uses `fs.readdir({ withFileTypes: true })`; `Dirent.isDirectory()` is
    lstat-based, so symlinks return `false` for both `isDirectory()` and
    `isFile()` and are skipped. No traversal outside cwd, no
    symlink-cycle following.
  - Depth (`MAX_DEPTH = 12`) and file-count (`MAX_FILES_PER_WORKSPACE = 20_000`)
    caps bound any pathological tree.
  - Ignored-directory list (`node_modules`, `.git`, …) is a UX nicety,
    not a security boundary.

- **`src-bun/app/sessions.ts → send()`** — now accepts attachments from
  the renderer.
  - Forwards the renderer-supplied `attachment.path` straight to the
    SDK without verifying it lies within the session cwd. **This is a
    defense-in-depth gap**, not an exploitable bug today: the only
    exploitation path requires a compromised renderer, and the
    chat-stream → DOM pipeline uses DOMPurify + Vue auto-escaping with
    no XSS sinks in the new code. Without a concrete attack chain it
    stays below the >80% confidence bar for a finding.
  - **Recommendation (deferred):** add a path-prefix check vs the
    session's resolved cwd, treating mismatches as a soft error
    (toast + drop the attachment).

- **`src-bun/rpc.ts → searchWorkspaceFiles` + `sendMessage`** — RPC
  handlers.
  - `limit` defaults to 40 and is naturally bounded by the index cap.
  - `sessionId` is looked up via `entries.get`, so unknown sessions
    return `[]` (search) or throw `sessionNotFound` (send).
  - `query` is used only as a lowercase substring match — no shell /
    SQL / regex sink.

### Renderer side

- **`src/components/MentionPlugin.vue`**, **`SlashCommandPlugin.vue`**,
  **`AttachmentStrip.vue`** — all menu / chip rendering uses Vue's
  `{{ }}` interpolation only. No `v-html`, no `innerHTML` writes.
  Crafted filenames / command descriptions / displayNames cannot XSS.

- **`src/components/MessageComposer.vue`** — drag-and-drop + paste
  handlers convert File objects to base64 blob attachments via
  ArrayBuffer + chunked `String.fromCharCode`.
  - **8 MiB cap** enforced *before* base64 encoding, so the worst-case
    intermediate buffer is bounded.
  - MIME type is treated as opaque metadata for the LLM, not used for
    any local content-type decisions / dispatching.

- **`src/lib/sessionCommands.ts`** — slash commands execute locally
  via store actions.
  - `/cwd` passes `record.workingDirectory` to `revealPath` → which
    calls `Utils.showItemInFolder`. The `workingDirectory` is set
    only at session-creation time via the user's folder-picker or
    topbar entry — no attacker-controlled input flows here.
  - Other commands (`/compact`, `/fork`, `/rename`, `/close`) operate
    on session IDs and do not take user-supplied paths.

- **`openUrl` RPC** — unchanged, retains the existing `^https?://`
  allowlist.

## Pipeline-wide invariants (re-verified)

- DOMPurify allowlist in `src/lib/markdown.ts` covers every tag /
  attribute the markdown-it renderer emits, plus the inline-HTML
  tags we whitelisted (details, summary, dl, dt, dd, kbd, sub, sup,
  mark). `<script>`, `<style>`, event handlers, `javascript:` URLs,
  and the `style` attribute (CSS-injection vector) are all stripped
  / tightened. KaTeX inline-size styles pass via a `style` allowlist
  hook that limits to known safe properties.
- `target="_blank"` + `rel="noopener noreferrer"` is applied to every
  rendered link.
- Renderer code runs in WebView2 loading local-only HTML/JS; there
  is no remote attacker surface unless an SDK event / MCP tool
  result injects content into the chat. That content path is
  DOMPurify-gated.

## Recommendation

Add a session-cwd path-prefix validator on the `send()`
attachment forwarder as a defense-in-depth measure. Not blocking;
tracked in the open agenda.
