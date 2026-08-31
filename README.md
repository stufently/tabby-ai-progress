# Tabby AI Progress — Claude Code, Codex & OpenCode Progress for Tabby Terminal

Real progress and status indicators for AI coding agents in [Tabby Terminal](https://github.com/Eugeny/tabby),
driven by what the agent actually reports — the **OSC 9;4** terminal progress protocol —
instead of by guesswork.

> **Status: not yet released to npm, and not yet verified in a live Tabby session.**
> 155 unit tests pass, the build is clean, and acceptance included mutation testing —
> but nobody has watched the bar move in a real terminal yet. See [Status](#status).

---

## The problem

Tabby ships a feature called **Progress detection** (`terminal.detectProgress`). It is a
regular expression looking for `NN%` anywhere in the terminal output:

```ts
const percentageMatch = /(^|[^\d])(\d+(\.\d+)?)%([^\d]|$)/.exec(data)
if (!this.alternateScreenActive && percentageMatch) { this.setProgress(percentage) }
else { this.setProgress(null) }
```

That is why the blue bar in your tab flickers on and off while an agent works: any chunk
of output *without* a percentage clears it, and any chunk *with* one — a coverage report,
a diff, `100% packed` from git — sets it to something meaningless.

Meanwhile the agents themselves already know their state and are willing to say so.
There is a standard for it, and Tabby does not implement it.

## What this plugin does

It reads the agent's own status out of the terminal stream and drives the tab indicator
explicitly.

Three sources, **strictly ranked** so a real protocol is never overridden by a guess:

| Rank | Source | Default | What it covers |
|---:|---|---|---|
| 3 | **OSC 9;4** progress protocol | always on | Any CLI that speaks it. No agent-specific code involved. |
| 2 | **OSC 0 terminal title** + per-agent adapter | on | Codex CLI out of the box; any agent that reports state in its title. |
| 1 | Output-pattern heuristic | **off** | Last resort, gated on a recognised agent. |

Once a tab has seen a higher-ranked signal, lower-ranked ones are permanently ignored for
that tab.

This is the part worth stressing: **the OSC 9;4 path has no idea which agent is running.**
Claude Code, a shell script, `winget`, something written next year — if it speaks the
protocol, the bar works. Adapters exist only for agents that *don't*.

## Supported agents

| Agent | How it's supported | Works out of the box? |
|---|---|---|
| **Claude Code** | native OSC 9;4 | ⚠️ needs a two-line setup — see [below](#claude-code) |
| **OpenAI Codex CLI** | OSC 0 title adapter | ✅ yes |
| **OpenCode** | detection only | ⚠️ indicator only via the opt-in heuristic |
| **Gemini CLI** | detection only | ⚠️ indicator only via the opt-in heuristic |
| **Aider** | detection only | ⚠️ indicator only via the opt-in heuristic |
| anything else speaking OSC 9;4 | native OSC 9;4 | ✅ yes |

Honest note on the last three: we did not find a verified, stable status format for
OpenCode, Gemini CLI or Aider, so they ship with process detection but **no invented title
rules**. A guessed format produces a confidently wrong indicator, which is worse than
none. If you know their real formats, a PR adding an adapter is small and welcome.

## Installation

Not yet on npm. Once published:

**Settings → Plugins → search `tabby-ai-progress` → Install.**

Until then, build from source and drop it in Tabby's plugin directory:

```bash
git clone https://github.com/stufently/tabby-ai-progress
cd tabby-ai-progress
npm install
npm run build
```

Then either copy the directory into Tabby's plugin folder (**Settings → Plugins → Open
Plugins Directory**), or point Tabby at it:

```bash
TABBY_PLUGINS=$(pwd) tabby --debug
```

Tabby only loads modules whose `package.json` carries the `tabby-plugin` keyword; this one does.

## Agent setup

### Claude Code

Claude Code implements OSC 9;4 but only emits it for terminals on a hardcoded allowlist —
ConEmu, Ghostty ≥ 1.2.0, iTerm2 ≥ 3.6.6. **Tabby is not on that list**, so two things are
needed.

**1. Enable the progress bar** in `~/.claude/settings.json`:

```json
{ "terminalProgressBarEnabled": true }
```

**2. Present as an allowlisted terminal** when launching Claude Code:

```bash
TERM_PROGRAM=ghostty TERM_PROGRAM_VERSION=1.2.0 claude
```

Verified against Claude Code 2.1.251 on 2026-08-31: the gate reads exactly those two
environment variables and its version comparison accepts `1.2.0`.

Two caveats, both real:

* `terminalProgressBarEnabled` is **not in the public documentation**. It exists in the
  settings schema and the `/config` UI. It may be renamed without notice.
* The allowlist has moved before. It was removed entirely in 2.0.53 — which sprayed the
  sequence at every terminal and produced complaints about a "garish progress bar"
  ([#12405](https://github.com/anthropics/claude-code/issues/12405)) — and was then
  reinstated in the version-aware form above.

> ### ⚠️ tmux breaks this, and not for the reason you'll read online
>
> **tmux overwrites `TERM_PROGRAM` with `tmux`.** The allowlist check then fails and
> Claude Code emits **nothing at all** — not a bare sequence, not a wrapped one.
>
> Bug reports claiming Claude Code sends "bare, unwrapped OSC 9;4 under tmux" are
> describing the wrong layer: the DCS passthrough wrapping is implemented. The gate
> upstream of it is what fails.
>
> The fix is the environment override above (set it *inside* tmux, after tmux has
> already clobbered the variable), **not** `set -g allow-passthrough on`.

### OpenAI Codex CLI

Works with no configuration. Codex does not implement OSC 9;4 — the request
([#37032](https://github.com/openai/codex/issues/37032)) has been open since 2026-08-05
with zero maintainer comments — but its TUI writes structured state into the terminal
title by default, and this plugin reads it:

| Codex title | Indicator |
|---|---|
| `⠹ my-project` (braille spinner) | working |
| `my-project` | idle |
| `[ ! ] Action Required \| my-project` | attention |

For cleaner signals, and a **real percentage**, opt into the machine-readable title items
in `~/.codex/config.toml`:

```toml
[tui]
terminal_title = ["run-state", "task-progress", "project"]
```

which yields literal `Working` / `Thinking` / `Waiting` / `Ready` / `Starting` plus
`Tasks 3/12` — the latter rendering as an actual 25% bar.

### Everything else

Any CLI can drive the indicator by writing the sequence itself. From a shell script:

```bash
printf '\033]9;4;3\007'        # indeterminate — "working"
printf '\033]9;4;1;60\007'     # 60%
printf '\033]9;4;2\007'        # error
printf '\033]9;4;0\007'        # done, clear it
```

## The OSC 9;4 protocol

Originally from ConEmu, now the de-facto cross-platform way for a program to tell its
terminal how far along it is.

```
ESC ] 9 ; 4 ; <state> [ ; <progress> ] <terminator>
```

`<terminator>` is `BEL` (`\x07`) or `ST` (`ESC \`) — both are valid per the ConEmu spec.

| State | Meaning | Progress field |
|---|---|---|
| `0` | remove / idle / finished | ignored |
| `1` | determinate progress | `0`–`100` |
| `2` | error | optional |
| `3` | indeterminate — "working, percent unknown" | ignored |
| `4` | paused / warning | optional |

Note `OSC 9` is overloaded: bare `OSC 9;<text>` is the iTerm2/ConEmu **desktop
notification** sequence. The disambiguation rule the ecosystem settled on, in Ghostty's
words, is that "OSC 9;4 always parses as a progress report, meaning you can't send any
notifications starting with `;4`". This plugin implements the same rule — a Codex desktop
notification will not light up your progress bar.

### Terminal support, for context

Verified against release notes and merged PRs on 2026-08-31:

| Terminal | OSC 9;4 | Since |
|---|---|---|
| ConEmu | ✅ | origin of the protocol |
| Windows Terminal | ✅ | v1.6 |
| Ghostty | ✅ | 1.2.0 |
| iTerm2 | ✅ | 3.6.6 |
| kitty | ✅ (actual progress *bar* only in 0.47.0) | 0.38.0 → 0.47.0 |
| Konsole | ⚠️ partial — no error/indeterminate/paused | 26.04.0 |
| WezTerm | ⚠️ `pane:get_progress()` in nightly, no built-in rendering, needs Lua | nightly |
| VS Code | ✅ as a title variable `${progress}`, not a bar | 1.97 |
| foot | ❌ parses and discards | 1.20.0 |
| Alacritty | ❌ won't fix | — |
| **Tabby** | **❌ — this plugin is the implementation** | — |

## Settings

**Settings → AI Progress.**

| Setting | Default | What it does |
|---|---|---|
| `enabled` | `true` | Master switch. |
| `suppressBuiltInDetection` | `true` | Stops Tabby's `detectProgress` from clearing our value. Per-tab; your global setting is not modified. |
| `stripSequences` | `false` | Remove OSC 9;4 bytes from the stream instead of passing them through. |
| `tickIntervalMs` | `400` | Indicator refresh period. Tabby samples at 300 ms, so lower is wasted. |
| `indeterminateStyle` | `sweep` | `sweep` \| `pulse` \| `static` for the "working, percent unknown" animation. |
| `sweepMin` / `sweepMax` / `sweepPeriodMs` | `10` / `90` / `2000` | Sweep geometry. |
| `indeterminateValue` | `35` | Bar position for `static`. |
| `attentionOnErrorAndPaused` | `true` | Show the tab activity dot on error/paused. |
| `colorizeTab` | `false` | Tint the tab colour bar on error/paused. |
| `colors.error` / `colors.paused` | `#e74c3c` / `#f39c12` | Colours for the above. |
| `staleTimeoutMs` | `0` (off) | Force idle if the agent goes silent. Off by default: `OSC 9;4;2` is *supposed* to persist until cleared. |
| `title.enabled` | `true` | The OSC 0 title source (this is what makes Codex work). |
| `fallback.enabled` | `false` | The output-pattern heuristic. |
| `fallback.activityWindowMs` | `1500` | Silence before the heuristic calls it idle. |
| `fallback.agents` | `{}` | Per-agent opt-out, e.g. `{ "aider": false }`. |
| `debugLogging` | `false` | Verbose logging to the dev console. |

## Comparison with `tabby-claude-status`

[`steven-pribilinskiy/tabby-claude-status`](https://github.com/steven-pribilinskiy/tabby-claude-status)
is the existing plugin in this space. It is actively maintained and solves a real problem;
it just solves it differently, and only for one agent.

| | tabby-ai-progress | tabby-claude-status |
|---|---|---|
| Agents | any OSC 9;4 emitter + adapters | Claude Code only |
| Mechanism | reads the terminal stream | installs 9 hooks into `~/.claude/settings.json` |
| Transport | in-process, the PTY you're already reading | hook writes JSON to `os.tmpdir()`, plugin `fs.watch`es it |
| Tab matching | the tab whose stream it is | walks up to 6 levels of process ancestry, with an OSC 7/1337 cwd fallback |
| Modifies your agent config | no | yes |
| Works over SSH / in containers | yes, if the agent emits | no — the hook must run on the same filesystem |
| Extra scope | none | TTS subsystem, companion webapp |

**Where it is genuinely ahead of us:** it is published, it has real users, and hooks give
it semantic events (which tool is running, notification vs. completion) that a progress
protocol simply cannot express. If you want Claude Code to *speak to you*, it does that
and this does not.

**Where we differ deliberately:** nothing is installed into your agent's configuration,
nothing is written to disk, no process trees are walked, and adding a new agent is an
adapter rather than a new integration.

One concrete bug worth noting, since it explains a design choice here: that plugin calls
`setProgress(tick / 30)`, i.e. values in `0..1`. Tabby renders progress as
`width: <value>%`, so that bar is at most 1 % wide — effectively invisible. Tabby's own
doc comment says "value between 0 and 1" and is simply wrong; its own built-in heuristic
passes `0..100`. This plugin passes `0..100`.

## How it works

```
pty ──► session.middleware ──► [ our SessionMiddleware ] ──► xterm.js
                                        │
                                   OscScanner
                                    ╱        ╲
                            parseOsc94    parseOscTitle
                                 │              │
                                 ▼              ▼
                          TabProgressController ◄── FallbackHeuristic
                                 │  (source latch: osc > title > heuristic)
                                 ▼
                          tab.setProgress(0..100)
```

Three Tabby-specific details the implementation has to work around, all verified against
Tabby master:

1. **`setProgress()` takes 0–100**, not 0–1, despite the doc comment.
2. **Tabby auto-clears progress after 5 s** of no updates, so the plugin re-asserts on a
   timer. And because `progress$` is `distinctUntilChanged()` while the *split tab* that
   owns the visible header re-reads through it, re-sending an identical value silently
   fails to reach the header — so the heartbeat jitters the value by 0.01, which is
   invisible at CSS-percent resolution.
3. **The built-in heuristic actively clears our value** on every write. The plugin
   neutralises it per tab by shadowing `setProgress` on that tab instance only, and
   restores it on detach. Your global `terminal.detectProgress` setting is never touched.

## Development

Everything runs in Docker; nothing is installed on the host.

```bash
# tests
docker run --rm --user "$(id -u):$(id -g)" -v "$PWD":/w -w /w -e HOME=/tmp node:24 \
  sh -c 'npm ci && npx vitest run'

# type-check
docker run --rm --user "$(id -u):$(id -g)" -v "$PWD":/w -w /w -e HOME=/tmp node:24 \
  sh -c 'npm ci && npx tsc --noEmit -p tsconfig.json'

# build
docker run --rm --user "$(id -u):$(id -g)" -v "$PWD":/w -w /w -e HOME=/tmp node:24 \
  sh -c 'npm ci && npm run build'
```

Layering rule: nothing under `src/protocol`, `src/core` or `src/adapters` may import
Angular, rxjs, `tabby-*` or Node builtins. That is what keeps the interesting logic
testable without a running terminal.

### CI

A ready GitHub Actions workflow lives at [`docs/github-workflow-ci.yml`](docs/github-workflow-ci.yml).
It is **not** at `.github/workflows/ci.yml` yet because the token used to create this
repository lacks the `workflow` OAuth scope. To activate it:

```bash
mkdir -p .github/workflows
git mv docs/github-workflow-ci.yml .github/workflows/ci.yml
git commit -m "Enable CI" && git push
```

## Status

**Verified:**

| Check | Result |
|---|---|
| Unit tests (`vitest`, Docker `node:24`) | **155 passed**, 8 files |
| Type-check (`tsc --noEmit`) | clean |
| Build (`webpack --mode production`) | `dist/index.js`, 34 KB, Angular/rxjs/`tabby-*` correctly external |
| Layering rule | no forbidden imports under `protocol` / `core` / `adapters` |
| Mutation testing | 12 injected defects: **11 caught**, 1 proven equivalent |

Mutation testing earned its keep — two mutants survived the first pass and both were
real bugs, in code whose tests were green:

1. The OSC 9 `4;` disambiguation was untested. An ordinary OSC 9 desktop notification
   whose second field happened to be a digit 0–4 — **the exact form Codex CLI emits** —
   would have driven the progress bar. Fixed with four regression cases.
2. The Codex adapter returned "no opinion" for a bare project-name title, which is
   precisely what Codex's *default* title config leaves when it finishes working. The bar
   would have swept forever after the agent was done. Now reported as idle.

**Not verified — stated plainly:**

- **Nobody has run this inside a real Tabby window.** The Tabby-facing glue (the
  decorator, the middleware wiring, and especially the `setProgress` shadowing) is
  type-checked against Tabby's published typings but not exercised at runtime. Expect the
  first live run to find something.
- OpenCode, Gemini CLI and Aider have detection patterns that were **not** checked
  against those tools' real output, and no title interpretation at all.
- The Claude Code path depends on an undocumented setting and an env-var workaround. Both
  were verified by reading Claude Code 2.1.251 on 2026-08-31; both could change.

## Contributing

Adding an agent is one file in `src/adapters/` plus tests. Please include evidence — a
link to the source line or release note that documents the format you are matching. We
would rather ship no adapter than a guessed one.

## License

MIT
