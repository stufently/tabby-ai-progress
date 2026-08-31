import { describe, expect, it } from 'vitest'
import { normalizeConfig } from '../config/defaults'
import { OscProgressState } from '../protocol/types'
import { ManualClock, RecordingSink } from './testUtils'
import { applyJitter, computeTickValue, TabProgressController } from './tabController'
import { AgentProgressState } from './types'

const event = (state: OscProgressState, progress: number | null = null) => ({ state, progress, raw: '' })
const signal = (source: 'title' | 'heuristic', activity: AgentProgressState['activity'], percent: number | null = null): AgentProgressState => ({ activity, percent, at: 10, source })

function setup (raw: any = {}) {
    const clock = new ManualClock()
    const sink = new RecordingSink()
    const controller = new TabProgressController({ config: normalizeConfig({ aiProgress: raw }), clock, sink })
    return { clock, sink, controller }
}

describe('TabProgressController source ownership', () => {
    it('becomes owned after even an OSC remove event', () => {
        const { controller } = setup()
        expect(controller.owned).toBe(false)
        controller.applyOscEvents([event(OscProgressState.Remove)])
        expect(controller.owned).toBe(true)
    })

    it('accepts fallback before OSC and rejects it permanently after OSC', () => {
        const { controller } = setup()
        controller.applyFallback(signal('heuristic', 'working'))
        expect(controller.state.source).toBe('heuristic')
        controller.applyOscEvents([event(OscProgressState.Error)])
        for (let i = 0; i < 5; i++) controller.applyFallback(signal('heuristic', i === 4 ? 'idle' : 'working'))
        expect(controller.state).toMatchObject({ activity: 'error', source: 'osc' })
    })

    it('enforces every source-rank direction while accepting equal rank', () => {
        const first = setup().controller
        first.applyFallback(signal('heuristic', 'working'))
        first.applyTitle(signal('title', 'paused'))
        expect(first.highestSourceSeen).toBe('title')
        first.applyFallback(signal('heuristic', 'idle'))
        expect(first.state.activity).toBe('paused')

        const second = setup().controller
        second.applyTitle(signal('title', 'working'))
        second.applyOscEvents([event(OscProgressState.Normal, 10)])
        expect(second.highestSourceSeen).toBe('osc')
        second.applyTitle(signal('title', 'idle'))
        expect(second.state.activity).toBe('progress')
        second.applyOscEvents([event(OscProgressState.Normal, 90)])
        expect(second.state.percent).toBe(90)
    })

    it('works with no adapter registry because OSC is direct', () => {
        const { controller } = setup()
        controller.applyOscEvents([event(OscProgressState.Indeterminate)])
        expect(controller.state).toMatchObject({ activity: 'working', source: 'osc' })
    })
})

