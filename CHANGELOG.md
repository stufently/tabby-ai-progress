# Changelog

All notable changes to this project are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/); this project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- CI is live: the workflow moved from `docs/github-workflow-ci.yml` to
  `.github/workflows/ci.yml` and now runs `npm ci` / build / test on push and pull
  request. It had to be pushed over SSH — the `gh` OAuth token in use lacks the
  `workflow` scope and HTTPS rejects workflow files without it.

### Known issues / backlog

Raised by code review after 0.1.0 was assembled, deliberately deferred rather than
fixed in the same pass:

- **Early session output can be missed.** The plugin's middleware is installed during
  `attach()`. Anything the session emitted before that is replayed only through
  `tab.binaryOutput$` when Tabby releases its initial data buffer, which the middleware
  path does not subscribe to. A profile that auto-starts an agent could therefore miss
  the first banner/title/OSC and show nothing until the next signal. Fix needs a
  one-shot initial-buffer read with de-duplication against the first live chunk.
- **The `setProgress` shadow is not safe against two owners.** A second instance of the
  plugin (hot reload, or two copies installed) would capture the first instance's no-op
  as its `original` and then render nothing, and `delete tab.setProgress` could remove a
  later plugin's patch. The normal single-instance lifecycle is guarded and correct. Fix
  needs a marker record holding the original descriptor plus wrapper identity and a
  refcount.
- **`src/tabby/` has no tests.** Three of the four review findings were in that layer.
  It needs fakes for `BaseTerminalTabComponent` / `BaseSession` and integration tests for
  attach/detach, session replacement, and the enable toggle.

## [0.1.0] — 2026-08-31

First working version. Not yet published to npm, and not yet exercised inside a live
Tabby window — see "Known gaps".

### Added

- **OSC 9;4 progress protocol support.** Incremental, byte-level scanner that survives
  arbitrary chunk boundaries, accepts both BEL and `ESC \` terminators, and keeps a
  bounded pending buffer so an unterminated `ESC ]` in binary output cannot grow without
  limit. All five protocol states (remove / normal / error / indeterminate / paused).
- **OSC 0 / OSC 2 terminal title source**, interpreted per agent. This is what makes
  OpenAI Codex CLI work: Codex does not emit OSC 9;4 and shows no sign of ever doing so,
  but its TUI writes structured state into the title by default.
- **Codex CLI adapter** — braille spinner → working, `[ ! ] Action Required` → attention,
  `Tasks n/m` → a real percentage, bare project name → idle.
- **Ranked source latching.** `osc` > `title` > `heuristic`. Once a tab has seen a
  higher-ranked signal, lower-ranked ones are permanently ignored for that tab, so the
  real protocol is never overridden by a guess.
- **Per-tab suppression of Tabby's built-in `detectProgress`**, which otherwise calls
  `setProgress(null)` on every output chunk lacking a `NN%` and would erase our value.
  Implemented by shadowing `setProgress` on that tab instance only and restoring it on
  detach; the user's global `terminal.detectProgress` setting is never modified.
- **Heartbeat with 0.01 jitter.** Tabby clears progress 5 s after the last update, and
  because `progress$` is `distinctUntilChanged()` while the split tab that owns the
  visible header re-reads through it, re-sending an identical value never reaches the
  header. The jitter is invisible at CSS-percent resolution.
- Detection-only adapters for OpenCode, Gemini CLI and Aider.
- Opt-in output-pattern fallback heuristic, off by default, gated on a recognised agent
  and disableable per agent.
- Settings tab covering every option.
- 155 unit tests across the protocol, core, adapters and config layers.

### Notes on correctness

- Acceptance included **mutation testing**: 12 deliberate defects were injected and the
  suite had to go red for each. 11 were caught; 1 was proven to be an equivalent mutant
  (no input distinguishes the two variants). Two mutants initially survived and led to
  real changes:
  - the OSC 9 `4;` disambiguation was untested — an ordinary OSC 9 desktop notification
    whose second field happened to be a digit 0–4 (the form Codex CLI emits) would have
    driven the progress bar. Four regression cases added.
  - the Codex adapter returned "no opinion" for a bare project-name title, which is
    exactly what Codex's *default* title config leaves behind when it finishes working —
    so the bar would have swept forever after the agent was done. Now reported as idle,
    non-identifying, so it cannot leak onto non-Codex tabs.

### Fixed after review

- Toggling `enabled` off and back on now takes effect on already-open tabs. Previously
  the tab's config subscription was torn down along with its context, so re-enabling was
  only visible on newly opened tabs.
- Turning `colorizeTab` off now clears a tab colour the plugin had set. Previously an
  error/paused tint stuck until the tab closed.

### Known gaps

- Never run inside a real Tabby window. The Tabby-facing glue — the decorator, the
  middleware wiring and especially the `setProgress` shadowing — is type-checked against
  Tabby's published typings but not exercised at runtime.
- OpenCode, Gemini CLI and Aider have detection patterns that have not been checked
  against those tools' real output, and no title interpretation. No title formats were
  invented for them on purpose: a guessed format produces a confidently wrong indicator.

[Unreleased]: https://github.com/stufently/tabby-ai-progress/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/stufently/tabby-ai-progress/releases/tag/v0.1.0
