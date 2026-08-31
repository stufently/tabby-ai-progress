# Spec: Tabby AI Progress — OSC 9;4 progress and status indicators for AI coding agents

> Implementation spec for `tabby-ai-progress`. Written to be executed literally,
> without guessing. Every fact in "Context" was verified against real sources on
> 2026-08-31 (Tabby master `14e2d60b`, published npm typings `1.0.231-nightly.0`,
> Docker `node:24`). Assumptions are marked **ASSUMPTION** inline.

---

## 1. Task in one paragraph

Build a Tabby Terminal plugin that drives the tab's progress indicator from what AI
coding agents actually report, instead of letting Tabby guess with its built-in
`detectProgress` heuristic. The primary channel is **OSC 9;4**, the real terminal
progress protocol: any CLI that speaks it drives the indicator with no agent-specific
code at all. Because the two most important agents sit on opposite sides of that line
— Claude Code emits OSC 9;4 behind a terminal allowlist, Codex CLI does not emit it and
shows no sign of ever doing so — the plugin also reads the **OSC 0 terminal title**,
which Codex populates with structured state by default, through small per-agent
*adapters*. A third, opt-in output-pattern heuristic is the last resort. The three
sources are strictly ranked (§5.1.1) so the real protocol always wins and never
competes with a guess.

---

## 2. Context: what has already been verified

Everything in this section is **checked against real code/artifacts**, not memory.
Do not re-derive it, and do not "fix" it — if reality disagrees, report it in the
final message instead of silently changing behaviour.

### 2.1 OSC 9;4 protocol (ConEmu progress protocol)

Byte form:

```
ESC ] 9 ; 4 ; <state> [ ; <progress> ] <terminator>
0x1b 0x5d '9' ';' '4' ';' ...
```

Terminators accepted: **BEL** (`0x07`) and **ST** written as two bytes `ESC \`
(`0x1b 0x5c`).

States:

| state | meaning | progress field |
|---|---|---|
| `0` | remove the indicator / idle / finished | absent or ignored |
| `1` | determinate progress | required, `0`–`100` integer percent |
| `2` | error | optional |
| `3` | indeterminate ("working", percent unknown) | absent or ignored |
| `4` | paused / warning | optional |

Both terminators are blessed by the original ConEmu specification, which states that
these codes "may end with `ESC\` (two symbols — ESC and BackSlash) or `BELL` (symbol
with code `\x07`)". Neither is preferred; a parser must accept both.

**The `progress` field is optional and its absence is the *normal* clear form.** The
common way to remove the indicator is the three-parameter `\x1b]9;4;0\x07`. Note the
history: omitting the parameter used to crash iTerm2 (fixed in 3.6.8, "Fix crash on
OSC 9;4 without parameter"), which is why some emitters send a four-parameter variant
with an empty trailing field instead. **Claude Code emits exactly that four-parameter
trailing-semicolon form, `\x1b]9;4;0;`** — corroborated externally by
`anthropics/claude-code#21435`, where kitty rendered a notification whose body read
literally `4;0;`. Both forms must parse to "idle" (§4.3 rule 7 makes an empty progress
field equivalent to an absent one; test 14b pins the Claude Code form specifically).

**State 4 has two names in the wild and no consensus.** `microsoft/terminal` PR #8055
uses both inside a single document ("the 'Warning' state" in its table, "st 4: set
paused state" below it); Ghostty's enum calls it `pause`; iTerm2 says paused; WezTerm
documents paused and marks it unsupported. This spec treats state 4 as **paused** and
must not depend on the distinction.

**OSC 9 is overloaded, and the disambiguation rule is `;4`.** Bare OSC 9 is the
iTerm2/ConEmu desktop-notification sequence. Ghostty's release notes state the rule
the ecosystem settled on: "OSC 9;4 always parses as a progress report, meaning you
can't send any notifications starting with `;4` as notifications." Claude Code
implements the same rule in its own emission validator, which rejects OSC 9 bodies
beginning with a digit unless they match `^4;[0-4](;(100|\d{1,2})?)?$`. Our parser's
rule 2 (§4.3) is the same rule from the consumer side, and tests 24–25 pin it.

**8-bit OSC introducer (`0x9d`) is NOT supported** and must not be implemented: no
source documents it for 9;4, and accepting it in a UTF-8 stream causes false
positives. Same reasoning as the `0x9c` terminator rejection (§4.3 rule 3).

**Multiplexer wrapping.** Under tmux/screen, emitters may wrap the sequence in a DCS
passthrough (`ESC P tmux; … ESC \`) with the inner `ESC` doubled. Tabby is not a
multiplexer: when tmux runs *inside* a Tabby tab it unwraps the passthrough itself and
Tabby receives the plain sequence. No special handling is required — but note that our
scanner naturally finds `ESC ]` at the second byte of a doubled `ESC ESC ]`, so a raw
unconsumed wrapper is also parsed rather than ignored. That is acceptable (the status
is still the agent's true status) and needs no code.

Consumer support, verified against release notes / merged PRs on 2026-08-31 — this is
the table the README must reproduce:

| Terminal | OSC 9;4 | Since |
|---|---|---|
| ConEmu | yes (origin of the protocol) | — |
| Windows Terminal | yes | v1.6 (PR #8055) |
| Ghostty | yes | 1.2.0 |
| iTerm2 | yes | 3.6.6 (3.6.8 advertises `P` in `$TERM_FEATURES`) |
| kitty | yes, staged rollout; actual progress **bar** only in 0.47.0 | 0.38.0 → 0.47.0 |
| Konsole | partial (no error/indeterminate/paused) | v26.04.0 (MR !1054) |
| WezTerm | partial — `pane:get_progress()` in nightly, no built-in rendering, Lua required | nightly |
| VS Code | yes, as a terminal **title variable** `${progress}`, not a bar | 1.97 |
| foot | parses and discards | 1.20.0 |
| Alacritty | won't fix (#5201) | — |
| **Tabby** | **none — this plugin is the implementation** | — |

Emitting CLIs seen in the wild: Claude Code, `winget`, PowerShell 7.

### 2.2 Tabby's tab progress API — verified facts, several of them counter-intuitive

Source: `tabby-core/src/components/baseTab.component.ts`,
`tabby-core/src/components/tabHeader.component.{ts,pug,scss}`,
`tabby-core/src/components/splitTab.component.ts`,
`tabby-terminal/src/api/baseTerminalTab.component.ts` at Tabby master `14e2d60b`.

**(F1) `setProgress()` takes 0–100, not 0–1.** The doc comment on
`BaseTabComponent.setProgress` says *"value between 0 and 1"* and it is **wrong**.
The template renders the value directly as a CSS percentage:

```pug
.progressbar([style.width]='progress + "%"', *ngIf='progress != null')
```

and Tabby's own built-in heuristic feeds it `0`–`100`:

```ts
const percentage = percentageMatch[3] ? parseFloat(percentageMatch[2]) : parseInt(percentageMatch[2])
if (percentage > 0 && percentage <= 100) { this.setProgress(percentage) }
```

Therefore the plugin must pass **0–100**. (The competitor plugin passes `tick/30`,
i.e. 0–1, which renders a bar at most 1% wide — effectively invisible. Do not copy
that.)

**(F2) Tabby auto-clears progress after 5 seconds of silence.** In the
`BaseTabComponent` constructor:

```ts
this.subscribeUntilDestroyed(this.progress.pipe(
    filter(x => x !== null),
    debounceTime(5000),
), () => { this.setProgress(null) })
```

So a value set once and left alone disappears after 5 s. The plugin **must
re-assert** the value periodically while a non-idle state is active.

**(F3) A repeated identical value does not propagate to the split tab.**
`progress$` is `this.progress.pipe(distinctUntilChanged())`, and
`SplitTabComponent.addTab` forwards the child's progress upward through that
observable:

```ts
tab.subscribeUntilDestroyed(
    this.observeUntilChildDetached(tab, tab.progress$),
    p => this.setProgress(p),
)
```

Consequence: re-asserting the *same* number keeps the child tab's own 5 s timer at
bay (F2 subscribes to the raw `BehaviorSubject`, not to `progress$`), but the parent
`SplitTabComponent` — the component that actually owns the visible tab header — sees
nothing, so **its** 5 s timer fires and the header goes blank. The heartbeat must
therefore emit a value that differs from the previous one. See §5.4 (jitter).

**(F4) Tabby's built-in heuristic actively clears our value.** In
`BaseTerminalTabComponent.writeRaw`, on **every** chunk written to the frontend:

```ts
if (this.config.store.terminal.detectProgress) {
    const percentageMatch = /(^|[^\d])(\d+(\.\d+)?)%([^\d]|$)/.exec(data)
    if (!this.alternateScreenActive && percentageMatch) { ...setProgress(percentage) }
    else { this.setProgress(null) }          // <-- clears whatever we set
}
```

`terminal.detectProgress` defaults to `true` (`tabby-terminal/src/config.ts`). Since
the plugin observes the stream *before* `writeRaw` runs, the heuristic wins every
race. The plugin must suppress it **per tab** (§5.5) rather than flipping the global
config setting behind the user's back.

**(F5) The tab header samples progress with `auditTime(300)`.**

```ts
this.subscribeUntilDestroyed(this.tab.progress$.pipe(auditTime(300)), progress => { ... })
```

Animating faster than ~300 ms is wasted work. The default tick is 400 ms. (The
competitor ticks at 50 ms — 20 calls/second/tab — for no visible benefit.)

**(F6) Progress bar geometry.** `.progressbar` is a 3px bar pinned to the top of the
tab header with `transition: 0.25s width`, coloured `var(--bs-blue)`
(`tabby-core/src/theme.new.scss`). There is no supported per-state colouring of that
bar from a plugin; the separately available signals are `tab.color` (a 3px bar at the
*bottom* of the header, `.colorbar`) and `displayActivity()`/`clearActivity()`
(a dot).

### 2.3 Where to read the stream from

Data path, verified in `tabby-terminal/src/session.ts` and
`api/baseTerminalTab.component.ts`:

```
pty → session.emitOutput(Buffer)
    → session.middleware.feedFromSession()
        → stack[0] (plain SessionMiddleware)
        → OSCProcessor            (handles OSC 1337 + OSC 52, passes everything else through)
        → [LoginScriptProcessor]  (if configured)
        → ...any middleware we push...
    → middleware.outputToTerminal$
    → session.output$ (string) / session.binaryOutput$ (Buffer)
    → tab.write() → tab.writeRaw()   ← detectProgress heuristic lives here (F4)
    → frontend.write()
