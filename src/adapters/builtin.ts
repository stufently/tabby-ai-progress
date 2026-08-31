import { AgentAdapter, TitleVerdict } from './types'

const CODEX_SPINNERS = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏'
const CODEX_SPINNER_FRAMES = [...CODEX_SPINNERS]
const CODEX_SPINNER_LATIN1 = CODEX_SPINNER_FRAMES.map(frame => Buffer.from(frame, 'utf8').toString('latin1'))

function matchesShortLine (text: string, pattern: RegExp): boolean {
    return text.split(/\r?\n/).some(line => line.length <= 200 && pattern.test(line))
}

export const claudeCodeAdapter: AgentAdapter = {
    id: 'claude-code',
    displayName: 'Claude Code',
    detect: text => matchesShortLine(text, /^\s*Claude Code(?:\s+v?[\d.]+)?\s*$/i),
}

export const codexAdapter: AgentAdapter = {
    id: 'codex',
    displayName: 'OpenAI Codex',
    detect: text => matchesShortLine(text, /^\s*>_ OpenAI Codex \(/i) ||
        matchesShortLine(text, /^OpenAI Codex v/i) ||
        matchesShortLine(text, / to interrupt\)/),
    interpretTitle: (title: string): TitleVerdict | null => {
        if (title.startsWith('[ ! ] Action Required') || title.startsWith('[ . ] Action Required')) {
            return { activity: 'paused', percent: null, identifying: true }
        }
        const tasks = /\bTasks (\d+)\/(\d+)\b/.exec(title)
        if (tasks) {
            const completed = Number(tasks[1])
            const total = Number(tasks[2])
            // A zero total is degenerate: fall through to the rules below rather than
            // dividing by zero or claiming to identify Codex on a nonsense ratio.
            if (total > 0) {
                return {
                    activity: 'progress',
                    percent: Math.min(100, Math.max(0, Math.round(100 * completed / total))),
                    identifying: true,
                }
            }
        }
        const trimmed = title.trimStart()
        const first = trimmed[0]
        if ((first && CODEX_SPINNERS.includes(first)) || CODEX_SPINNER_LATIN1.some(frame => trimmed.startsWith(frame))) {
            return { activity: 'working', percent: null, identifying: true }
        }
        const segments = title.split('|').map(segment => segment.trim())
        if (segments.some(segment => segment === 'Working' || segment === 'Thinking' || segment === 'Starting')) {
            return { activity: 'working', percent: null, identifying: false }
        }
        if (segments.includes('Waiting')) return { activity: 'paused', percent: null, identifying: false }
        if (segments.includes('Ready')) return { activity: 'idle', percent: null, identifying: false }
        // Codex's DEFAULT title config is ["activity", "project-name"]: while it works the
        // title is "<spinner> <project>", and when it finishes the spinner item yields
        // nothing, leaving a bare "<project>". So for a tab already identified as Codex,
        // a title with no working/attention marker means idle — without this the bar would
        // sweep forever after Codex finished, which is the common case, not an edge case.
        // `identifying: false` is what keeps this safe: TitleSource discards non-identifying
        // verdicts for tabs that have not already been identified as Codex, so an ordinary
        // shell title never reaches here.
        return { activity: 'idle', percent: null, identifying: false }
    },
}

export const openCodeAdapter: AgentAdapter = {
    id: 'opencode',
    displayName: 'OpenCode',
    detect: text => matchesShortLine(text, /^\s*OpenCode(?:\s+v?[\d.]+)?\s*$/i),
}

export const geminiCliAdapter: AgentAdapter = {
    id: 'gemini-cli',
    displayName: 'Gemini CLI',
    detect: text => matchesShortLine(text, /^\s*Gemini CLI(?:\s+v?[\d.]+)?\s*$/i),
}

export const aiderAdapter: AgentAdapter = {
    id: 'aider',
    displayName: 'Aider',
    detect: text => matchesShortLine(text, /^\s*Aider v\d+(?:\.\d+)+(?:\s.*)?$/i),
}

export const BUILTIN_ADAPTERS: readonly AgentAdapter[] = [
    claudeCodeAdapter,
    codexAdapter,
    openCodeAdapter,
    geminiCliAdapter,
    aiderAdapter,
]
