export type IndeterminateStyle = 'sweep' | 'pulse' | 'static'

export interface NormalizedConfig {
    readonly enabled: boolean
    readonly suppressBuiltInDetection: boolean
    readonly stripSequences: boolean
    readonly tickIntervalMs: number
    readonly indeterminateStyle: IndeterminateStyle
    readonly indeterminateValue: number
    readonly sweepMin: number
    readonly sweepMax: number
    readonly sweepPeriodMs: number
    readonly attentionOnErrorAndPaused: boolean
    readonly colorizeTab: boolean
    readonly colors: { readonly error: string, readonly paused: string }
    readonly staleTimeoutMs: number
    readonly title: { readonly enabled: boolean }
    readonly fallback: {
        readonly enabled: boolean
        readonly activityWindowMs: number
        readonly agents: Readonly<Record<string, boolean>>
    }
    readonly debugLogging: boolean
}

export const AI_PROGRESS_DEFAULTS: NormalizedConfig = {
    enabled: true,
    suppressBuiltInDetection: true,
    stripSequences: false,
    tickIntervalMs: 400,
    indeterminateStyle: 'sweep',
    indeterminateValue: 35,
    sweepMin: 10,
    sweepMax: 90,
    sweepPeriodMs: 2000,
    attentionOnErrorAndPaused: true,
    colorizeTab: false,
    colors: { error: '#e74c3c', paused: '#f39c12' },
    staleTimeoutMs: 0,
    title: { enabled: true },
    fallback: { enabled: false, activityWindowMs: 1500, agents: {} },
    debugLogging: false,
}

const objectOrNull = (value: unknown): Record<string, unknown> | null => (
    value !== null && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : null
)

function numberInRange (value: unknown, fallback: number, minimum: number, maximum: number): number {
    const numeric = typeof value === 'number'
        ? value
        : typeof value === 'string' && value.trim() !== ''
            ? Number(value)
            : Number.NaN
    return Number.isFinite(numeric)
        ? Math.min(maximum, Math.max(minimum, numeric))
        : fallback
}

function booleanOr (value: unknown, fallback: boolean): boolean {
    return typeof value === 'boolean' ? value : fallback
}

function colorOr (value: unknown, fallback: string): string {
    return typeof value === 'string' && /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value)
        ? value
        : fallback
}

export function normalizeConfig (raw: unknown): NormalizedConfig {
    try {
        const outer = objectOrNull(raw)
        if (!outer) return cloneDefaults()
        const source = objectOrNull(outer.aiProgress) ?? outer
        const colors = objectOrNull(source.colors) ?? {}
        const title = objectOrNull(source.title) ?? {}
        const fallback = objectOrNull(source.fallback) ?? {}
        const rawAgents = objectOrNull(fallback.agents) ?? {}
        const agents: Record<string, boolean> = {}
        for (const [id, value] of Object.entries(rawAgents)) {
            if (typeof value === 'boolean') agents[id] = value
        }

        let sweepMin = numberInRange(source.sweepMin, AI_PROGRESS_DEFAULTS.sweepMin, 0, 100)
        let sweepMax = numberInRange(source.sweepMax, AI_PROGRESS_DEFAULTS.sweepMax, 0, 100)
        if (sweepMin >= sweepMax) {
            sweepMin = AI_PROGRESS_DEFAULTS.sweepMin
            sweepMax = AI_PROGRESS_DEFAULTS.sweepMax
        }
        const staleRaw = typeof source.staleTimeoutMs === 'string'
            ? Number(source.staleTimeoutMs)
            : source.staleTimeoutMs
        const staleTimeoutMs = typeof staleRaw === 'number' && Number.isFinite(staleRaw) && staleRaw > 0
            ? Math.min(3_600_000, Math.max(1000, staleRaw))
            : 0
        const style = source.indeterminateStyle

        return {
            enabled: booleanOr(source.enabled, AI_PROGRESS_DEFAULTS.enabled),
            suppressBuiltInDetection: booleanOr(source.suppressBuiltInDetection, AI_PROGRESS_DEFAULTS.suppressBuiltInDetection),
            stripSequences: booleanOr(source.stripSequences, AI_PROGRESS_DEFAULTS.stripSequences),
            tickIntervalMs: numberInRange(source.tickIntervalMs, AI_PROGRESS_DEFAULTS.tickIntervalMs, 100, 2000),
            indeterminateStyle: style === 'pulse' || style === 'static' || style === 'sweep' ? style : 'sweep',
            indeterminateValue: numberInRange(source.indeterminateValue, AI_PROGRESS_DEFAULTS.indeterminateValue, 0, 100),
            sweepMin,
            sweepMax,
            sweepPeriodMs: numberInRange(source.sweepPeriodMs, AI_PROGRESS_DEFAULTS.sweepPeriodMs, 200, 30000),
            attentionOnErrorAndPaused: booleanOr(source.attentionOnErrorAndPaused, AI_PROGRESS_DEFAULTS.attentionOnErrorAndPaused),
            colorizeTab: booleanOr(source.colorizeTab, AI_PROGRESS_DEFAULTS.colorizeTab),
            colors: {
                error: colorOr(colors.error, AI_PROGRESS_DEFAULTS.colors.error),
                paused: colorOr(colors.paused, AI_PROGRESS_DEFAULTS.colors.paused),
            },
            staleTimeoutMs,
            title: { enabled: booleanOr(title.enabled, AI_PROGRESS_DEFAULTS.title.enabled) },
            fallback: {
                enabled: booleanOr(fallback.enabled, AI_PROGRESS_DEFAULTS.fallback.enabled),
                activityWindowMs: numberInRange(fallback.activityWindowMs, AI_PROGRESS_DEFAULTS.fallback.activityWindowMs, 200, 60000),
                agents,
            },
            debugLogging: booleanOr(source.debugLogging, AI_PROGRESS_DEFAULTS.debugLogging),
        }
    } catch {
        return cloneDefaults()
    }
}

function cloneDefaults (): NormalizedConfig {
    return {
        ...AI_PROGRESS_DEFAULTS,
        colors: { ...AI_PROGRESS_DEFAULTS.colors },
        title: { ...AI_PROGRESS_DEFAULTS.title },
        fallback: { ...AI_PROGRESS_DEFAULTS.fallback, agents: {} },
    }
}
