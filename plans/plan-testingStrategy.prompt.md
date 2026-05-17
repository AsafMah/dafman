> **Stack note (post-Electrobun port, 2026-05-17):** This document still references the old Tauri (Rust) backend in places. The runtime is now Electrobun + Bun + TypeScript everywhere; src-tauri/ is gone, replaced by src-bun/. 	racing is replaced by `src-bun/app/logging.ts`, `cargo test`/`insta` are replaced by `bun test`/`toMatchSnapshot`, and Tauri's per-session `Channel<T>` is replaced by a single `sessionEvent` RPC message keyed by `sessionId`. The architecture in spirit (domain modules don't touch the shell, single typed IPC surface, JSON-RPC under the hood) is unchanged. Full diff lives in `CHANGELOG.md` under `## [Unreleased]`. Plan rewrites are tracked as follow-up tasks.
# Dafman — Testing Strategy
## Goals
- High confidence with minimal manual QA so we can ship daily.
- Fast feedback: most tests under a second; full suite under a couple of minutes locally.
- Cover the **boundaries**: SDK ↔ backend, backend ↔ frontend, frontend ↔ user, backend ↔ OS (keyring, browser opener, MCP processes).
## Test pyramid
```
┌──────────────────────────────┐
│ E2E (Playwright + tauri)     │  ~10 critical flows
├──────────────────────────────┤
│ Integration                  │  IPC contracts, command flows, MCP/OAuth, URL policy
├──────────────────────────────┤
│ Component / store tests      │  Vitest + @vue/test-utils
├──────────────────────────────┤
│ Unit                         │  Rust + TS — many, fast
└──────────────────────────────┘
```
## Backend (Rust)
### Unit tests
- Each module in `#[cfg(test)] mod tests`.
- Domain managers tested with fakes injected via traits (no real SDK).
- `mockall` for trait mocks where helpful.
- `insta` snapshots for:
  - Serialized event payloads (per-session channel).
  - Error payloads.
  - Permission policy decisions for sample inputs.
  - URL policy decisions for sample hosts.
  - System-prompt customization rendered outputs.
### Integration tests (`src-tauri/tests/`)
- Spin up `AppState` with **fake** `ClientManager`, `SessionManager`, `UrlOpener`, `McpRegistry` impls.
- Drive command handlers directly (using `tauri::test::mock_app()` where useful).
- Verify command outputs and emitted events match expected sequences.
- Specific scenarios:
  - send → assistant deltas → idle → final canonical message reaches a per-session Tauri channel.
  - permission request → emitted event → simulated user response → SDK gets correct `PermissionResult`.
  - URL elicitation → policy evaluates → opener called with right args OR ask-user flow emitted.
  - MCP OAuth → URL emitted → policy → opener → `mcp_status_changed` finalizes.
  - session.ui.confirm → inline request event → respond → SDK gets result.
### SDK fake
`tests/support/fake_sdk.rs` (feature-gated):
- `FakeClient` — never spawns a CLI; supports `create_session`/`resume_session`.
- `FakeSession` — exposes `subscribe()`, lets tests push events, captures `send` calls.
- Composed via the `ClientManager`/`SessionManager` traits so production code is untouched.
### Property tests
- `proptest` for:
  - Path confinement in `tools/fs`.
  - Permission rule matcher.
  - URL host-pattern matcher.
  - Settings schema migrations.
### Snapshot tests
- `insta` for JSON shape of every command response and every event the backend can emit. Guards the IPC contract end-to-end.
### Linting & types
- `cargo clippy -- -D warnings` in CI.
- `cargo fmt --check`.
- `cargo deny` for licenses + advisories.
## Frontend (TypeScript / Vue)
### Vitest unit tests
- Pure helpers in `lib/` (`color.ts`, `markdown.ts`, `keyboard.ts`).
- Pinia stores tested with mocked `ipc/invoke.ts` and `ipc/events.ts`:
  - `sessionsStore`: send → optimistic user message; deltas append; idle clears sending.
  - `permissionsStore`: queueing, decision flow.
  - `elicitationStore`: URL-mode card lifecycle.
  - `accountsStore`: add account triggers OAuth URL flow.
  - `settingsStore`: load → update → persist (mock IPC).
