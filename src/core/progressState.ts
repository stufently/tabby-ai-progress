import { OscProgressEvent, OscProgressState } from '../protocol/types'
import { AgentProgressState } from './types'

export const IDLE_STATE: AgentProgressState = { activity: 'idle', percent: null, at: 0, source: 'osc' }

export function reduceOscEvent (
    previous: AgentProgressState,
    event: OscProgressEvent,
    now: number,
): AgentProgressState {
    switch (event.state) {
        case OscProgressState.Remove:
            return { activity: 'idle', percent: null, at: now, source: 'osc' }
        case OscProgressState.Normal:
            return event.progress === null
                ? { activity: 'working', percent: null, at: now, source: 'osc' }
                : { activity: 'progress', percent: event.progress, at: now, source: 'osc' }
        case OscProgressState.Error:
            return { activity: 'error', percent: null, at: now, source: 'osc' }
        case OscProgressState.Indeterminate:
            return { activity: 'working', percent: null, at: now, source: 'osc' }
        case OscProgressState.Paused:
            return { activity: 'paused', percent: event.progress ?? previous.percent, at: now, source: 'osc' }
    }
}