describe('TabProgressController ticking and effects', () => {
    it('starts ticking and renders immediately when work begins', () => {
        const { controller, sink, clock } = setup()
        controller.applyOscEvents([event(OscProgressState.Indeterminate)])
        expect(sink.progress).toHaveLength(1)
        expect(clock.periods).toEqual([400])
    })

    it('clears once and stops ticks on idle', () => {
        const { controller, sink, clock } = setup()
        controller.applyOscEvents([event(OscProgressState.Indeterminate)])
        controller.applyOscEvents([event(OscProgressState.Remove)])
        expect(sink.progress.filter(value => value === null)).toHaveLength(1)
        const count = sink.progress.length
        clock.tick(10)
        expect(sink.progress).toHaveLength(count)
    })

    it('keeps determinate values within jitter distance and never repeats consecutively', () => {
        const { controller, sink, clock } = setup()
        controller.applyOscEvents([event(OscProgressState.Normal, 50)])
        clock.tick(10)
        const values = sink.progress as number[]
        expect(values.every(value => Math.abs(value - 50) <= 0.011)).toBe(true)
        for (let i = 1; i < values.length; i++) expect(values[i]).not.toBe(values[i - 1])
    })

    it('emits attention only on changes', () => {
        const { controller, sink, clock } = setup()
        controller.applyOscEvents([event(OscProgressState.Error)])
        clock.tick(10)
        expect(sink.attention).toEqual([true])
        controller.applyOscEvents([event(OscProgressState.Remove)])
        expect(sink.attention).toEqual([true, false])
    })

    it('does not touch color when disabled and maps error color when enabled', () => {
        const disabled = setup()
        disabled.controller.applyOscEvents([event(OscProgressState.Error), event(OscProgressState.Remove)])
        expect(disabled.sink.colors).toEqual([])

        const enabled = setup({ colorizeTab: true })
        enabled.controller.applyOscEvents([event(OscProgressState.Error)])
        enabled.controller.applyOscEvents([event(OscProgressState.Remove)])
        expect(enabled.sink.colors).toEqual(['#e74c3c', null])
    })

    it('clears a colour it set when colorizeTab is turned off', () => {
        const { controller, sink } = setup({ colorizeTab: true })
        controller.applyOscEvents([event(OscProgressState.Error)])
        expect(sink.colors).toEqual(['#e74c3c'])
        controller.reconfigure(normalizeConfig({ aiProgress: { colorizeTab: false } }))
        expect(sink.colors).toEqual(['#e74c3c', null])
    })

    it('never sets a colour when colorizeTab was off all along', () => {
        const { controller } = setup()
        controller.applyOscEvents([event(OscProgressState.Error)])
        controller.reconfigure(normalizeConfig({ aiProgress: { colorizeTab: false } }))
        expect(setup().sink.colors).toEqual([])
    })

    it.each([
        ['static', [35, 34.99]],
        ['pulse', [10, 90, 10]],
    ])('renders %s indeterminate style', (style, expected) => {
        const { controller, sink, clock } = setup({ indeterminateStyle: style })
        controller.applyOscEvents([event(OscProgressState.Indeterminate)])
        clock.tick(expected.length - 1)
        expect((sink.progress as number[]).slice(0, expected.length)).toEqual(expected)
    })

    it('sweeps within both endpoints and rises then falls', () => {
        const { controller, sink, clock } = setup({ sweepPeriodMs: 2000, tickIntervalMs: 400 })
        controller.applyOscEvents([event(OscProgressState.Indeterminate)])
        clock.tick(9)
        const values = sink.progress as number[]
        expect(Math.min(...values)).toBeGreaterThanOrEqual(10)
        expect(Math.max(...values)).toBeLessThanOrEqual(90)
        expect(Math.min(...values)).toBeLessThanOrEqual(11)
        expect(Math.max(...values)).toBeGreaterThanOrEqual(89)
        expect(values.slice(0, 6).every((value, i, a) => i === 0 || value >= a[i - 1])).toBe(true)
        expect(values.slice(5).every((value, i, a) => i === 0 || value <= a[i - 1])).toBe(true)
    })

    it('expires stale OSC work only when configured', () => {
        const enabled = setup({ staleTimeoutMs: 1000 })
        enabled.controller.applyOscEvents([event(OscProgressState.Indeterminate)])
        enabled.clock.advance(1000)
        enabled.clock.tick()
        expect(enabled.controller.state.activity).toBe('idle')

        const disabled = setup({ staleTimeoutMs: 0 })
        disabled.controller.applyOscEvents([event(OscProgressState.Indeterminate)])
        disabled.clock.advance(1_000_000)
        disabled.clock.tick()
        expect(disabled.controller.state.activity).toBe('working')
    })

    it('restarts an active interval on reconfigure', () => {
        const { controller, clock } = setup()
        controller.applyOscEvents([event(OscProgressState.Indeterminate)])
        controller.reconfigure(normalizeConfig({ aiProgress: { tickIntervalMs: 900 } }))
        expect(clock.cleared).toHaveLength(1)
        expect(clock.periods).toEqual([400, 900])
    })

    it('runs an attached source-expiry listener from the existing heartbeat', () => {
        const { controller, clock } = setup()
        let calls = 0
        controller.setTickListener(() => { calls++ })
        controller.applyOscEvents([event(OscProgressState.Indeterminate)])
        expect(calls).toBe(0)
        clock.tick(3)
        expect(calls).toBe(3)
        expect(clock.periods).toEqual([400])
    })

    it('disposes idempotently', () => {
        const { controller, sink } = setup()
        controller.applyOscEvents([event(OscProgressState.Error)])
        expect(() => { controller.dispose(); controller.dispose() }).not.toThrow()
        expect(sink.progress.filter(value => value === null)).toHaveLength(1)
    })

    it('applies an OSC batch in order with last event winning', () => {
        const { controller } = setup()
        controller.applyOscEvents([event(OscProgressState.Normal, 25), event(OscProgressState.Error), event(OscProgressState.Remove)])
        expect(controller.state.activity).toBe('idle')
    })
})

describe('pure tick helpers', () => {
    const config = normalizeConfig(undefined)
    it.each([
        ['idle', null, 0, null],
        ['progress', 150, 0, 100],
        ['error', null, 0, 100],
        ['paused', 60, 0, 60],
        ['paused', null, 0, 35],
    ])('computes %s with percent %s', (activity, percent, tick, expected) => {
        expect(computeTickValue({ activity, percent, at: 0, source: 'osc' } as AgentProgressState, config, tick)).toBe(expected)
    })

    it('computes static, pulse, and sweep working values', () => {
        const state = { activity: 'working', percent: null, at: 0, source: 'osc' } as AgentProgressState
        expect(computeTickValue(state, { ...config, indeterminateStyle: 'static' }, 7)).toBe(35)
        expect(computeTickValue(state, { ...config, indeterminateStyle: 'pulse' }, 1)).toBe(90)
        expect(computeTickValue(state, { ...config, indeterminateStyle: 'sweep' }, 0)).toBe(10)
        expect(computeTickValue(state, { ...config, indeterminateStyle: 'sweep' }, 5)).toBe(90)
    })

    it('jitters equality, preserves inequality, and keeps tiny values nonnegative', () => {
        expect(applyJitter(50, 50)).toBe(49.99)
        expect(applyJitter(50, 49)).toBe(50)
        expect(applyJitter(0, 0)).toBe(0.01)
    })
})
