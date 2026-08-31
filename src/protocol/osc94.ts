import { OscSequence } from './oscScanner'
import { OscProgressEvent, OscProgressState } from './types'

const STATES: Readonly<Record<string, OscProgressState>> = {
    '0': OscProgressState.Remove,
    '1': OscProgressState.Normal,
    '2': OscProgressState.Error,
    '3': OscProgressState.Indeterminate,
    '4': OscProgressState.Paused,
}

export function parseOsc94 (seq: OscSequence): OscProgressEvent | null {
    if (seq.code !== 9 || (seq.body !== '4' && !seq.body.startsWith('4;'))) return null
    const fields = seq.body.split(';')
    const stateText = (fields[1] ?? '').replace(/^[ \t]+|[ \t]+$/g, '')
    if (!Object.prototype.hasOwnProperty.call(STATES, stateText)) return null

    const progressText = fields.length > 2
        ? fields[2].replace(/^[ \t]+|[ \t]+$/g, '')
        : null
    const progress = progressText !== null && /^\d{1,3}$/.test(progressText)
        ? Math.min(100, Number(progressText))
        : null
    return { state: STATES[stateText], progress, raw: seq.raw }
}
