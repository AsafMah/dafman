> **Stack note (post-Electrobun port, 2026-05-17):** This document still references the old Tauri (Rust) backend in places. The runtime is now Electrobun + Bun + TypeScript everywhere; src-tauri/ is gone, replaced by src-bun/. 	racing is replaced by `src-bun/app/logging.ts`, `cargo test`/`insta` are replaced by `bun test`/`toMatchSnapshot`, and Tauri's per-session `Channel<T>` is replaced by a single `sessionEvent` RPC message keyed by `sessionId`. The architecture in spirit (domain modules don't touch the shell, single typed IPC surface, JSON-RPC under the hood) is unchanged. Full diff lives in `CHANGELOG.md` under `## [Unreleased]`. Plan rewrites are tracked as follow-up tasks.
# Dafman — Observability: Logging, Tracing, Metrics, Performance
The app spawns subprocesses (CLI, MCP servers), routes user data through streaming pipelines, and runs privileged tools. We need *observable* by default: when something is slow, broken, or suspicious, we can answer **what**, **when**, **where**, and **why** from logs and traces alone.
## Goals
1. **Structured everything.** Logs are key=value, not free-form strings. Spans correlate across boundaries.
2. **Privacy first.** No prompts, secrets, tokens, or arguments containing PII leave the user''s machine unless they opt in.
3. **Cheap when off.** Telemetry export is opt-in; on-disk logs default to a useful-but-bounded level.
4. **User-visible.** A built-in Log Viewer + Activity feed makes the same data debuggable without leaving the app.
5. **Budgets, not opinions.** Every milestone has explicit perf budgets and a way to enforce them in CI.
## Backend logging — `tracing` (+ `tracing-subscriber`)
### Subscriber composition
`logging.rs` builds a layered subscriber:
- **Filter** — `EnvFilter` driven by `DAFMAN_LOG` env + a runtime-modifiable handle for in-app level changes (Settings → Diagnostics).
  - Default: `info` global, `dafman=debug`, `github_copilot_sdk=info`, `hyper=warn`, `mio=warn`.
