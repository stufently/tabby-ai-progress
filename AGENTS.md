# AGENTS.md — orientation for an AI agent working on this repo

Read this before changing anything. `SPEC.md` is the long-form design document and the
reasoning behind every non-obvious decision; this file is the short version plus the
traps.

## What this is

A Tabby Terminal plugin that drives the tab progress indicator from what AI coding
agents actually report. Published to npm as `tabby-ai-progress` (not yet published as of
0.1.0 — the owner does that).

## Golden rules

1. **Never install anything on the host.** Node, TypeScript and tests run only in Docker
   (`node:24`). Always pass `--user "$(id -u):$(id -g)"` when mounting the repo, or the
   container writes root-owned files and breaks the working tree.
2. **Do not publish to npm.** The owner publishes.
3. **The layering rule is enforced and non-negotiable.** No file under `src/protocol/`,
   `src/core/` or `src/adapters/` may import `@angular/*`, `tabby-*`, `rxjs`, `electron`,
   or Node builtins (`fs`, `os`, `path`). Time enters through the injected `Clock`
   interface — never call `Date.now()` or `setInterval` directly in those layers. This is
   what keeps the logic testable without a running terminal.
4. **Do not invent agent title formats.** An adapter with no `interpretTitle` is correct
   and honest. A guessed one produces a confidently wrong indicator, which is worse than
   showing nothing. Any new adapter rule needs a link to the source line or release note
   that documents it.

## Layout

```
src/protocol/   byte-level OSC scanning + pure per-sequence interpreters
src/core/       state machine, source latch, heartbeat, title source, fallback heuristic
src/adapters/   per-agent detection and title interpretation
src/config/     defaults + normalizeConfig (pure) and the Angular ConfigProvider
src/tabby/      thin Angular/Tabby glue — no decision logic lives here
```

If you find yourself wanting to unit-test something in `src/tabby/`, that logic belongs
in `src/core/`.

## Commands

```bash
D='docker run --rm --user 1002:1002 -v '"$PWD"':/w -w /w -e HOME=/tmp node:24 sh -c'

$D 'npm install --no-audit --no-fund --legacy-peer-deps'
$D 'npx vitest run'
$D 'npx tsc --noEmit -p tsconfig.json'
$D 'npm run build'
```

`--legacy-peer-deps` is needed because the Tabby packages declare Angular 15 peers.

## Traps — all verified against Tabby master, all counter-intuitive

These are the reason the code looks the way it does. Do not "simplify" them away.

1. **`tab.setProgress()` takes 0–100, not 0–1.** Tabby's own doc comment says "value
   between 0 and 1" and is wrong — the template renders `width: <value>%` and Tabby's
   built-in heuristic passes 0–100. (The competing plugin passes 0–1 and its bar is at
   most 1 % wide.)
2. **Tabby clears progress 5 s after the last update.** `BaseTabComponent`'s constructor
   subscribes with `debounceTime(5000)` and calls `setProgress(null)`. Hence the
   heartbeat.
3. **Re-sending an identical value does not reach the tab header.** `progress$` is
   `distinctUntilChanged()`, and `SplitTabComponent` — which owns the visible header —
   re-reads the child's progress through it. So an unchanging heartbeat lets the
   *parent's* 5 s timer fire and blank the header. Hence the 0.01 jitter in
   `applyJitter`.
4. **Tabby's built-in `detectProgress` fights us.** `writeRaw` calls `setProgress(null)`
   on every chunk without a `NN%`. `progressSink.ts` shadows `setProgress` on the tab
   instance so the built-in writes become no-ops, and restores it on detach. Never change
   the global `config.store.terminal.detectProgress` from code.
5. **The tab header samples with `auditTime(300)`.** Ticking faster than ~300 ms is
   wasted work.
6. **OSC 9 is overloaded.** Bare `OSC 9;<text>` is a desktop notification — the form
   Codex CLI emits. Only `OSC 9;4;…` is progress. The `4;` guard in `parseOsc94` is
   load-bearing and has dedicated regression tests; mutation testing found it untested
   once already.
7. **Codex's default title goes bare when it finishes.** `["activity","project-name"]`
   means "spinner + project" while working and just "project" when idle. The Codex
   adapter therefore reports idle for any unmatched title — with `identifying: false`, so
   `TitleSource` discards it on tabs not already identified as Codex. Removing either
   half breaks something: without the idle rule the bar sweeps forever; with
   `identifying: true` it would claim every shell tab.

## Testing expectations

Tests are vitest, colocated as `<name>.test.ts`. Use the injected `Clock`
(`src/core/testUtils.ts` has `ManualClock`), not real timers.

**Green tests are not enough.** Before accepting a change to the protocol, core or
adapter layers, run mutation testing: inject a deliberate defect and confirm the suite
goes red. A test that passes on broken code tests nothing. Two real bugs in this repo
were found exactly that way, and both were in code whose tests were green.

## Facts that were verified once and should not be re-derived from memory

`SPEC.md` §2 records, with sources and dates: Claude Code's OSC 9;4 terminal allowlist
and the `terminalProgressBarEnabled` setting; why tmux breaks it; Codex CLI's complete
lack of OSC 9;4 and its title format; the OSC 9;4 terminal support matrix; and the Tabby
API probe that compiles clean. If you need one of those facts, read §2 rather than
guessing — and if you re-verify one and reality has moved, update §2 in the same change.