### Component tests (`@vue/test-utils`)
- `ChatPane.vue`: renders all message types, dispatches send, shows abort while sending, accent color from session id.
- `MessageBubble.vue`: renders markdown safely; copy action; image rendering.
- `ReasoningBlock.vue` / `ToolCallBlock.vue`: collapse/expand state.
- `InlineConfirm.vue` / `InlineSelect.vue` / `InlineInput.vue`: submit → emits with payload; validation.
- `UrlElicitationCard.vue`: shows host badge; click Open triggers `external.open_url`; "don''t ask again" persists.
- `PermissionPrompt.vue`: shows args + risk hints; emits decision.
- `SettingsDialog.vue`: nav + section rendering; URL policy editor + System Prompt editor.
### Visual / a11y
- Storybook (optional) for component states.
- `axe-core` integration in component tests for a11y regressions.
### Type checks
- `vue-tsc --noEmit` in CI.
## End-to-end (Playwright + Tauri)
Critical user journeys:
1. **First run**: empty state → create client → create session → send "hello" → see streaming reply.
2. **Multi-pane**: create 3 sessions → grid layout → each receives its own stream.
3. **Permission flow**: trigger fs.write → modal → deny → tool fails gracefully.
4. **Policy persistence**: choose "Always allow" → next call doesn''t prompt.
5. **URL elicitation**: simulated SDK URL-mode elicitation → card appears → Open → opener called.
6. **MCP OAuth**: install MCP server requiring OAuth → toast appears → Open → toast becomes Connected on `mcp_status_changed`.
7. **Settings**: change dark mode → reload → persists.
8. **Project**: open folder → new session in that project → restart → resume.
9. **Skill**: create a skill → invoke it → new session starts with system prompt + preloaded content applied.
10. **Automation**: schedule a one-shot 10 s out → assert notification fires.
11. **Abort**: long-running prompt → press Esc → status clears, no orphaned spinner.
12. **Disconnect**: close pane → backend reports session closed → no event leaks to other panes.
13. **Multi-account**: add second account → pin to session → assert SDK gets the right token.
14. **Image generation**: response_format = image → assistant returns image → bubble renders it.
### Tauri-specific
- Use `tauri-driver` (where available) or a Playwright + WebDriverIO bridge.
- For non-UI E2E (pure command flows), drive the binary via JSON over stdin/stdout for speed.
## Test data & fakes
- `tests/fixtures/` for canned `SessionEvent` sequences (`hello-world.json`, `tool-edit.json`, `permission-deny.json`, `url-elicitation.json`, `mcp-oauth.json`).
- Generators: `proptest` strategies for `MessageOptions`, permission rules, URL rules, settings.
## CI
- GitHub Actions matrix: `windows-latest`, `macos-latest`, `ubuntu-latest`.
- Jobs:
  - `lint` — `clippy`, `fmt`, `vue-tsc`, `eslint`.
  - `test-rust` — `cargo test --workspace`.
  - `test-frontend` — `vitest run`.
  - `build` — `npm run build`, `cargo build --release`.
  - `e2e` — only on `main` PRs; Playwright against `tauri build`.
- Cache cargo + node_modules per OS.
- Verify lockfile pins the Supercharged SDK SHA.
## Observability integration

Logging, tracing, metrics, and perf budgets are owned by plan-observability.prompt.md. Highlights enforced via tests:

- Snapshot assertions that `#[instrument]` spans on chat/permission/url paths never log secret fields (`insta` redaction).
- Property tests for the redaction helper.
- E2E asserts the Log Viewer can tail and filter live entries.
- `criterion` bench harness (ench_event_dispatch, ench_permission_eval, ench_url_policy_eval, ench_markdown_render) runs as an optional CI job; PRs show the diff.

## Performance & regression budgets
- **Cold start** (window visible): < 1.5 s on a midrange laptop.
- **Send → first delta**: dominated by SDK; track our own overhead — target < 50 ms added.
- **Memory per session**: < 30 MB steady-state.
- **Disk writes**: settings/save batched, no thrashing.
Tracked via:
- `bench/` harness (criterion for hot Rust paths).
- Lighthouse-style perf snapshot in Playwright (FCP, scripting time).
- Memory snapshots in a separate nightly job.
## Definition of "tested" per milestone
- M1: every new module has unit tests; one integration test per command; one E2E smoke test; URL policy + permission flow tested.
- M2: ChatPane has component coverage for all message types (including image, inline.*, url_elicitation); export round-trip test.
- M3: each tool has unit + integration; permission flow has E2E; URL policy editor tested.
- M4: project resume across restart E2E; multi-account pinning unit + E2E; idle timeout fires and notifies.
- M5: MCP OAuth E2E (with mocked status events); skill invocation E2E.
- M6: scheduled run + notification E2E.
- M7: Monaco viewer/diff component tests; headless browser tool integration.
## Conventions
- Tests live next to code (`#[cfg(test)]` in Rust; `*.test.ts` next to source in TS).
- One assertion concept per test; names describe behavior.
- No flaky test ships; quarantined tests are deleted within a week.
- Snapshots reviewed in PRs; updated via explicit script, never auto.