- **fmt layer** (file) — newline-delimited JSON, written to `<app-data>/dafman/logs/dafman.YYYY-MM-DD.log`, rotated daily, max 14 files (`tracing-appender::rolling`).
- **fmt layer** (stderr) — compact human-readable when `RUST_LOG`/`DAFMAN_LOG` enables it OR when running under `tauri dev`.
- **tracing-error** layer — captures spantraces in `AppError` for richer crash dumps.
- **OTLP layer** (optional, M4+) — wraps `opentelemetry-otlp`; gated behind Settings → Privacy.
### Span model
Every interesting flow opens a span; child operations inherit context.
| Span | Fields | When |
|---|---|---|
| `client.start` | `client_id` | CLI process start |
| `session.create` | `session_id`, `project_id?`, `account_id?`, `model?` | New session |
| `session.send` | `session_id`, `message_id`, `mode?`, `bytes` | User → agent |
| `session.event_loop` | `session_id` | Long-lived per-session task |
| `assistant.message` | `session_id`, `message_id`, `phase?` | One assistant turn |
| `tool.call` | `session_id`, `tool_name`, `tool_call_id`, `mcp?` | Tool invocation |
| `permission.request` | `ticket_id`, `policy_source` | Each request |
| `url.open` | `origin`, `host`, `scheme`, `policy_source` | URL opens |
| `mcp.start` / `mcp.oauth` | `server_id`, `kind` | MCP lifecycle |
| `ipc.command` | `name`, `request_id` | Each Tauri command |
Use `#[instrument(skip(state, …))]` on async fns so we never accidentally log `AppState` or secrets.
### Redaction
- Sensitive fields (prompts, attachments, tool arguments) recorded as **shape only** by default: `len`, `sha256-prefix(8)`, `mime`.
- Full content gated by `DAFMAN_LOG_RAW=1` (devs only) and never enabled by the OTel exporter.
- Keyring values, OAuth tokens, BYOK credentials: never logged. `AccountStore` and `Settings` impls have `Debug` implementations that print `***`.
### Correlation
- `Session::send` returns a `MessageId`; we set it as a `tracing` field on the span and propagate via `parent_id` in events.
- IPC commands tag with a `request_id` produced by the frontend and echoed back so a UI bug can be paired with backend logs.
## Distributed tracing
- W3C Trace Context — the SDK already supports a `TraceContextProvider`; we install one that surfaces our `session.send` span as the parent for downstream RPCs.
- Sub-agent activity (Fleet) inherits the parent span (`agent_id` becomes a span field).
- OTLP exporter (when enabled): forwards spans + logs to the user-configured endpoint. The Copilot CLI''s own OTel pipeline is wired through `ClientOptions.telemetry`.
## Frontend logging
- Small wrapper at `src/lib/logger.ts` with levels: `trace | debug | info | warn | error`.
- Default sink: `console` with structured payloads.
- Optional sink: forward `error`/`warn` to backend via `diagnostics.log_event` command so the Log Viewer aggregates both sides.
- Pinia store actions are auto-wrapped to emit `info`-level events around IPC calls (start, success, error, duration).
## Audit log (separate from diagnostics)
`<app-data>/dafman/audit/`:
- `permissions.log` — every permission decision (ticket, source, tool, scope, decision).
- `urls.log` — every URL open request (host, origin, policy decision, opened).
- `accounts.log` — add/remove/pin events.
Append-only JSONL, never auto-deleted (separate from diagnostic logs). Visible in Settings → Permissions → Activity and Settings → URL Policy → Activity, with export to CSV/JSON.
## Metrics
Lightweight counters and histograms, exposed two ways:
- **In-app** — `Settings → Diagnostics → Metrics` shows a snapshot view (and live for sessions).
- **OTel metrics** (when enabled) — exported with the same OTLP pipeline as traces.
| Metric | Type | Tags |
|---|---|---|
| `session.active` | gauge | — |
| `session.created_total` | counter | — |
| `session.ended_total` | counter | `reason=user|idle|error` |
| `message.send_latency_ms` | histogram | `model`, `mode` |
| `message.delta_to_idle_ms` | histogram | `model` |
| `tool.call_total` | counter | `tool` |
| `tool.call_latency_ms` | histogram | `tool`, `outcome` |
| `permission.decision_total` | counter | `decision`, `source` |
| `url.open_total` | counter | `decision`, `host_class` |
| `ipc.command_latency_ms` | histogram | `name`, `outcome` |
| `process.memory_bytes` | gauge | — |
| `cli.restart_total` | counter | — |
## Performance
### Budgets
Tracked per milestone in `plan-testingStrategy.prompt.md`. Numerics restated for visibility:
| What | Budget | Mechanism |
|---|---|---|
| Cold start (window visible) | < 1.5 s | Playwright nav + perf timeline |
| Frontend FCP | < 800 ms | Lighthouse audit |
| `session.send` overhead (our code only) | < 50 ms p95 | Histogram + criterion micro-bench |
| First delta after send | within 10 ms of arrival from SDK | criterion + integration test |
| Memory per active session | < 30 MB steady | nightly memory snapshot |
| Settings flush | batched ≤ 1/s | unit + integration |
| Idle CPU (no sessions) | < 1% on a midrange laptop | manual + bench harness |
### Profiling tooling
- Rust: `cargo flamegraph` (Linux/Mac) or `Superluminal`/`Tracy` (Windows); `tokio-console` for async stalls.
- Frontend: Vue DevTools timeline, Chromium devtools perf trace via Tauri webview, Playwright''s `trace.zip`.
### Hot paths to keep cheap
- Per-session event loop (called for every delta).
- IPC serialization for `assistant.message_delta`.
- Pinia state updates for streaming bubbles (`shallowRef` for high-frequency text concat).
- Markdown rendering — debounced 16 ms during streaming; full re-parse on `assistant.message` final.
### Benchmarks (`src-tauri/benches/`)
Use `criterion`:
- `bench_event_dispatch` — N deltas → per-session channel emit.
- `bench_permission_eval` — large rule set vs sample inputs.
- `bench_url_policy_eval` — host-pattern matcher.
- `bench_markdown_render` — small/medium/large content.
CI runs them in a separate optional job; failure threshold is configurable but **not** an automatic gate (perf regressions discussed in PR with the bench diff posted).
## In-app Log Viewer (Settings → Diagnostics)
- Live tail of the JSON log with level filter and search.
- Span explorer: hierarchical view of recent flows (e.g. drill into one `session.send` and see all child spans).
- "Export diagnostics bundle" button: zips current logs + settings (redacted) + last 50 events per active session into a single archive a user can attach to a bug report.
## Privacy & telemetry controls
- All export is opt-in; Settings → Privacy:
  - **Diagnostic logs** — on (file only) by default; can be turned to console-only or off.
  - **OTel exporter** — off by default; endpoint configurable (OTLP HTTP/gRPC).
  - **Audit log** — always on (local only); cannot be exported by accident.
  - **Crash reports** — opt-in (M3+); uses sentry-like local-first crash dumps with optional upload.
- A persistent banner appears whenever any exporter is enabled.
## Definition of done per milestone
- **M1** — `tracing` subscriber wired with file + dev-stderr; `EnvFilter` runtime handle; Log Viewer (basic tail); redaction defaults enabled; first criterion bench (`bench_event_dispatch`).
- **M2** — `instrument` on all chat-related fns; metrics counters + histograms exposed in Settings; perf snapshot in Playwright.
- **M3** — full URL/permission audit logs; metric histograms wired to dashboard; `bench_permission_eval`/`bench_url_policy_eval`.
- **M4** — multi-account safe redaction tests; OTLP exporter optional toggle wired through Settings → Privacy.
- **M5** — sub-agent + MCP span propagation; per-MCP-server metrics.
- **M6** — automation runs emit audit + metric events; quiet hours respect.
- **M7** — diagnostics bundle export; tokio-console feature flag; full perf dashboard.