```

`OSCProcessor` explicitly re-emits every OSC code it does not itself handle:

```ts
} else {
    processedData.push(data.subarray(prefixIndex, foundSuffix[1] + foundSuffix[0].length))
}
```

`parseInt('9') === 9`, which is neither `1337` nor `52`, so **OSC 9;4 reaches us
intact**. Verified by reading `tabby-terminal/src/middleware/oscProcessing.ts`.

**Chosen feed: a `SessionMiddleware` pushed onto `session.middleware`.** Reasons:
Buffers (no UTF-8 string mangling), it fires regardless of `tab.enablePassthrough`,
it is a documented exported API, and it allows optional stripping of the sequence
(§5.6). `tab.binaryOutput$` is the documented fallback if `session.middleware` is
absent (older Tabby) — see §5.2.

Do **not** rely on `OSCProcessor` having already re-joined a split sequence. It does
buffer incomplete OSC runs, but the plugin's parser must be independently correct on
arbitrary chunk boundaries: the fallback feed has no such buffering, and the parser
is unit-tested directly.

### 2.4 Tabby plugin ABI — verified

* Tabby loads only npm modules whose `package.json` `keywords` contains
  **`tabby-plugin`** (`HACKING.md`). The Plugin Manager lists npm packages by that
  same keyword. This keyword is mandatory.
* A plugin's default export must be an Angular `NgModule` class.
* Extension points are registered as `multi: true` providers.
* `tabby-core`, `tabby-terminal`, `tabby-settings`, `@angular/*`, `rxjs`,
  `@ng-bootstrap/*` and Node builtins are provided by the host at runtime and **must
  be webpack `externals`** — bundling them breaks Angular DI (two copies of the
  injector tokens).
* Relevant extension points, all confirmed present in the published typings:
  `TerminalDecorator` (`tabby-terminal`), `ConfigProvider` (`tabby-core`),
  `SettingsTabProvider` (`tabby-settings`).

`SettingsTabProvider` shape (`tabby-settings/src/api.ts`):

```ts
export abstract class SettingsTabProvider {
    id: string; icon: string; title: string; weight = 0; prioritized = false
    getComponentType (): any { return null }
}
```

### 2.5 API surface probe — compiled clean, do not doubt it

The following file **type-checks with zero errors** against
`tabby-core@1.0.231-nightly.0` / `tabby-terminal@1.0.231-nightly.0` typings under
TypeScript 5.9.3. Every member used below therefore exists; use them freely.

```ts
import { BaseTerminalTabComponent, SessionMiddleware, BaseSession } from 'tabby-terminal'
import { BaseTabComponent } from 'tabby-core'

export class M extends SessionMiddleware {
    feedFromSession (data: Buffer): void { super.feedFromSession(data) }
}

export function probe (tab: BaseTerminalTabComponent<any>, s: BaseSession): void {
    const m = new M()
    s.middleware.push(m)
    s.middleware.remove(m)
    tab.setProgress(50); tab.setProgress(null)
    tab.displayActivity(); tab.clearActivity()
    tab.color = '#ff0000'
    const p: BaseTabComponent | null = tab.parent; void p
    tab.binaryOutput$.subscribe(() => {})
    tab.sessionChanged$.subscribe(() => {})
    tab.frontendReady$.subscribe(() => {})
    void tab.session; void tab.alternateScreenActive; void tab.title
}
```

Note the generic: it is `BaseTerminalTabComponent<any>`, not `BaseTerminalTabComponent`.

### 2.6 Toolchain — versions checked today, build proven in Docker

| Thing | Version | How it was chosen |
|---|---|---|
| Node (build + test) | **24** (`node:24`, 24.20.0 LTS) | `endoflife.date`: 24 is the newest branch with `isLts=true` and `isEol=false`. 26 exists but is Current, not LTS. |
| TypeScript | **5.9.3** | See note below. |
| webpack | **5.110.2** | latest |
| webpack-cli | **7.2.3** | latest |
| ts-loader | **9.6.2** | latest |
| vitest | **4.1.11** | latest; verified running under `node:24` |
| Angular (peer/dev) | **^15.2.10** | Tabby 1.0.x is Angular 15; `tabby-terminal` declares `@angular/core: ^15` as a peer dep. Newer Angular is *not* an option — the host provides Angular 15 at runtime. |
| `pug` | **^3** | required by `pug-loader` at build time; Tabby pins `^3` too |
| `@types/webpack-env` | latest | needed so `template: require('./x.pug')` type-checks |
| `tabby-core` / `tabby-terminal` / `tabby-settings` | **`1.0.231-nightly.0`** (exact pin, devDependency) | Tabby stopped publishing non-prerelease tags on npm after `1.0.163`; `latest` dist-tag is `1.0.231-nightly.0`, which matches the current Tabby release line (GitHub latest release `v1.0.235`, 2026-07-22). A caret range would not match a prerelease, so pin exactly. |

**Why not TypeScript 7.0.2 (the current `latest`)**: it removes
`moduleResolution: "node10"`, which the Tabby plugin toolchain and ts-loader's
default config assume, and `ts-loader` 9.x has no released support for it. TS 7 *does*
still emit `Reflect.metadata` for legacy decorators (verified in Docker), so the
blocker is module resolution, not decorators. 5.9.3 is the newest 5.x and is what
`ts-loader` 9.6.2 is tested against. Revisit when ts-loader ships TS 7 support.

**Build proven.** This exact stack was compiled end-to-end in Docker before this spec
was written; a module importing `TerminalDecorator`, `ConfigProvider`, `ConfigService`
and `BaseTerminalTabComponent<any>` emitted `dist/index.js` (UMD) with
`tabby-core` / `tabby-terminal` / `@angular/*` correctly left as externals. A second
probe added an Angular component using `template: require('./x.pug')` with the
`['apply-loader', 'pug-loader']` chain and also compiled clean (bundling a ~7 KB
`pug-runtime`). So the webpack config below is known-good, not guessed:

```js
module: { rules: [
    { test: /\.ts$/, loader: 'ts-loader', options: { configFile: path.resolve(__dirname, 'tsconfig.json') } },
    { test: /\.pug$/, use: ['apply-loader', 'pug-loader'] },
] },
externals: ['fs','os','path','ngx-toastr',/^rxjs/,/^@angular/,/^@ng-bootstrap/,/^tabby-/],
output: { path: path.resolve(__dirname, 'dist'), filename: 'index.js', libraryTarget: 'umd', globalObject: 'this' },
```

Keep `"useDefineForClassFields": false` and `"target": "es2016"`. With
`target: es2022`+ TypeScript turns `useDefineForClassFields` on by default, which
breaks Angular's property decorators.

### 2.7 Claude Code: what it emits, and why Tabby never sees it

Verified by reading the installed Claude Code bundle (v2.1.251) plus its public
changelog and issue tracker on 2026-08-31. These facts drive the README recipe; the
plugin code itself does **not** hardcode any of them.

* Claude Code **does** implement OSC 9;4 and emits state `3` (indeterminate) while a
  turn is loading or tools are in progress, clearing with the four-parameter
  `\x1b]9;4;0;` form. Changelog 2.1.128: *"Fixed terminal progress indicator (OSC 9;4)
  flickering off between tool calls — stays visible across the full turn."*
* Emission is gated by **two independent conditions**, both of which must hold:
  1. the setting `terminalProgressBarEnabled` in `~/.claude/settings.json`
     (added in 2.0.56: *"Added setting to enable/disable terminal progress bar
     (OSC 9;4)"*); and
  2. a **strict terminal allowlist**: ConEmu (via its env vars), Ghostty `>= 1.2.0`,
     or `iTerm.app >= 3.6.6`, keyed on `TERM_PROGRAM` / `TERM_PROGRAM_VERSION`.
     `WT_SESSION` is explicitly excluded. **Tabby is not on this list.**
* History worth knowing: the allowlist was briefly *removed* in 2.0.53, which sprayed
  the sequence at every terminal and produced bug reports about a "garish progress
  bar" (`anthropics/claude-code#12405`); it was then reinstated in the version-aware
  form above. Do not assume the 2.0.53 behaviour.
* Therefore the documented workaround — launching Claude Code with
  `TERM_PROGRAM=ghostty TERM_PROGRAM_VERSION=1.2.0` — **is still valid today**: the
  gate reads exactly those two env vars and its version comparison passes `1.2.0`.
  This was confirmed by tracing the installed binary, not inferred.
* ⚠️ **tmux breaks it, and not for the reason people report.** tmux overwrites
  `TERM_PROGRAM` with `tmux`, so the allowlist fails and Claude Code emits
  *nothing at all* — neither wrapped nor bare. Bug reports claiming Claude Code sends
  "bare, unwrapped OSC 9;4 under tmux" are describing the wrong layer; the DCS
  passthrough wrapping is implemented. The fix for a user is to set the env override
  above, not to enable `allow-passthrough`. The README must say this.
* `terminalProgressBarEnabled` is **absent from the public documentation** — it exists
  in the settings schema and the `/config` UI only. The README should therefore state
  plainly that it is undocumented and may change.

**Implication for this plugin: none of the above is a code dependency.** The plugin
parses OSC 9;4 from whoever sends it. Claude Code specifics belong in the README as a
setup recipe, and at most in a detection regex in `src/adapters/builtin.ts`. Do not
write Claude Code version checks, settings-file reading, or hook installation into the
plugin.

### 2.8 OpenAI Codex CLI: no OSC 9;4, but a structured title channel

Verified 2026-08-31 against the cloned repo, the shipped native binary and the live
install (`codex-cli 0.151.0`, which is also the latest release, `rust-v0.151.0`).

* **Codex CLI does not emit OSC 9;4 in any configuration.** `grep -rn ']9;4'` and
  `'9;4;'` across the whole repo → zero hits (the bare `9;4` matches are SGR fragments
  like `\x1b[39;48;2;80;80;80m` in ratatui snapshot files). A raw byte grep of the
  shipped musl binary for `]9;4` → zero. The only `]9;` in the binary is the **OSC 9
  desktop-notification** format string, a different feature
  (`codex-rs/tui/src/notifications/osc9.rs:52`).
* Request issue `openai/codex#37032` ("Emit OSC 9;4 progress reports…") is **open with
  zero comments**; its labels were applied by a bot 35 seconds after opening and no
  human has touched it. No PR references it. The nearest maintainer statement is on
  sibling issue #25879, where a Codex maintainer asked what a structured sequence would
  add "given the TUI already supports OSC 0 terminal title updates" — and then went
  silent for three months. **Treat OSC 9;4 support in Codex as absent and not coming.**
* ⚠️ **Codex does NOT use the alternate screen during normal operation.**
  `Tui::init()` is documented as "inline viewport; history stays in normal scrollback"
  (`codex-rs/tui/src/tui.rs:421`) and `set_modes()` contains no `EnterAlternateScreen`.
  The alt screen is entered only for transient overlays (Ctrl+T transcript, diff pager,
  full-screen approvals, resume picker). So Tabby's `alternateScreenActive` is **false**
  while Codex works and true only while the user sits in a dialog — it is an inverse
  signal at best. Do not use it to detect "an agent is running".
* ✅ **The usable channel is the OSC 0 terminal title, and it is on by default.**
  Written as `\x1b]0;{}\x07` (OSC **0**, BEL-terminated —
  `codex-rs/tui/src/terminal_title.rs:85-91`). Default items are
  `["activity", "project-name"]` (`status_surfaces.rs:26-27`), which yields:

  | Codex state | Title |
  |---|---|
  | working | `<braille spinner> <project>`, spinner cycling every 100 ms over `⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏` |
  | idle | `<project>` alone (the activity item yields `None`) |
  | blocked on the user | prefix `[ ! ] Action Required` / `[ . ] Action Required`, blinking at 1 Hz, applied regardless of configured items |

  Users can opt into literal machine-readable words with
  `tui.terminal_title = ["run-state", "project"]`, giving exactly
  `Starting` \| `Ready` \| `Working` \| `Waiting` \| `Thinking`
  (`status_surfaces.rs:937-961`), and `task-progress` yields `Tasks {completed}/{total}`
  — a genuine determinate percentage. Items are joined with `" | "`, sanitised, capped
  at 240 chars. `tui.terminal_title = []` disables it; the spinner also needs
  `tui.animations = true`.
* Conservative output anchors for the last-resort heuristic. The status header word is
  **arbitrary model text** (the first bold span of the streamed reasoning summary,
  `chatwidget/streaming.rs`), so matching `Working`/`Thinking` in the body is wrong.
  The stable anchor is the literal `" to interrupt)"` from
  `Working (0s • esc to interrupt)` (`status_indicator_widget.rs:248-281`). The TUI
  banner is `>_ OpenAI Codex (v…)`; `codex exec` prints `OpenAI Codex v{VERSION}` to
  **stderr**.
* Programmatic channels exist but are **out of scope for a terminal plugin**: `notify`
  (turn-complete only, TODO'd for removal), the 12-event hooks system (blocked for TUI
  use by open bug #37537 — hooks are children of a detached app-server daemon with
  `fd0/1/2 → /dev/null` and no tty identity in the payload), `codex exec --json`,
  `app-server`, and on-disk rollout JSONL. **Do not implement any of these.** They all
  require out-of-band plumbing of exactly the kind that makes the competitor plugin
  fragile.

**Design consequence, and it is the whole reason this plugin is not "a Claude Code
plugin":** a protocol-only design would show nothing for Codex. Reading the OSC 0
title gives Codex working/idle/blocked — and a real percentage when the user opts into
`task-progress` — through the same tab indicator, with no hooks, no spool files and no
process-tree guessing. Hence three ranked sources (§5.1.1), not one.

### 2.9 Prior art: `steven-pribilinskiy/tabby-claude-status`

Studied so we deliberately do *not* repeat it. Facts (npm + repo, read 2026-08-31):
`tabby-claude-status@1.2.1`, sole published version, ~13 weekly downloads, 1 star,
MIT. It works **only** with Claude Code, and **not** through the terminal at all: it
installs a `hook.js` into 9 Claude Code hook events in `~/.claude/settings.json`, the
hook writes JSON files into `os.tmpdir()/tabby-claude-status.d`, and the plugin
watches that directory with `fs.watch`, matching events to tabs by walking 6 levels of
process ancestry (with an OSC 7 / OSC 1337 cwd fallback for WSL). It contains **zero**
references to OSC 9;4 — its only terminal protocol is a private `OSC 777;claude-status`
sequence used for manual testing. Its progress bar calls `setProgress(tick/30)` at
50 ms intervals, i.e. values 0–1 into an API that wants 0–100 (see F1). It also ships
a large TTS subsystem and a companion webapp, and is heavily Windows-centric.

Take from it only the confirmation that `TerminalDecorator` + `ConfigProvider` +
`SettingsTabProvider` is the right provider triple. **Do not** copy its architecture,
its hook installation, its `fs.watch` spooling, its PID-ancestry matching, or its
progress values.

---

## 3. Architecture and module boundaries

Three layers. The boundary rule is absolute and exists so the interesting logic is
testable without Angular, Electron or a terminal:

```
src/
├─ protocol/     PURE. Zero imports outside Node builtins + own files. Byte-level.
├─ core/         PURE. Zero framework imports. Takes a clock + a sink via constructor.
├─ adapters/     PURE. Agent identification + optional non-OSC interpretation.
├─ config/       PURE defaults + the Angular ConfigProvider (only the provider is impure).
└─ tabby/        THIN Angular/Tabby glue. No decision logic. Not unit-tested.
```

**Hard rule: no file under `src/protocol/`, `src/core/` or `src/adapters/` may import
from `@angular/*`, `tabby-*`, `rxjs`, `electron`, `fs`, `os`, `path`, or from
`src/tabby/`.** Violating this makes the tests un-runnable and is a spec violation.
Time must arrive as an injected `now(): number`, never `Date.now()` called inline.

### 3.1 File map

| File | What it is |
|---|---|
| `src/protocol/types.ts` | create — protocol-level types |
| `src/protocol/oscScanner.ts` | create — generic incremental OSC byte scanner (all chunk/buffer logic lives here) |
| `src/protocol/oscScanner.test.ts` | create |
| `src/protocol/osc94.ts` | create — OSC 9;4 progress interpreter (pure, per-sequence) |
| `src/protocol/osc94.test.ts` | create |
| `src/protocol/oscTitle.ts` | create — OSC 0/2 title interpreter (pure, per-sequence) |
| `src/protocol/oscTitle.test.ts` | create |
| `src/core/types.ts` | create — controller-level types |
| `src/core/progressState.ts` | create — sequence → state reduction |
| `src/core/progressState.test.ts` | create |
| `src/core/tabController.ts` | create — per-tab state machine, tick/heartbeat, value computation |
| `src/core/tabController.test.ts` | create |
| `src/core/titleSource.ts` | create — turns titles into states via the identified adapter |
| `src/core/titleSource.test.ts` | create |
| `src/core/fallbackHeuristic.ts` | create — opt-in activity-based fallback |
| `src/core/fallbackHeuristic.test.ts` | create |
| `src/adapters/types.ts` | create — `AgentAdapter` |
| `src/adapters/builtin.ts` | create — claude-code, codex, opencode, gemini-cli, aider |
| `src/adapters/registry.ts` | create — lookup + first-match identification |
| `src/adapters/builtin.test.ts` | create |
| `src/config/defaults.ts` | create — the `aiProgress` defaults object + `normalizeConfig()` |
| `src/config/defaults.test.ts` | create |
| `src/config/configProvider.ts` | create — `extends ConfigProvider` |
| `src/tabby/progressMiddleware.ts` | create — `extends SessionMiddleware` |
| `src/tabby/progressSink.ts` | create — owns `setProgress` suppression + writes to the tab |
| `src/tabby/terminalDecorator.ts` | create — `extends TerminalDecorator` |
| `src/tabby/settingsTabProvider.ts` | create |
| `src/tabby/settingsTab.component.ts` | create |
| `src/tabby/settingsTab.component.pug` | create |
| `src/index.ts` | create — the `NgModule` default export |
| `package.json`, `tsconfig.json`, `webpack.config.js`, `vitest.config.ts` | create |
| `.github/workflows/ci.yml` | create |

**Do not create `README.md`, `CHANGELOG.md` or `AGENTS.md`.** The reviewer writes
those after acceptance, from independently verified facts. A README written from this
spec would restate claims about Claude Code versions, terminal support and competitor
behaviour that only the reviewer has the sources to stand behind.

---

## 4. `src/protocol` — the OSC layer

Split in two on purpose: **one** piece of stateful byte-level machinery (the scanner,
where all the hard chunk-boundary bugs live) and **pure per-sequence interpreters**
that take a finished sequence and return meaning. Adding a third OSC consumer later
must not require touching the scanner.

### 4.0 The scanner (`src/protocol/oscScanner.ts`)

```ts
/** One complete OSC sequence lifted out of the stream. */
export interface OscSequence {
    /** The numeric code before the first ';' (0, 2, 9, …). NaN if unparseable. */
    readonly code: number
    /** Everything after "<code>;", terminator excluded. '' when there was no ';'. */
    readonly body: string
    /** The full payload between "ESC ]" and the terminator. For debugging only. */
    readonly raw: string
}

