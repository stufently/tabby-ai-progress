import { OscSequence } from './oscScanner'

export function parseOscTitle (seq: OscSequence): string | null {
    if (seq.code !== 0 && seq.code !== 2) return null
    return seq.body.replace(/\0+$/g, '')
}
