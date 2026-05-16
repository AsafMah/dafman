# Dafman — Messaging & UX
## Chat surface
### Layout (per pane)
- **Header**: accent stripe, session label, model badge, account badge, "thinking" indicator, kebab menu (export, settings, close).
- **Quick controls row** (collapsible): model picker (with capability overrides), mode (chat / autopilot), tools allow-list quick toggle, response format (text / image / mixed).
- **Message list** (scrollable): mixed stream of user, assistant, reasoning, tool call, system, elicitation, image events.
- **Composer**: text area with auto-grow, attachment chips, mode hint, send / abort button, slash-command hint, "Advanced" panel for headers / response format.
### Message types & rendering
| Type | Role | Default display | Toggle states |
|---|---|---|---|
| `user` | left | plain markdown bubble | n/a |
| `assistant` | right | markdown with code blocks; accent bubble | n/a |
| `reasoning` | secondary bubble with `pi-bolt` icon | collapsed summary line | hidden / collapsed / expanded |
| `tool_call` | dedicated card | "Ran tool X — succeeded" with chevron | hidden / collapsed / expanded |
| `image` (assistant-generated) | embedded image | full image with zoom; click to open | n/a |
| `inline_confirm` (`session.ui.confirm`) | inline card | message + Yes/No/Cancel | n/a (one-shot) |
| `inline_select` (`session.ui.select`) | inline card | message + radio/checkbox list + Submit | n/a |
| `inline_input` (`session.ui.input`) | inline card | message + typed input with format hint + Submit | n/a |
| `url_elicitation` (URL-mode) | inline card | URL preview + Open / Copy / Cancel | n/a |
| `system` | callout | one-liner, dismissable | n/a |
| `error` | red callout | message + details on expand | n/a |
| `usage_info` | tiny footer pill | token totals | always shown / hidden |
### Reasoning visibility
- Per-message: chevron to expand/collapse.
- Per-session: header dropdown — "Reasoning: hidden / compact / full".
- Global default in Settings → Appearance.
### Tool call rendering
- Lifecycle states: Pending → Permission requested → Running → Complete.
- Special renderers per tool:
  - `fs.read` → file path + first N lines.
  - `fs.write` / `fs.edit` → diff viewer (Monaco) with accept/reject when in dry-run.
  - `shell` → command, exit code, stdout/stderr split panels.
  - `http` → method + URL + status + body (formatted JSON if applicable).
  - `search` → matches grouped by file.
### Inline session.ui rendering
- `confirm` — card with message + Yes (primary) / No / Cancel. Submitting calls `session.ui_respond`.
- `select` — card with message + `SelectButton`/`Listbox` for single, `MultiSelect` for multi.
- `input` — card with `InputText`/`InputMask`/`Password` depending on `InputFormat`. Validates per `min_length`/`max_length`.
### URL elicitation rendering
- Inline card with:
  - Title "Open a link in your browser?"
  - Source label (which agent / MCP server) and reason (if provided).
  - Visible URL (monospace) and host badge with risk indicator (Allow / Ask / Deny per current policy).
  - Actions: Open · Open and don''t ask again for this host · Copy URL · Cancel.
- Opening goes through `external.open_url`; result event marks the card resolved.
### Image messages
- Detected via response format / content type.
- Rendered with PrimeVue `Image` for zoom; right-click → Save As.
- Multi-image responses become a row of thumbnails; click to enlarge.
### Streaming behavior
- Assistant deltas append into the active bubble identified by `messageId`.
- `assistant.message` event replaces text with canonical content (no flicker).
- `session.idle` ends the "thinking" indicator.
- `session.error` shows an inline error card.
- Auto-scroll only if the user is already pinned to the bottom.
## Composer
- Multi-line, auto-grow up to ~10 lines, scroll after.
- Slash commands suggest as the user types `/` (uses registered SDK `CommandDefinition`s plus skills).
- Drag-and-drop files to attach.
- Send on `Cmd/Ctrl+Enter`. `Shift+Enter` inserts a newline.
- "Abort" replaces "Send" while a turn is in flight.
- Mode chip (chat / autopilot / immediate) affects `MessageOptions.mode`.
- Advanced panel (chevron): custom request headers, response format, attachments preview.