export interface OscScannerOptions {
    /** Only these codes are emitted. Default: [0, 2, 9]. Others are skipped cheaply. */
    readonly codes?: readonly number[]
    /** Hard cap on bytes retained while waiting for a terminator. Default 512. */
    readonly maxPendingBytes?: number
}

export class OscScanner {
    constructor (options?: OscScannerOptions)
    /** Feed one chunk. Returns every complete, in-allowlist sequence, in stream order. Never throws. */
    push (chunk: Uint8Array): OscSequence[]
    reset (): void
    get pendingLength (): number
}

/** Removes every complete OSC 9;4 sequence, leaving all other bytes byte-identical. Stateless. */
export function stripOsc94 (chunk: Uint8Array): Uint8Array
```

All of §4.3's byte-level rules belong to the scanner. The `maxPendingBytes` cap and
the "never throws" guarantee are the scanner's, not the interpreters'.

One relaxation versus the old design: the scanner must **not** require the payload to
start with `9;4;`. It extracts any OSC sequence whose code is in the allowlist and
hands the body to an interpreter. The `9;4` disambiguation (rule 2) moves into
`parseOsc94`, which is the correct place for it — that is what makes OSC 0 title
support possible without a second copy of the chunk-splitting logic.

### 4.1 Types (`src/protocol/types.ts`)

```ts
/** Raw states of the OSC 9;4 protocol, as sent on the wire. */
export enum OscProgressState {
    Remove = 0,
    Normal = 1,
    Error = 2,
    Indeterminate = 3,
    Paused = 4,
}

