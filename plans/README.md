# `plans/` — what to read

Two live files. One archive. Read in this order:

1. **[`DONE.md`](DONE.md)** — every capability Dafman ships today, by topic.
2. **[`TODO.md`](TODO.md)** — every open feature, gap, and known piece of
   tech debt, by topic, ranked within each topic.
3. **[`../ARCHITECTURE.md`](../ARCHITECTURE.md)** — current module map,
   lifecycle invariants, SDK gotchas. *Read this for anything non-trivial.*
4. **[`_archive/`](_archive/)** — historical design docs and audits, kept
   for context. None of these are kept current. Don't update them; if a
   fact in there matters, lift it into one of the live files instead.

## Rules

- **Never add another `plan-*.prompt.md`.** New work goes into `TODO.md`.
  Spec interviews land their decisions in `TODO.md` (one row) plus the
  commit message; they don't spawn a new file.
- **When you ship something:** move the row from `TODO.md` to `DONE.md`
  under the matching topic.
- **When you change architecture or an invariant:** update
  `ARCHITECTURE.md` alongside the code change.
- **When the user reports a bug class:** add a row to `TODO.md`'s
  "Testing & CI" topic for the test that would have caught it. Don't
  open a new plan file.

## Why this shape

Before 2026-05-27 this folder had 17 `plan-*.prompt.md` files: vision
docs that pre-dated the Tauri-to-Bun port, design docs with shipped and
unshipped features interleaved, three separate "groups & projects"
designs (two pre-implementation, one post), an SDK audit and a backlog
audit that cross-referenced each other, and a master
implementation-status doc that was already drifting.

The user's call:

> "All the plans are a mess and things are falling between the chairs.
>  Let's make it simple — anything that's already done should be in one
>  file, anything left to is in another."

That's this folder now.
