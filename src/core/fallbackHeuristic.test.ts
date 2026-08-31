import { describe, expect, it } from 'vitest'
import { codexAdapter, aiderAdapter } from '../adapters/builtin'
import { normalizeConfig } from '../config/defaults'
import { FallbackHeuristic } from './fallbackHeuristic'
import { ManualClock } from './testUtils'

const make = (raw: any) => {
    const clock = new ManualClock()
    return { clock, source: new FallbackHeuristic(normalizeConfig({ aiProgress: raw }), clock) }
}

describe('FallbackHeuristic', () => {
    it('returns no opinion while disabled', () => {
        const { source } = make({ fallback: { enabled: false } })
        expect(source.onOutput('x', codexAdapter)).toBeNull()
        expect(source.onTick(codexAdapter)).toBeNull()
    })

    it('returns no opinion without an identified agent', () => {
        const { source } = make({ fallback: { enabled: true } })
        expect(source.onOutput('x', null)).toBeNull()
        expect(source.onTick(null)).toBeNull()
    })

    it('honors per-agent opt-outs independently', () => {
        const { source } = make({ fallback: { enabled: true, agents: { codex: false } } })
        expect(source.onOutput('x', codexAdapter)).toBeNull()
        expect(source.onOutput('x', aiderAdapter)?.activity).toBe('working')
    })

    it('deduplicates activity and expires after the activity window', () => {
        const { source, clock } = make({ fallback: { enabled: true, activityWindowMs: 1500 } })
        expect(source.onOutput('first', codexAdapter)).toMatchObject({ activity: 'working', source: 'heuristic' })
        clock.advance(500)
        expect(source.onOutput('second', codexAdapter)).toBeNull()
        clock.advance(1501)
        expect(source.onTick(codexAdapter)).toMatchObject({ activity: 'idle', source: 'heuristic' })
        expect(source.onTick(codexAdapter)).toBeNull()
        expect(source.onOutput('again', codexAdapter)).toMatchObject({ activity: 'working', source: 'heuristic' })
    })
})