/** One successfully parsed OSC 9;4 sequence. */
export interface OscProgressEvent {
    readonly state: OscProgressState
    /** Integer 0..100 when the sequence carried a usable percentage, else null. */
    readonly progress: number | null
    /** The raw payload between "ESC ] " and the terminator, for debugging. Never used for logic. */
    readonly raw: string
}

```

(`OscScannerOptions` and `OscSequence` are declared in `oscScanner.ts`, §4.0 — keep
them there so `types.ts` stays free of scanner internals.)

### 4.2 The interpreters

```ts
// src/protocol/osc94.ts
/**
 * Returns a progress event when `seq` is a well-formed OSC 9;4, else null.
 * Pure. Requires seq.code === 9 and seq.body to start with '4;'.
 */
export function parseOsc94 (seq: OscSequence): OscProgressEvent | null

// src/protocol/oscTitle.ts
/**
 * Returns the title string when `seq` is an OSC 0 or OSC 2 title-setting sequence,
 * else null. OSC 0 sets icon name + title, OSC 2 sets title only; both count.
 * OSC 1 (icon name only) must return null. Pure.
 */
export function parseOscTitle (seq: OscSequence): string | null
```

`parseOscTitle` returns the body verbatim apart from trimming trailing NULs; it does
**not** interpret content. Interpretation is per-agent and lives in the adapters (§6).
An empty title is returned as `''`, not `null` — "the agent cleared the title" is
information.

### 4.3 Parsing rules — implement exactly these

Work on **bytes**, never on a decoded string. Decode the payload with
`Buffer.from(bytes).toString('latin1')` only after the boundaries are known (the
payload is ASCII by construction; latin1 avoids UTF-8 replacement characters).

Rules 1, 3, 4, 9, 10, 11 belong to **`OscScanner`**; rules 2, 5, 6, 7, 8 belong to
**`parseOsc94`**. Keep them in those files.

1. **Introducer.** A candidate begins at the two-byte sequence `0x1b 0x5d` (`ESC ]`).
   Nothing else starts a candidate.
2. **Code and disambiguation** (in `parseOsc94`). The sequence qualifies only when
   `seq.code === 9` **and** `seq.body` starts with `4;` or equals `4`. Everything else
   is not ours and returns `null`. Concretely: `ESC ] 9 ; 4 ; …` qualifies;
   `ESC ] 9 ; Build finished BEL` (an OSC 9 desktop notification — the form Codex CLI
   actually emits) does not; `ESC ] 9 ; 1 2 ; x` does not; `ESC ] 0 ; title` does not
   (it is a title, handled by `parseOscTitle`); `ESC ] 1 3 3 ; A` does not.
   The scanner, by contrast, abandons a candidate whose code is not in its allowlist
   and resumes scanning from the byte **immediately after the `ESC`**
   (`introducerIndex + 1`), so an overlapping later `ESC ]` is still found.
3. **Terminator.** After the introducer, scan forward for the first of:
   * `0x07` (BEL), or
   * `0x1b 0x5c` (ST as `ESC \`).
   A lone `0x9c` is **not** accepted as a terminator: in a UTF-8 stream `0x9c` is a
   valid continuation byte and accepting it produces false positives. This is a
   deliberate decision; document it in a code comment.
   If a bare `0x1b` is the final byte of the chunk, hold it — the next chunk may start
   with `0x5c`.
4. **Bounded buffering.** While holding an unterminated candidate, retain at most
   `maxPendingBytes` (default 512) bytes counted from the introducer. On exceeding the
   cap, **discard the candidate entirely** (do not emit anything, do not throw) and
   resume scanning after the introducer. Rationale: an unterminated `ESC ]` in a binary
   dump must never grow an unbounded buffer.
5. **Payload split.** Payload is the bytes between the introducer and the terminator,
   as a string. Split on `;`. Field 0 is `9`, field 1 is `4`, field 2 is the state,
   field 3 (optional) is the progress. The scanner sets `code` from field 0 and `body`
   to everything after the first `;`; `parseOsc94` splits `body` further.
6. **State field.** Must parse as one of the exact strings `0` `1` `2` `3` `4` after
   trimming ASCII spaces/tabs. Anything else (`9`, `01`, `x`, empty, `1.0`) → **the
   sequence is ignored entirely**; emit nothing, do not change state, continue
   scanning after the terminator. Note `01` is rejected: accept only the canonical
   single digit.
7. **Progress field.**
   * Present and matching `^\d{1,3}$` after trimming → `Math.min(100, value)`.
     (`150` → `100`. This clamps up-front so the controller never sees > 100.)
   * Present but not matching (`abc`, `-5`, `50.5`, empty string) → treat as
     **absent** (`progress: null`); the sequence is still emitted with its state.
   * Absent → `null`.
   * Extra fields beyond index 3 are ignored, not an error.
8. **State 1 without usable progress.** Still emitted, `progress: null`. The
   *controller* decides what that means (§5.3), not the parser.
9. **Multiple sequences in one chunk.** All are returned, in order. The scanner does
   not collapse them; the controller applies them in order and the last one wins.
10. **Interleaving.** Non-OSC bytes, other OSC sequences, CSI sequences and arbitrary
    binary between candidates are skipped without affecting parsing.
11. **Never throws.** Any unexpected input path returns `[]` and resets the pending
    buffer at worst.

### 4.4 `stripOsc94`

Returns a new `Uint8Array` with every **complete** OSC 9;4 sequence (introducer
through terminator inclusive) removed and all other bytes preserved exactly. If no
sequence is present it may return the input unchanged. It is stateless: partial
sequences are left alone (the middleware only calls it after the parser has consumed a
chunk; a partial tail therefore reaches the terminal, which is correct — the terminal
would have received it anyway).

---

## 5. `src/core` — the decision layer

### 5.1 Types (`src/core/types.ts`)

```ts
export type AgentActivityState = 'idle' | 'working' | 'progress' | 'error' | 'paused'

export interface AgentProgressState {
    readonly activity: AgentActivityState
    /** 0..100 when activity === 'progress'; null otherwise. */
    readonly percent: number | null
    /** Timestamp (ms) of the event that produced this state. */
    readonly at: number
    /** Which signal produced this state. See §5.1.1 for precedence. */
    readonly source: StatusSource
}

/**
 * Where a status came from, in descending order of authority.
 * `osc`       — an OSC 9;4 sequence from the agent itself. A real protocol. Authoritative.
 * `title`     — an OSC 0/2 terminal title, interpreted by an agent adapter. Structured
 *               and emitted deliberately by the agent, but string-encoded and
 *               agent-specific, so it yields to `osc`.
 * `heuristic` — our own output-pattern guess. Advisory, opt-in, lowest rank.
 */
export type StatusSource = 'osc' | 'title' | 'heuristic'

/** Numeric rank; higher wins. Exported so the precedence rule is testable directly. */
export const SOURCE_RANK: Readonly<Record<StatusSource, number>> = {
    osc: 3, title: 2, heuristic: 1,
}

/** Everything the controller is allowed to do to the outside world. */
export interface ProgressSink {
    /** Pass 0..100, or null to clear. Implementations must bypass Tabby's heuristic. */
    setProgress (value: number | null): void
    setAttention (on: boolean): void       // activity marker
    setColor (color: string | null): void  // tab colour bar
}

