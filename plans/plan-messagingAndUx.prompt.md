# Dafman — Messaging & UX

## Chat surface

### Layout (per pane)

- **Header**: accent stripe, session label, model badge, "thinking" indicator, kebab menu (export, settings, close).
- **Quick controls row** (collapsible): model picker, mode (chat / autopilot), tools allow-list quick toggle.
- **Message list** (scrollable): mixed stream of user, assistant, reasoning, tool call, system events.
- **Composer**: text area with auto-grow, attachment chips, mode hint, send / abort button, slash-command hint.

### Message types & rendering

| Type | Role | Default display | Toggle states |
|---|---|---|---|
| `user` | left/right per layout choice | plain markdown bubble | n/a |
| `assistant` | accent bubble | markdown with code blocks | n/a |
| `reasoning` | secondary bubble with `pi-bolt` icon | collapsed summary line | hidden / collapsed / expanded |
| `tool_call` | dedicated card | "Ran tool X — succeeded" with chevron | hidden / collapsed / expanded |
| `system` | callout | one-liner, dismissable | n/a |
| `error` | red callout | message + details on expand | n/a |
| `usage_info` | tiny footer pill | token totals | always shown / hidden |

### Reasoning visibility

- Per-message: chevron to expand/collapse.
- Per-session: header dropdown — "Reasoning: hidden / compact / full".
- Global default in Settings → Appearance → "Default reasoning visibility".

### Tool call rendering

- A tool call is one card with three lifecycle states:
    - **Pending** — spinner + name + arguments preview.
    - **Permission requested** — prompt embedded inline or surfaced as modal (see Permissions).
    - **Complete** — status icon + result preview (truncated with "Show all").
- Special renderers per tool:
    - `fs.read` → file path + first N lines.
    - `fs.write` / `fs.edit` → diff viewer (Monaco) with accept/reject buttons (when in dry-run mode).
    - `shell` → command, exit code, stdout/stderr split panels.
    - `http` → method + URL + status + body (formatted JSON if applicable).
    - `search` → matches grouped by file.

### Streaming behavior

- Assistant deltas append into the active bubble identified by `messageId`.
- `assistant.message` event replaces text with canonical content (no more flicker).
- `session.idle` ends the "thinking" indicator.
- `session.error` shows an inline error card.
- Auto-scroll only if the user is already pinned to the bottom (don't yank them away).

## Composer

- Multi-line, auto-grow up to ~10 lines, scroll after.
- Slash commands suggest as the user types `/`.
- Drag-and-drop files to attach.
- Send on `Cmd/Ctrl+Enter`. `Shift+Enter` inserts a newline.
- "Abort" replaces "Send" while a turn is in flight.
- Mode chip (chat / autopilot / immediate) — affects `MessageOptions.mode`.

## Message actions

Hover/keyboard-revealed actions on each bubble:

- Copy text (markdown source).
- Copy as plain text.
- Retry (replays the same user message).
- Edit & resend (user messages only).
- Delete locally (UI only; doesn't rewrite session state).
- Pin to "Notes" sidebar (M2.1+).

## Niceties

- **Export**: whole conversation → Markdown / JSON / printable HTML.
- **Share**: copy permalink (when persistence exists).
- **Snapshots**: save the current session as a Skill template.
- **Time travel** (M4+): rewind to an earlier event using SDK `session.snapshot_rewind`.

## Per-session settings panel

Reachable via header kebab → "Session settings".

- Model.
- System prompt (multi-line, save-as-skill button).
- Tools allow-list (toggle list, group by source: built-in / MCP / skill).
- Mode (chat / autopilot).
- Streaming on/off.
- Elicitation on/off.
- Reasoning visibility default.
- Session-level permission policy override.

## Global settings UI

Settings dialog with left-nav sections (see architecture):

- **General** — startup behavior, restore on launch, default project.
- **Appearance** — theme, accent strategy, density, font, reasoning visibility, message density.
- **Models** — provider config, BYOK (per `ProviderConfig`), default model.
- **Tools** — toggle built-ins, configure timeouts, default policies per tool.
- **Permissions** — policy editor (rules, presets, scope).
- **MCP** — list, install, configure, status, logs.
- **Skills** — manage library.
- **Automations** — list, enable/disable, schedule editor.
- **Notifications** — quiet hours, channels.
- **Privacy & Telemetry** — OTel opt-in, log redaction.
- **Advanced** — paths, override CLI path, embedded CLI info.

## Keyboard shortcuts (initial)

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
- Focus rings visible.
- Color is never the only signal (icons + text for status).
- Min contrast 4.5:1 for text; tested via Playwright + axe.

## Empty & error states

- No client: card with "Start client" CTA and explanation.
- No sessions: card with "Open project" / "New session".
- Permission denied: explanatory toast with "Change policy…" link.
- Network/SDK transport failure: banner with "Reconnect" action.