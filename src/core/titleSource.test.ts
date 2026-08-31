import { describe, expect, it } from 'vitest'
import { codexAdapter } from '../adapters/builtin'
import { AgentAdapter } from '../adapters/types'
import { normalizeConfig } from '../config/defaults'
import { ManualClock } from './testUtils'
import { TitleSource } from './titleSource'

describe('TitleSource', () => {
    it('returns no opinion while disabled', () => {
        const source = new TitleSource(normalizeConfig({ aiProgress: { title: { enabled: false } } }), new ManualClock(), [codexAdapter])
        expect(source.onTitle('⠹ project', null)).toBeNull()
    })

    it('rejects non-identifying titles on an unidentified tab', () => {
        const source = new TitleSource(normalizeConfig(undefined), new ManualClock(), [codexAdapter])
        expect(source.onTitle('Ready', null)).toBeNull()
    })

    // The Codex adapter reports idle for any unmatched title so the bar clears when
    // Codex finishes (its default title drops to a bare project name). This must not
    // leak into tabs that are not Codex: on an unidentified tab an ordinary shell
    // title has to stay "no opinion".
    it.each(['~/src/project', 'user@host: ~', 'vim README.md', 'my-project'])(
        'stays silent on shell title %j for an unidentified tab', title => {
            const source = new TitleSource(normalizeConfig(undefined), new ManualClock(), [codexAdapter])
            expect(source.onTitle(title, null)).toBeNull()
            expect(source.identifiedAgent).toBeNull()
        },
    )

    it('clears to idle once Codex is identified and its title loses the spinner', () => {
        const source = new TitleSource(normalizeConfig(undefined), new ManualClock(), [codexAdapter])
        expect(source.onTitle('⠹ my-project', null)).toMatchObject({ activity: 'working' })
        expect(source.onTitle('my-project', codexAdapter)).toMatchObject({ activity: 'idle', source: 'title' })
    })

    it('accepts an identifying Codex title and exposes the identification', () => {
        const source = new TitleSource(normalizeConfig(undefined), new ManualClock(), [codexAdapter])
        expect(source.onTitle('[ ! ] Action Required | proj', null)).toMatchObject({ activity: 'paused', source: 'title' })
        expect(source.identifiedAgent).toBe(codexAdapter)
    })

    it('uses non-identifying verdicts after Codex is identified', () => {
        const source = new TitleSource(normalizeConfig(undefined), new ManualClock(), [codexAdapter])
        expect(source.onTitle('Ready', codexAdapter)).toMatchObject({ activity: 'idle', source: 'title' })
    })

    it('refuses ambiguity between two identifying adapters', () => {
        const claiming = (id: string): AgentAdapter => ({
            id, displayName: id, detect: () => false,
            interpretTitle: () => ({ activity: 'working', percent: null, identifying: true }),
        })
        const source = new TitleSource(normalizeConfig(undefined), new ManualClock(), [claiming('one'), claiming('two')])
        expect(source.onTitle('claim', null)).toBeNull()
    })

    it('isolates a throwing adapter and lets one safe claimant win', () => {
        const throwing: AgentAdapter = { id: 'bad', displayName: 'bad', detect: () => false, interpretTitle: () => { throw new Error('boom') } }
        const source = new TitleSource(normalizeConfig(undefined), new ManualClock(), [throwing, codexAdapter])
        expect(source.onTitle('⠹ proj', null)).toMatchObject({ activity: 'working' })
    })

    it('deduplicates repeated activity and percentage', () => {
        const source = new TitleSource(normalizeConfig(undefined), new ManualClock(), [codexAdapter])
        expect(source.onTitle('⠹ proj', null)).not.toBeNull()
        expect(source.onTitle('⠹ proj', codexAdapter)).toBeNull()
    })

    it('resets deduplication and identification', () => {
        const source = new TitleSource(normalizeConfig(undefined), new ManualClock(), [codexAdapter])
        source.onTitle('⠹ proj', null)
        source.reset()
        expect(source.identifiedAgent).toBeNull()
        expect(source.onTitle('⠹ proj', null)).not.toBeNull()
    })
})