export interface Clock {
    now (): number
    setInterval (fn: () => void, ms: number): unknown
    clearInterval (handle: unknown): void
}
```

### 5.1.1 Source precedence — the rule that makes "universal" honest

Not every agent speaks OSC 9;4, and the two most important ones sit on opposite sides
of that line: Claude Code emits it (behind a terminal allowlist, §2.7), Codex CLI never
does and shows no sign of ever doing so (§2.8). A protocol-only plugin would therefore
be blank for half its audience. The plugin accepts status from three sources, which are
**strictly ranked**, and the ranking is a hard invariant, not a heuristic:

> **Higher-ranked sources latch.** Once a tab has received a signal from a source of
> rank *R*, no source of rank **< R** may ever change that tab's state again — not
> even after the higher source goes quiet.

Implemented as a `highestSourceSeen` latch in §5.3 (a generalisation of a boolean
`owned` flag; keep `owned` as a derived getter meaning `highestSourceSeen === 'osc'`).
Three tests pin it down (9.4 #43, #43b, #43c).

Why it must latch rather than merely prefer: an agent that starts speaking OSC 9;4
mid-session — after a config change, a version upgrade, or the user applying the
§2.7 recipe — must take over immediately and permanently. And a user who went to the
trouble of enabling the real protocol must never see a title guess override it.

The three sources in intended use:

| Source | Rank | Default | Serves |
|---|---|---|---|
| `osc` (OSC 9;4) | 3 | always on | Claude Code with the recipe applied; any future compliant agent; anything at all that speaks the protocol |
| `title` (OSC 0/2 + adapter) | 2 | **on** | Codex CLI out of the box; any agent that reports state in its title |
| `heuristic` (output patterns) | 1 | **off** | last resort for agents that do neither |

`title` is on by default because it costs nothing, cannot fire spuriously from ordinary
shell titles (the markers it looks for are distinctive — see §6), and is the only thing
that makes Codex CLI work at all. `heuristic` is off by default, gated on an identified
agent, and additionally disableable per agent (`fallback.agents[<id>] = false`).

### 5.2 State reduction (`src/core/progressState.ts`)

```ts
export function reduceOscEvent (
    previous: AgentProgressState,
    event: OscProgressEvent,
    now: number,
): AgentProgressState
```

Mapping:

| OSC state | progress | resulting `activity` | resulting `percent` |
|---|---|---|---|
| `0` Remove | any | `idle` | `null` |
| `1` Normal | number | `progress` | that number |
| `1` Normal | `null` | `working` | `null` |
| `2` Error | any | `error` | `null` |
| `3` Indeterminate | any | `working` | `null` |
| `4` Paused | number | `paused` | that number |
| `4` Paused | `null` | `paused` | `previous.percent` (may be `null`) |

`source` is always `'osc'`; `at` is `now`. `previous` is used **only** for the
paused-without-percent carry-over.

Also export the initial value:

```ts
export const IDLE_STATE: AgentProgressState = { activity: 'idle', percent: null, at: 0, source: 'osc' }
```

### 5.3 The per-tab controller (`src/core/tabController.ts`)

```ts
export interface TabControllerOptions {
    readonly config: NormalizedConfig     // from src/config/defaults.ts
    readonly sink: ProgressSink
    readonly clock: Clock
}

export class TabProgressController {
    constructor (options: TabControllerOptions)

    /** Highest-ranked source seen so far on this tab, or null if none. */
    get highestSourceSeen (): StatusSource | null
    /** Derived convenience: highestSourceSeen === 'osc'. */
    get owned (): boolean
    get state (): AgentProgressState

    /** Feed parsed OSC 9;4 sequences, in stream order. Always accepted (rank 3). */
    applyOscEvents (events: OscProgressEvent[]): void
    /** Feed a title-derived state (rank 2). Ignored once an OSC signal has been seen. */
    applyTitle (state: AgentProgressState): void
    /** Feed a fallback-heuristic verdict (rank 1). Ignored once title or OSC has been seen. */
    applyFallback (state: AgentProgressState): void
    /** Called when the config object changes. Re-reads everything, restarts the tick. */
    reconfigure (config: NormalizedConfig): void
    /** Stops the tick, clears progress/attention/colour, releases ownership. */
    dispose (): void
}
```

Behaviour:

* **Source latching.** Each `apply*` method carries a `StatusSource`. On entry:
  if `highestSourceSeen !== null` and `SOURCE_RANK[incoming] < SOURCE_RANK[highestSourceSeen]`,
  **return immediately without any side effect**. Otherwise set
  `highestSourceSeen = incoming` (when it outranks the current value) and apply the
  state. The latch is set by the first *valid* signal of that source, including an
  OSC state `0`, and is only cleared by `dispose()`. Implement this as one shared
  private guard, not as three copies — the tests in 9.4 check all three directions.
* **Ticking.** A single interval at `config.tickIntervalMs` (default 400 ms) runs
  **only while `state.activity !== 'idle'`**. Entering `idle` stops the tick and emits
  exactly one `sink.setProgress(null)`. Leaving `idle` starts it and emits immediately
  (do not wait a full tick for the first frame).
* **Value per tick** — computed by an exported pure helper so it can be tested alone:

  ```ts
  export function computeTickValue (
      state: AgentProgressState,
      config: NormalizedConfig,
      tickIndex: number,
  ): number | null
  ```

  | activity | value |
  |---|---|
  | `idle` | `null` |
  | `progress` | `state.percent`, clamped to `[0, 100]` |
  | `working`, style `sweep` | triangle wave over `sweepPeriodMs` between `sweepMin` and `sweepMax` |
  | `working`, style `pulse` | alternates `sweepMin` / `sweepMax` each tick |
  | `working`, style `static` | `indeterminateValue` |
  | `error` | `100` |
  | `paused` | `state.percent ?? indeterminateValue` |

  The triangle wave: with `steps = max(2, round(sweepPeriodMs / tickIntervalMs))`,
  position `tickIndex % (2 * steps)` rises over the first `steps` and falls over the
  second, linearly interpolating `sweepMin`→`sweepMax`. It must be a genuine triangle
  (no discontinuity at the turn other than the peak itself) and must stay within
  `[sweepMin, sweepMax]` inclusive for every `tickIndex`.

* **Jitter (this is required, see F3).** Before handing a value to the sink, if it is
  numerically equal to the previously sent value, send `value - 0.01` instead
  (or `value + 0.01` when `value < 0.01`). Keep the *unjittered* value as "previously
  sent" so the next tick alternates back. Implement as an exported pure helper:

  ```ts
  export function applyJitter (value: number, previouslySent: number | null): number
  ```

  0.01 of a CSS percent is invisible and defeats `distinctUntilChanged`.

* **Attention marker.** `sink.setAttention(true)` when
  `config.attentionOnErrorAndPaused && (activity === 'error' || activity === 'paused')`,
  `false` otherwise. Emit only on change, not every tick.
* **Colour.** When `config.colorizeTab` is on: `error` → `config.colors.error`,
  `paused` → `config.colors.paused`, anything else → `null`. Emit only on change.
  When the option is off, never call `setColor` at all (so the plugin does not fight
  a colour the user set by hand).
* **Stale timeout.** If `config.staleTimeoutMs > 0` and no OSC event has arrived for
  that long while non-idle, transition to `idle`. Default `0` (disabled) — protocol
  fidelity first: `OSC 9;4;2` is supposed to persist until the agent clears it.
* **`dispose()`** must be idempotent, must stop the interval, and must emit
  `setProgress(null)`, `setAttention(false)` and (only if `colorizeTab` was on)
  `setColor(null)`.

### 5.3a Title source (`src/core/titleSource.ts`)

On by default. Turns OSC 0/2 titles into states, delegating all agent-specific
knowledge to the adapters.

```ts
export class TitleSource {
    constructor (config: NormalizedConfig, clock: Clock)
    /**
     * Feed a title seen on this tab, plus the adapter identified for the tab (if any).
     * Returns a state, or null for "no opinion" / "unchanged".
     */
    onTitle (title: string, agent: AgentAdapter | null): AgentProgressState | null
    reset (): void
}
```

Rules:

* If `!config.title.enabled` → always `null`.
* Ask every adapter in the registry, not just the identified one? **No** — ask the
  identified adapter first; if none is identified, ask each adapter's
  `interpretTitle` and accept a result only if **exactly one** adapter returns
  non-`null`. An ambiguous title yields `null`. This lets a distinctive title
  (`[ ! ] Action Required`, a braille spinner) identify the agent by itself, without
  ever letting two adapters fight.
* When an adapter is identified this way, the caller is told via the returned state's
  presence; the decorator records the identification so subsequent titles take the
  fast path.
* Deduplicate: if the resulting `activity` and `percent` are unchanged from the last
  emitted value, return `null`.
* Every state returned carries `source: 'title'`.
* Never throws. An adapter throwing inside `interpretTitle` is caught, that adapter is
  treated as returning `null`, and the throw is logged when `debugLogging` is on.

### 5.4 Fallback heuristic (`src/core/fallbackHeuristic.ts`)

Opt-in, **default off**, and never active on an owned tab.

```ts
export class FallbackHeuristic {
    constructor (config: NormalizedConfig, clock: Clock)
    /** Called for every output chunk (decoded text). Returns a state, or null for "no opinion". */
    onOutput (text: string, agent: AgentAdapter | null): AgentProgressState | null
    /** Called on each tick to expire activity. Returns a state, or null. */
    onTick (agent: AgentAdapter | null): AgentProgressState | null
    reset (): void
}
```

Rules:

* If `!config.fallback.enabled` → always `null`.
* If `agent === null` (no adapter has matched this tab) → always `null`. We do not
  light up the bar for `cat`.
* If `config.fallback.agents[agent.id] === false` → always `null` for that tab.
* Otherwise: any output chunk marks activity and yields
  `{ activity: 'working', percent: null, source: 'fallback' }`. When no output has
  arrived for `config.fallback.activityWindowMs` (default 1500), `onTick` yields
  `{ activity: 'idle', ... }`.
* It must not emit the same activity twice in a row (return `null` when unchanged) so
  the controller is not churned.

### 5.5 The sink and heuristic suppression (`src/tabby/progressSink.ts`)

This is the one place allowed to monkey-patch Tabby, and it must be surgical and
reversible.

```ts
export class TabProgressSink implements ProgressSink {
    constructor (tab: BaseTerminalTabComponent<any>, suppressBuiltIn: boolean)
    setProgress (value: number | null): void
    setAttention (on: boolean): void
    setColor (color: string | null): void
    /** Restores the tab to its original state. Idempotent. */
    release (): void
}
```

Implementation:

* Capture `const original = tab.setProgress.bind(tab)` at construction.
* If `suppressBuiltIn` is true, install an **own property** on the instance:

  ```ts
  const marker = Symbol.for('tabby-ai-progress.patched')
  if (!(tab as any)[marker]) {
      ;(tab as any)[marker] = true
      ;(tab as any).setProgress = (_v: number | null) => { /* built-in heuristic: dropped */ }
  }
  ```

  All of the plugin's own writes go through the captured `original`, never through
  `tab.setProgress`. That way the built-in heuristic (F4), which calls
  `this.setProgress(...)`, hits the no-op while we keep full control.
* `release()` must `delete (tab as any).setProgress` and `delete (tab as any)[marker]`
  (revealing the prototype method again), then call `original(null)`,
  `tab.clearActivity()` and restore `tab.color` to the value captured at construction
  — but only if the plugin ever changed it.
* If `suppressBuiltIn` is false, install no patch; write through `original` anyway and
  accept that the built-in heuristic will fight us. Document that in the settings UI.
* Every call into Tabby is wrapped in `try { } catch { }`: a host API change must
  degrade to "no indicator", never to a thrown error inside the terminal write path.
  Swallowed errors go to the logger when `debugLogging` is on.

### 5.6 The middleware (`src/tabby/progressMiddleware.ts`)

```ts
export class Osc94Middleware extends SessionMiddleware {
    constructor (onChunk: (sequences: OscSequence[], chunk: Buffer) => void, strip: () => boolean)
    feedFromSession (data: Buffer): void
}
```

* Runs the scanner over `data`, invokes `onChunk` with the sequences and the original
  chunk, then calls `super.feedFromSession(strip() ? Buffer.from(stripOsc94(data)) : data)`.
  Dispatching sequences to the progress/title interpreters is the **decorator's** job
  (§5.7), not the middleware's — the middleware stays dumb.
* **Must call `super.feedFromSession` exactly once per input chunk, always** — even
  when `onChunk` throws. Wrap the callback in try/catch. Dropping a chunk here means
  dropping terminal output, which is unacceptable.
* `stripSequences` defaults to **false**: leave the bytes in the stream so other
  consumers (and the user's own `cat`-ing of a log) see them. xterm.js ignores OSC 9;4
  harmlessly.

### 5.7 The decorator (`src/tabby/terminalDecorator.ts`)

```ts
@Injectable()
export class AiProgressDecorator extends TerminalDecorator {
    attach (tab: BaseTerminalTabComponent<any>): void
    detach (tab: BaseTerminalTabComponent<any>): void
}
```

* On `attach`, if `config.store.aiProgress.enabled` is false → do nothing.
* Build one `TabProgressController` + `TabProgressSink` per tab, keyed in a `Map`.
* Attach the middleware to `tab.session` if present, and re-attach on
  `tab.sessionChanged$` (remove the middleware from the old session first, call
  `parser.reset()` and `controller.dispose()` state-wise for the new session — the
  controller is re-created, ownership does not carry across sessions).
* **Fallback feed.** If `session.middleware` is unavailable (missing property or
  `push` throws), subscribe to `tab.binaryOutput$` instead and feed the parser from
  there. Log which feed was chosen when `debugLogging` is on. Never use both.
* Subscribe to `config.changed$` and call `controller.reconfigure(...)`; if
  `enabled` flipped to false, dispose and release everything.
* `detach` must `controller.dispose()`, `sink.release()`, remove the middleware from
  the session, unsubscribe everything, delete the map entry, and call
  `super.detach(terminal)` (the base class cleans `subscribeUntilDetached`
  subscriptions).
* **Per-chunk dispatch.** For each chunk the middleware yields sequences from the
  scanner. Route them: `parseOsc94` hits → `controller.applyOscEvents(...)`;
  `parseOscTitle` hits → `titleSource.onTitle(title, agent)` →
  `controller.applyTitle(...)` when non-null. Then, only if the heuristic is enabled,
  feed the decoded chunk text to the fallback.
* Agent identification: feed decoded chunk text to `AdapterRegistry.identify()` until
  one matches, and also accept an identification produced by an `identifying: true`
  title verdict (§6.1). Remember the result per tab; once identified, do not re-run
  detection on every chunk.
* Decoding chunk text for `detect`/fallback: keep a short rolling tail (last ~4 KB) so
  a signature split across chunks is still found, and decode with `toString('utf8')`.
  Do not accumulate unbounded output.

---

## 6. `src/adapters` — agent identification

```ts
export interface AgentAdapter {
    readonly id: string
    readonly displayName: string
    /** Conservative signature match against recent decoded output. */
    detect (text: string): boolean
    /**
     * Interpret an OSC 0/2 terminal title emitted by this agent.
     * Return null for "this title says nothing about my state" or "not my title".
     * Must be conservative enough that ordinary shell titles never match.
     */
    interpretTitle? (title: string): TitleVerdict | null
}