### Message queue & steering (backlog)
- While a turn is in flight, additional sends are queued (not blocked). Queued messages display as a stack above the composer with per-item status (`pending` / `sending` / `delivered`).
- Users can reorder (drag), edit, or cancel any `pending` item before it leaves the queue.
- "Steer" affordance: inject a short context note into the live turn without ending it (maps to whatever the SDK exposes for mid-turn input; alternative: cancel-and-resend with prepended context).
- Backend pipeline mirrors SDK `pending_messages.modified` so the queue UI stays in sync if the SDK reorders or coalesces messages.
- Surface design open: drawer below composer vs. inline chips. Needs UX sketch before implementation.

### Attachments (backlog)
- Drag-and-drop and paste-from-clipboard for files (any) and images (rendered as previews).
- Per-attachment chip with filename, size, remove button; click to open.
- Backend `attachments` module hands paths/bytes to the SDK''s message-options surface.
- Image attachments included in the next user message; non-image files referenced by path (for tool consumption).
- Per-format previews: image thumbnail, code snippet for text files, generic file icon otherwise.
## Message actions
Hover/keyboard-revealed actions on each bubble:
- Copy text (markdown source).
- Copy as plain text.
- Retry (replays the same user message).
- Edit & resend (user messages only).
- Delete locally (UI only; doesn''t rewrite session state).
- Pin to "Notes" sidebar (M2.1+).
- For images: Save As, Copy image.

## Markdown rendering (backlog)
- Assistant + reasoning content rendered as markdown (currently `pre-wrap` plain text).
- Code fences with syntax highlight; copy-code button per block.
- Sanitization mandatory — assistant output is untrusted (no raw HTML, no inline scripts).
- Library candidates: `marked` + `highlight.js`, or `markdown-it` + `shiki`. Bundle-size and CSP implications need a measurement pass.
- Links route through the URL policy (see `plan-sdkAndExternalSurfaces.prompt.md` "Browser & external URLs").
## Niceties
- **Export**: whole conversation → Markdown / JSON / printable HTML; image assets included.
- **Snapshots**: save the current session as a Skill template.
- **Time travel** (M4+): rewind to an earlier event using SDK `session.snapshot_rewind`.
## Per-session settings panel
Reachable via header kebab → "Session settings".
- Model + capability overrides (deep-merged).
- System prompt mode + content (`append` / `replace` / `customize` ten sections).
- Tools allow-list (toggle list, group by source: built-in / MCP / skill).
- `excludedTools` overlay for this session.
- Mode (chat / autopilot).
- Streaming on/off.
- Elicitation on/off.
- Reasoning visibility default.
- Session-level permission policy override.
- Account pin (which GitHub account to use).
- Idle timeout override.
## Global settings UI
Settings dialog with left-nav sections:
- **General** — startup behavior, restore on launch, default project.
- **Appearance** — theme, accent strategy, density, font, reasoning visibility, message density.
- **Models** — provider config, BYOK (per `ProviderConfig`), default model, capability overrides per model.
- **Tools** — toggle built-ins, configure timeouts, default policies per tool.
- **Permissions** — policy editor (rules, presets, scope).
- **URL Policy** — host/scheme rule editor for URL opens.
- **System Prompt** — defaults + per-section presets editor.
- **Accounts** — list GitHub accounts; add via OAuth (uses URL elicitation flow); set default.
- **MCP** — list, install, configure (stdio/HTTP), status, logs.
- **Skills** — manage library.
- **Automations** — list, enable/disable, schedule editor.
- **Notifications** — quiet hours, channels.
- **Privacy & Telemetry** — OTel opt-in, log redaction.
- **Advanced** — paths, override CLI path, embedded CLI info, idle timeout default.
## Keyboard shortcuts
| Combo | Action |
|---|---|
| `Cmd/Ctrl+Enter` | Send |
| `Esc` | Abort in-flight turn |
| `Cmd/Ctrl+K` | Command palette |
| `Cmd/Ctrl+N` | New session |
| `Cmd/Ctrl+W` | Close active pane |
| `Cmd/Ctrl+,` | Open settings |
| `Cmd/Ctrl+Shift+P` | Open project |
| `Cmd/Ctrl+/` | Toggle reasoning visibility |
| `Cmd/Ctrl+]` / `[` | Next / previous pane |
## Accessibility
- Every interactive element has an `aria-label`.
- Focus rings visible; URL elicitation cards announce host + risk to screen readers.
- Color is never the only signal (icons + text for status).
- Min contrast 4.5:1; tested via Playwright + axe.
## Empty & error states
- No client: card with "Start client" CTA and explanation.
- No sessions: card with "Open project" / "New session".
- Permission denied: explanatory toast with "Change policy…" link.
- URL blocked: toast with "Open URL Policy…" link.
- Network/SDK transport failure: banner with "Reconnect" action.
