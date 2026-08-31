import { describe, expect, it } from 'vitest'
import { OscProgressState } from '../protocol/types'
import { AgentProgressState } from './types'
import { IDLE_STATE, reduceOscEvent } from './progressState'

const previous = (percent: number | null): AgentProgressState => ({ activity: 'progress', percent, at: 1, source: 'title' })

describe('reduceOscEvent', () => {
    it.each([
        [OscProgressState.Remove, 88, 'idle', null],
        [OscProgressState.Normal, 42, 'progress', 42],
        [OscProgressState.Normal, null, 'working', null],
        [OscProgressState.Error, 42, 'error', null],
        [OscProgressState.Indeterminate, 42, 'working', null],
        [OscProgressState.Paused, 42, 'paused', 42],
        [OscProgressState.Paused, null, 'paused', 70],
    ])('maps state %s and progress %s', (state, progress, activity, percent) => {
        expect(reduceOscEvent(previous(70), { state, progress, raw: '' }, 123)).toEqual({ activity, percent, at: 123, source: 'osc' })
    })

    it('carries a null previous percentage when pausing without progress', () => {
        expect(reduceOscEvent(previous(null), { state: OscProgressState.Paused, progress: null, raw: '' }, 5).percent).toBeNull()
    })

    it('exports the specified initial state', () => {
        expect(IDLE_STATE).toEqual({ activity: 'idle', percent: null, at: 0, source: 'osc' })
    })
})