export interface TitleVerdict {
    readonly activity: AgentActivityState
    /** 0..100 when the title carried a real ratio, else null. */
    readonly percent: number | null
    /** True when the title is distinctive enough to identify the agent on its own. */
    readonly identifying: boolean
}
```

Built-ins (`id` / `displayName`): `claude-code` / `Claude Code`, `codex` / `OpenAI
Codex`, `opencode` / `OpenCode`, `gemini-cli` / `Gemini CLI`, `aider` / `Aider`.

`detect` must be **conservative** — a false positive only affects the optional
fallback heuristic and the label, but noise is still bad. Use anchored,
case-insensitive patterns against distinctive banner/status strings, and require the
match to be on a reasonably short line. Do **not** match a bare word like `claude`
appearing anywhere in output.

### 6.1 The Codex CLI adapter — implement exactly this

This is the one adapter whose rules are fully specified, because it is the one carrying
a real agent with no OSC 9;4 support. All strings below were read out of
`openai/codex` at v0.151.0 (§2.8).

`detect(text)`:
* `>_ OpenAI Codex (` — the TUI banner, or
* `OpenAI Codex v` at the start of a line — the `codex exec` banner, or
* the literal `" to interrupt)"` — the working status line.

`interpretTitle(title)`, applied in this order, first match wins:

| Test on the title | Result |
|---|---|
| starts with `[ ! ] Action Required` or `[ . ] Action Required` | `paused`, `percent: null`, `identifying: true` |
| matches `/\bTasks (\d+)\/(\d+)\b/` with `total > 0` | `progress`, `percent: round(100 * completed / total)` clamped to 0..100, `identifying: true` |
| first non-space character is one of `⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏` | `working`, `null`, `identifying: true` |
| a `\|`-separated segment, trimmed, equals `Working`, `Thinking` or `Starting` (case-sensitive) | `working`, `null`, `identifying: false` |
| a segment equals `Waiting` | `paused`, `null`, `identifying: false` |
| a segment equals `Ready` | `idle`, `null`, `identifying: false` |
| anything else | `null` |

Note the `identifying` column. The braille frames, the `[ ! ] Action Required` prefix
and `Tasks n/m` are distinctive enough to name Codex on sight. The bare run-state words
are **not** — `Ready` is a plausible title for anything — so they only apply once the
tab has already been identified as Codex. `TitleSource` enforces that: a non-identifying
verdict from an unidentified tab is discarded.

⚠️ **Do not match the status header word inside the terminal body.** Codex's status
header defaults to `Working` but is otherwise arbitrary text extracted from the first
bold span of the streamed model reasoning, so `/Working/` against the body is a false
signal. The title is a different, deliberately-formatted channel; matching there is
sound.

For the other four adapters, `detect` is required and `interpretTitle` is optional —
implement it only where a distinctive, verifiable title format is known. **Do not
invent title formats for OpenCode, Gemini CLI or Aider.** An adapter with no
`interpretTitle` is correct and honest; a guessed one produces wrong indicators. Say
in your final message which adapters you gave `interpretTitle` and on what evidence.

```ts
export class AdapterRegistry {
    constructor (adapters: AgentAdapter[])
    /** First adapter whose detect() matches, or null. */
    identify (text: string): AgentAdapter | null
    get (id: string): AgentAdapter | null
    get all (): readonly AgentAdapter[]
}
```

The registry is used for labelling and for gating the fallback heuristic. **The OSC
9;4 path must work with zero adapters registered** — that is the whole point of the
protocol-first design, and there must be a test asserting it.

---

## 7. `src/config` — settings

`ConfigProvider.defaults` (Tabby merges this into `config.store`):

```ts
{
    aiProgress: {
        enabled: true,
        suppressBuiltInDetection: true,
        stripSequences: false,
        tickIntervalMs: 400,
        indeterminateStyle: 'sweep',      // 'sweep' | 'pulse' | 'static'
        indeterminateValue: 35,
        sweepMin: 10,
        sweepMax: 90,
        sweepPeriodMs: 2000,
        attentionOnErrorAndPaused: true,
        colorizeTab: false,
        colors: { error: '#e74c3c', paused: '#f39c12' },
        staleTimeoutMs: 0,                // 0 = disabled
        title: { enabled: true },         // OSC 0/2 title source (rank 2) — see 5.3a
        fallback: {
            enabled: false,
            activityWindowMs: 1500,
            // Per-agent opt-out. Absent key === enabled (when fallback.enabled is on).
            // Keys are AgentAdapter ids: 'claude-code' | 'codex' | 'opencode' | 'gemini-cli' | 'aider'
            agents: {},
        },
        debugLogging: false,
    },
}
```

`normalizeConfig(raw: any): NormalizedConfig` is pure, exported from
`src/config/defaults.ts`, and must:

* fill every missing key from the defaults (including nested `colors` / `fallback`);
* coerce and clamp: `tickIntervalMs` → `[100, 2000]`; `indeterminateValue`,
  `sweepMin`, `sweepMax` → `[0, 100]`; `sweepPeriodMs` → `[200, 30000]`;
  `activityWindowMs` → `[200, 60000]`; `staleTimeoutMs` → `0` or `[1000, 3600000]`;
* if `sweepMin >= sweepMax`, fall back to the default pair `(10, 90)`;
* reject an unknown `indeterminateStyle` back to `'sweep'`;
* accept only `#rgb`/`#rrggbb` colour strings, else use the default colour;
* never throw, whatever it is handed (`null`, `undefined`, a string, an array).

The settings tab (`src/tabby/settingsTab.component.{ts,pug}`) exposes all of the
above with `[(ngModel)]` + `(ngModelChange)='config.save()'`, following the pug style
of the Tabby example plugin (`.form-line` > `.header` > `.title`/`.description`).
Include one short paragraph of help text explaining what OSC 9;4 is and that
`suppressBuiltInDetection` overrides Tabby's own `Progress detection`.

---

## 8. Order of work

The order matters here and is not arbitrary:

1. `src/protocol/oscScanner.ts` first, with its tests green, **before** anything else.
   Every chunk-boundary bug in this project lives here, and it is the only part that
   can be fully verified without a running Tabby. Then `osc94.ts`, then `oscTitle.ts`.
2. `src/config/defaults.ts` next — `NormalizedConfig` is a constructor parameter of
   the controller and the two sources, so its shape must be settled before them.
3. `src/adapters/*` before `src/core/titleSource.ts`, because `TitleSource` consumes
   `AgentAdapter.interpretTitle` and the Codex rules in §6.1 are the concrete case that
   shows whether the interface is right.
4. `src/core/*` — `progressState.ts`, then `tabController.ts` (including the source
   latch), then `titleSource.ts`, then `fallbackHeuristic.ts`.
5. `src/tabby/*` and `src/index.ts` last. These are not unit-tested; they must contain
   no branching logic worth testing. If you find yourself wanting to test something in
   `src/tabby/`, that logic belongs in `src/core/`.

---

## 9. Tests

Runner: **vitest**. Every test file sits next to its module as `<name>.test.ts`.
Tests must use a **fake clock** — an object implementing `Clock` whose `now()` returns
a controllable number and whose `setInterval` records the callback so tests can drive
ticks manually. Do not use real timers, `vi.useFakeTimers()` is acceptable but the
injected `Clock` is preferred and is what the interface exists for.

Coverage target: `src/protocol`, `src/core`, `src/adapters` and `src/config` must all
be exercised. `src/tabby` is not unit-tested.

### 9.1 `oscScanner.test.ts` + `osc94.test.ts` — required cases

Cases 1–17 and 21–33 are end-to-end through `OscScanner` + `parseOsc94` (write a tiny
local helper `feed(scanner, s): OscProgressEvent[]` that pushes and maps through
`parseOsc94`, dropping nulls). Cases 18–20 and 27–31 additionally belong to the
scanner and may assert on `OscSequence` directly.

Helper: `const b = (s: string) => Buffer.from(s, 'latin1')` and write escapes as
`\x1b` / `\x07` explicitly.

1. `\x1b]9;4;0\x07` → one event, state `Remove`, progress `null`.
2. `\x1b]9;4;1;50\x07` → state `Normal`, progress `50`.
3. `\x1b]9;4;2\x07` → `Error`, `null`.
4. `\x1b]9;4;3\x07` → `Indeterminate`, `null`.
5. `\x1b]9;4;4\x07` → `Paused`, `null`.
6. `\x1b]9;4;4;70\x07` → `Paused`, `70`.
7. ST terminator: `\x1b]9;4;1;25\x1b\\` → `Normal`, `25`.
8. Progress `0`: `\x1b]9;4;1;0\x07` → progress `0` (and **not** `null` — `0` is a
   legitimate percentage; assert with `toBe(0)`).
9. Progress `100` → `100`.
10. Progress clamped: `\x1b]9;4;1;150\x07` → `100`.
11. Progress non-numeric: `\x1b]9;4;1;abc\x07` → emitted, `Normal`, progress `null`.
12. Progress fractional: `\x1b]9;4;1;50.5\x07` → progress `null` (state still emitted).
13. Progress negative: `\x1b]9;4;1;-5\x07` → progress `null`.
14. Empty progress field: `\x1b]9;4;1;\x07` → progress `null`.
14b. **Claude Code's literal clear form** `\x1b]9;4;0;\x07` (four parameters, empty
    trailing progress) → exactly one event, state `Remove`, progress `null`. This is
    the byte sequence Claude Code actually emits; if this test is missing, the plugin
    can fail to clear the bar against the single most important real emitter.
