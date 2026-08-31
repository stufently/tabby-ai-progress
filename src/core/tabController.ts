import { NormalizedConfig } from '../config/defaults'
import { OscProgressEvent } from '../protocol/types'
import { IDLE_STATE, reduceOscEvent } from './progressState'
import { AgentProgressState, Clock, ProgressSink, SOURCE_RANK, StatusSource } from './types'

export interface TabControllerOptions {
    readonly config: NormalizedConfig
    readonly sink: ProgressSink
    readonly clock: Clock
}

const clamp = (value: number): number => Math.min(100, Math.max(0, value))

export function computeTickValue (
    state: AgentProgressState,
    config: NormalizedConfig,
    tickIndex: number,
): number | null {
    switch (state.activity) {
        case 'idle': return null
        case 'progress': return clamp(state.percent ?? 0)
        case 'error': return 100
        case 'paused': return clamp(state.percent ?? config.indeterminateValue)
        case 'working': {
            if (config.indeterminateStyle === 'static') return config.indeterminateValue
            if (config.indeterminateStyle === 'pulse') return tickIndex % 2 === 0 ? config.sweepMin : config.sweepMax
            const steps = Math.max(2, Math.round(config.sweepPeriodMs / config.tickIntervalMs))
            const position = ((tickIndex % (2 * steps)) + 2 * steps) % (2 * steps)
            const fraction = position <= steps ? position / steps : (2 * steps - position) / steps
            return config.sweepMin + (config.sweepMax - config.sweepMin) * fraction
        }
    }
}

export function applyJitter (value: number, previouslySent: number | null): number {
    if (value !== previouslySent) return value
    return value < 0.01 ? value + 0.01 : value - 0.01
}

export class TabProgressController {
    private config: NormalizedConfig
    private readonly sink: ProgressSink
    private readonly clock: Clock
    private currentState: AgentProgressState = IDLE_STATE
    private highest: StatusSource | null = null
    private interval: unknown | null = null
    private tickIndex = 0
    private lastSent: number | null = null
    private lastAttention = false
    private lastColor: string | null = null
    private lastOscAt: number | null = null
    private tickListener: (() => void) | null = null
    private disposed = false

    constructor (options: TabControllerOptions) {
        this.config = options.config
        this.sink = options.sink
        this.clock = options.clock
    }

    get highestSourceSeen (): StatusSource | null { return this.highest }
    get owned (): boolean { return this.highest === 'osc' }
    get state (): AgentProgressState { return this.currentState }

    /** Lets a source expire itself on the controller's existing heartbeat. */
    setTickListener (listener: (() => void) | null): void { this.tickListener = listener }

    applyOscEvents (events: OscProgressEvent[]): void {
        if (this.disposed || events.length === 0 || !this.acceptSource('osc')) return
        for (const event of events) {
            const now = this.clock.now()
            this.lastOscAt = now
            this.applyState(reduceOscEvent(this.currentState, event, now))
        }
    }

    applyTitle (state: AgentProgressState): void {
        if (this.disposed || !this.acceptSource('title')) return
        this.applyState({ ...state, source: 'title' })
    }

    applyFallback (state: AgentProgressState): void {
        if (this.disposed || !this.acceptSource('heuristic')) return
        this.applyState({ ...state, source: 'heuristic' })
    }

    reconfigure (config: NormalizedConfig): void {
        if (this.disposed) return
        this.config = config
        if (this.interval !== null) {
            this.stopInterval()
            this.startInterval()
            this.renderTick()
        }
        this.updateEffects()
    }

    dispose (): void {
        if (this.disposed) return
        this.disposed = true
        this.stopInterval()
        this.safe(() => this.sink.setProgress(null))
        this.safe(() => this.sink.setAttention(false))
        if (this.config.colorizeTab) this.safe(() => this.sink.setColor(null))
        this.currentState = { activity: 'idle', percent: null, at: this.clock.now(), source: this.currentState.source }
        this.highest = null
    }

    private acceptSource (incoming: StatusSource): boolean {
        if (this.highest !== null && SOURCE_RANK[incoming] < SOURCE_RANK[this.highest]) return false
        if (this.highest === null || SOURCE_RANK[incoming] > SOURCE_RANK[this.highest]) this.highest = incoming
        return true
    }

    private applyState (state: AgentProgressState): void {
        const wasIdle = this.currentState.activity === 'idle'
        this.currentState = state
        const isIdle = state.activity === 'idle'
        this.updateEffects()

        if (isIdle) {
            if (!wasIdle) {
                this.stopInterval()
                this.lastSent = null
                this.safe(() => this.sink.setProgress(null))
            }
            return
        }
        if (wasIdle || this.interval === null) this.startInterval()
        this.renderTick()
    }

    private startInterval (): void {
        if (this.interval !== null || this.disposed) return
        this.tickIndex = 0
        this.interval = this.clock.setInterval(() => this.onInterval(), this.config.tickIntervalMs)
    }

    private stopInterval (): void {
        if (this.interval === null) return
        this.clock.clearInterval(this.interval)
        this.interval = null
    }

    private onInterval (): void {
        if (this.config.staleTimeoutMs > 0 && this.lastOscAt !== null &&
            this.currentState.activity !== 'idle' &&
            this.clock.now() - this.lastOscAt >= this.config.staleTimeoutMs) {
            this.applyState({ activity: 'idle', percent: null, at: this.clock.now(), source: this.currentState.source })
            return
        }
        try { this.tickListener?.() } catch {
            if (this.config.debugLogging) console.debug('[tabby-ai-progress] tick listener failed')
        }
        if (this.currentState.activity === 'idle') return
        this.renderTick()
    }

    private renderTick (): void {
        const value = computeTickValue(this.currentState, this.config, this.tickIndex++)
        if (value === null) return
        const emitted = applyJitter(value, this.lastSent)
        this.safe(() => this.sink.setProgress(emitted))
        // Retaining the actual sink value makes static heartbeats alternate base/jitter.
        this.lastSent = emitted
    }

    private updateEffects (): void {
        const attention = this.config.attentionOnErrorAndPaused &&
            (this.currentState.activity === 'error' || this.currentState.activity === 'paused')
        if (attention !== this.lastAttention) {
            this.lastAttention = attention
            this.safe(() => this.sink.setAttention(attention))
        }
        if (!this.config.colorizeTab) {
            // Turning colorizeTab off must clear a colour we previously set, otherwise
            // an error/paused tint sticks until the tab is closed. Only clear a colour
            // that is ours: lastColor is null unless we set one.
            if (this.lastColor !== null) {
                this.lastColor = null
                this.safe(() => this.sink.setColor(null))
            }
            return
        }
        const color = this.currentState.activity === 'error'
            ? this.config.colors.error
            : this.currentState.activity === 'paused'
                ? this.config.colors.paused
                : null
        if (color !== this.lastColor) {
            this.lastColor = color
            this.safe(() => this.sink.setColor(color))
        }
    }

    private safe (operation: () => void): void {
        try { operation() } catch {
            if (this.config.debugLogging) console.debug('[tabby-ai-progress] progress sink call failed')
        }
    }
}