14c. Both clear forms are equivalent: `\x1b]9;4;0\x07` and `\x1b]9;4;0;\x07` produce
    identical events.
15. Invalid state `\x1b]9;4;9\x07` → **no events**.
16. Non-canonical state `\x1b]9;4;01\x07` → **no events**.
17. Empty state `\x1b]9;4;\x07` → **no events**.
18. Split across two chunks at every interesting boundary — parametrise over **every**
    split point of `\x1b]9;4;1;42\x07` (i.e. for `i` in `1..len-1`, feed
    `s.slice(0, i)` then `s.slice(i)`) and assert exactly one event with progress `42`
    in each case. This single parametrised test is the most important one in the file.
19. Same, split into three chunks at two arbitrary points, including a split between
    the `\x1b` and the `\\` of an ST terminator.
20. Byte-at-a-time feed of the whole sequence → exactly one event.
21. Leading and trailing garbage: `hello\x1b]9;4;3\x07world` → one event; the parser
    does not care about the surrounding bytes.
22. Two sequences in one chunk: `\x1b]9;4;1;10\x07\x1b]9;4;1;90\x07` → two events, in
    order, `10` then `90`.
23. Interleaved with other OSC codes:
    `\x1b]0;title\x07\x1b]9;4;3\x07\x1b]7;file:///tmp\x07` → exactly one **progress**
    event, and the scanner separately yields the OSC 0 sequence with body `title`
    (assert both — this is the case that proves the two consumers coexist).
24. OSC 9 notification is not confused for us: `\x1b]9;Build finished\x07` → **no
    progress events**. This is the exact form Codex CLI emits, so a regression here
    would light the bar up on every Codex desktop notification.
25. `\x1b]9;12;x\x07` (OSC 9 with a non-4 sub-parameter) → **no events**.
26. Overlapping introducer: `\x1b]\x1b]9;4;3\x07` → one event (the first `ESC ]` is
    abandoned and scanning resumes such that the second is found).
27. Unterminated sequence never emits: feed `\x1b]9;4;1;50` alone → zero events, and
    `pendingLength > 0`.
28. …then feeding `\x07` in the next chunk emits it.
29. Buffer cap: feed `\x1b]9;4;1;` followed by 1000 bytes of `A` with no terminator →
    zero events, `pendingLength` never exceeds `maxPendingBytes`, and a subsequent
    valid, complete sequence in a later chunk **is** parsed correctly (i.e. the parser
    recovered).
30. `reset()` drops pending state: feed a partial sequence, `reset()`, feed the
    remainder → zero events.
31. Binary noise (a 4 KiB `Uint8Array` of pseudo-random bytes with a fixed seed) →
    never throws; whatever it returns, `pendingLength` stays within the cap.
32. UTF-8 safety: a chunk containing multi-byte UTF-8 (e.g. `'привет 🎉'`) around a
    valid sequence → the sequence is found and the multi-byte characters do not
    produce spurious events.
33. A lone `0x9c` byte does **not** terminate a sequence:
    `\x1b]9;4;3\x9c` → zero events, still pending.

### 9.2 `stripOsc94` — required cases

34. Removes a complete sequence, leaves the surrounding bytes byte-identical
    (`expect(Buffer.from(out).toString('latin1')).toBe('helloworld')`).
35. Removes both of two sequences in one chunk.
36. Leaves a chunk with no sequences byte-identical.
37. Leaves a partial/unterminated sequence untouched.
38. Does not remove `\x1b]9;Build finished\x07`.

### 9.3 `progressState.test.ts`

39. Each of the seven rows in the §5.2 mapping table, one test each.
40. `Paused` without progress carries `previous.percent` forward; `Paused` without
    progress when `previous.percent` is `null` yields `null`.
41. `source` is always `'osc'` and `at` equals the passed `now`.

### 9.4 `tabController.test.ts`

Use a recording fake `ProgressSink` (arrays of calls) and a manual `Clock`.

42. Not owned initially; `owned` becomes true after any valid OSC event, including
    state `0`.
43. `applyFallback` changes the state while unowned, and is ignored after ownership.
43b. **Precedence is permanent (§5.1.1):** drive the tab with a heuristic `working`
    state, then deliver one OSC event, then deliver 5 more heuristic states including
    an `idle` — the controller's state must reflect only the OSC event, and
    `state.source` must stay `'osc'`. This is the invariant test for the whole
    multi-source design; it must fail if the latch is removed.
43c. **All three directions of the latch**, one assertion each:
    title beats heuristic; osc beats title; heuristic does **not** beat title; title
    does **not** beat osc. Also assert `highestSourceSeen` after each step, and that
    an equal-rank signal is still accepted (two OSC events in a row both apply).
44. Entering `working` starts ticking and emits a value **immediately**, not after one
    tick interval.
45. Entering `idle` emits exactly one `setProgress(null)` and stops the tick — driving
    10 more ticks produces no further `setProgress` calls.
46. `progress` state with percent 50 emits ~50 on every tick (allow the ±0.01 jitter):
    assert every emitted value satisfies `Math.abs(v - 50) <= 0.01`.
47. **Jitter is real:** with a static `progress` state, no two *consecutive* emitted
    values are `===` equal, over 10 ticks. (This is the F3 guard.)
48. `error` emits ~100 and calls `setAttention(true)` exactly once, not once per tick.
49. Going `error` → `idle` calls `setAttention(false)` exactly once.
50. `colorizeTab: false` → `setColor` is never called at all. `colorizeTab: true` →
    `setColor('#e74c3c')` on error, `setColor(null)` on return to idle.
51. `indeterminateStyle: 'static'` emits `indeterminateValue` (± jitter) every tick.
52. `indeterminateStyle: 'sweep'`: over `2 * sweepPeriodMs / tickIntervalMs` ticks the
    values stay within `[sweepMin, sweepMax]`, reach within 1 of both ends, and the
    sequence rises then falls (assert monotonic runs, not exact numbers).
53. `indeterminateStyle: 'pulse'` alternates between the two ends.
54. `staleTimeoutMs > 0`: advancing the clock past it while `working` transitions to
    `idle` and clears; `staleTimeoutMs === 0` never does.
55. `reconfigure` with a new `tickIntervalMs` restarts the interval with the new
    period (assert the fake clock's `clearInterval` + `setInterval` were called).
56. `dispose()` is idempotent: calling it twice emits `setProgress(null)` at most once
    more and never throws.
57. Applying a batch of events in one `applyOscEvents` call applies them in order and
    the final state reflects the **last** event.
58. `computeTickValue` unit tests for each activity/style combination, called directly.
59. `applyJitter` unit tests: equal → offset by 0.01; not equal → unchanged;
    `value < 0.01` → `+0.01` not negative.

### 9.5 `fallbackHeuristic.test.ts`

60. Disabled → always `null`, whatever the input.
61. Enabled but `agent === null` → always `null`.
61b. Enabled, agent identified, but `fallback.agents['codex'] === false` → always
    `null` for that agent, while a different agent still works.
62. Enabled + identified: first output yields `working`; a second output within the
    window yields `null` (no change); `onTick` after the window yields `idle`.
63. After going idle, new output yields `working` again.
63b. Every state it returns carries `source === 'heuristic'`.

### 9.5a `oscTitle.test.ts` and `titleSource.test.ts`

63c. `parseOscTitle` returns the body for OSC 0 and OSC 2, `null` for OSC 1 and OSC 9.
63d. `parseOscTitle` returns `''` (not `null`) for `\x1b]0;\x07`.
63e. Trailing NULs are trimmed.
63f. `TitleSource` disabled → always `null`.
63g. Unidentified tab + a non-identifying title (`Ready`) → `null`.
63h. Unidentified tab + an identifying title (`[ ! ] Action Required — proj`) → a
    `paused` state with `source === 'title'`.
63i. Identified as Codex + `Ready` → `idle`.
63j. Two adapters both claiming a title → `null` (ambiguity is refused).
63k. An adapter whose `interpretTitle` throws is treated as `null` and does not break
    the others.
63l. Repeating the same title twice → second call returns `null` (dedup).

### 9.5b Codex adapter title rules (§6.1) — one test per row

63m. `⠹ my-project` → `working`, `identifying: true`.
63n. `[ ! ] Action Required | my-project` → `paused`, `identifying: true`.
63o. `[ . ] Action Required | my-project` → `paused` (the blink alternate).
63p. `Tasks 3/12 | my-project` → `progress`, percent `25`.
63q. `Tasks 0/0` → `null` (no division by zero).
63r. `Working | my-project` → `working`, `identifying: false`.
63s. `Ready | my-project` → `idle`, `identifying: false`.
63t. `Waiting | my-project` → `paused`.
63u. `Thinking | my-project` and `Starting | my-project` → `working`.
63v. Ordinary shell titles produce `null`: `~/src/project`, `user@host: ~`,
    `vim README.md`, `npm run build`, `Ready Player One` (substring trap — the segment
    must *equal* `Ready`, not contain it).
63w. Codex `detect` matches `>_ OpenAI Codex (v0.151.0)` and `OpenAI Codex v0.151.0`
    and `Working (3s • esc to interrupt)`, and does **not** match a Claude Code banner.

### 9.6 `builtin.test.ts` / adapters

64. Each built-in adapter matches at least one realistic banner line for its agent and
    does **not** match the other agents' banner lines.
65. No adapter matches ordinary shell output (`ls -la` output, a `git status`, a stack
    trace).
66. `AdapterRegistry.identify` returns `null` on plain text and the right adapter on a
    match; `get(id)` round-trips.

### 9.7 `defaults.test.ts`

67. `normalizeConfig(undefined)`, `normalizeConfig(null)`, `normalizeConfig('x')` and
    `normalizeConfig([])` all return the full default object and do not throw.
68. Out-of-range numbers are clamped at both ends (one test per clamped field).
69. `sweepMin >= sweepMax` falls back to `(10, 90)`.
70. Unknown `indeterminateStyle` falls back to `'sweep'`.
71. Bad colour strings fall back to the defaults; `#abc` and `#aabbcc` are accepted.
72. Partial nested objects (`{ aiProgress: { fallback: { enabled: true } } }`) keep the
    other nested defaults.

---

## 10. Acceptance criteria

Each is a checkable statement, not a wish.

* `docker run --rm --user 1002:1002 -v "$PWD":/w -w /w -e HOME=/tmp node:24 sh -c 'npm ci && npx vitest run'`
  exits 0 with **zero failing tests** and at least 95 test cases.
* `docker run --rm --user 1002:1002 -v "$PWD":/w -w /w -e HOME=/tmp node:24 sh -c 'npm ci && npx tsc --noEmit -p tsconfig.json'`
  exits 0.
* `docker run --rm --user 1002:1002 -v "$PWD":/w -w /w -e HOME=/tmp node:24 sh -c 'npm ci && npm run build'`
  exits 0 and produces `dist/index.js`.
* `dist/index.js` does **not** contain a bundled copy of Angular, rxjs or any
  `tabby-*` package: `grep -c "@angular/core" dist/index.js` finds only the external
  reference, and the file is well under 200 KB.
* `package.json` contains `"keywords": [... "tabby-plugin" ...]`, `"main":
  "dist/index.js"`, `"license": "MIT"`, and lists `dist` in `"files"`.
* `node -e "require('./dist/index.js')"` is **not** a valid check (it needs the host's
  Angular) — do not add it.
* No file under `src/protocol`, `src/core`, `src/adapters` imports from `@angular/*`,
  `tabby-*`, `rxjs`, `fs`, `os`, `path` or `electron`. Verify with a grep and state
  the result in your final message.
* The scanner handles every split point of `\x1b]9;4;1;42\x07` (test 18 above).
* Feeding a `progress` state through the controller for 10 ticks produces no two
  consecutive identical values (test 47).
* The OSC 9;4 path works with an **empty** `AdapterRegistry` (explicit test) — the
  protocol must never depend on knowing which agent is running.
* The source latch holds in all three directions (test 43c).
* A Codex CLI title (`⠹ proj`, `[ ! ] Action Required | proj`, `Tasks 3/12 | proj`)
  produces the right state with no OSC 9;4 present at all, and ordinary shell titles
  produce nothing (tests 63m–63v).
* No secrets, tokens, API keys or absolute paths from this machine anywhere in the
  tree.

---

## 11. How to run things

**Everything runs in Docker.** Nothing may be installed on the host — no `npm i -g`,
no `apt`, no `pip`. Use `--user 1002:1002` on every container that writes into the
mounted directory, or the files become root-owned and the repository is damaged.

Install dependencies (creates `package-lock.json`; commit it):

```bash
docker run --rm --user 1002:1002 -v "$PWD":/w -w /w -e HOME=/tmp node:24 \
  sh -c 'npm install --no-audit --no-fund'
```

Tests:

```bash
docker run --rm --user 1002:1002 -v "$PWD":/w -w /w -e HOME=/tmp node:24 \
  sh -c 'npx vitest run'
```

Type-check:

```bash
docker run --rm --user 1002:1002 -v "$PWD":/w -w /w -e HOME=/tmp node:24 \
  sh -c 'npx tsc --noEmit -p tsconfig.json'
```

Build:

```bash
docker run --rm --user 1002:1002 -v "$PWD":/w -w /w -e HOME=/tmp node:24 \
  sh -c 'npm run build'
```

If `npm install` needs it, `--legacy-peer-deps` is acceptable (the Tabby packages
declare Angular 15 peers). Prefer plain `npm install` first.

---

## 12. Do not touch

* `SPEC.md` — this file. Do not edit it, do not "improve" it, do not append notes.
* `LICENSE`, `.gitignore` — already correct.
* `README.md`, `CHANGELOG.md`, `AGENTS.md` — do not create them (see §3.1).
* Anything outside this repository directory. In particular do not read, write or
  reference anything under `/home/deploy/gitlab/`.
* **Do not run any git command.** No `git add`, no `git commit`, no `git push`, no
  `git checkout`. The reviewer commits.
* Do not publish to npm, do not run `npm publish`, do not add a `prepublishOnly` that
  would publish.
* Do not add telemetry, analytics, network calls, or any runtime dependency that is
  not strictly required. The plugin should have **zero** runtime `dependencies`.
* Do not add a companion web service, TTS, sound files, or Claude Code hook
  installation. Those are the competitor's scope, deliberately not ours.
* Do not change Tabby's global `config.store.terminal.detectProgress` from code.
  Suppression is per-tab only (§5.5).

---

## 13. Permissions

Work without asking questions or waiting for confirmation — in `codex exec` mode
neither is possible, and an attempted question aborts the run with nothing written.

You are permitted to:

* create, edit and delete files anywhere inside this repository;
* create `package.json`, `package-lock.json`, `tsconfig.json`, `vitest.config.ts`,
  `webpack.config.js`, `.github/workflows/ci.yml`;
* run the Docker commands in §11 as many times as needed, including installing npm
  dependencies **inside** the container;
* choose reasonable names for private helpers, and add extra unit tests beyond the
  list in §9.

You are not permitted to install anything on the host, to run git, or to touch
anything listed in §12.

If you hit a fork you cannot resolve from this document, pick the option that is
easier to reverse (usually: the smaller change, the more conservative default, the
extra config flag defaulting to off), implement it, and describe the choice and its
reasoning explicitly in your final message.

In your final message, report: the test count and result, the type-check result, the
build result and `dist/index.js` size, the outcome of the layering grep from §10, and
every place where you deviated from this spec or were unsure.
