import { describe, expect, it } from 'vitest'
import { AI_PROGRESS_DEFAULTS, normalizeConfig } from './defaults'

describe('normalizeConfig', () => {
    it.each([undefined, null, 'x', []])('returns complete defaults for invalid input %j', input => {
        expect(() => normalizeConfig(input)).not.toThrow()
        expect(normalizeConfig(input)).toEqual(AI_PROGRESS_DEFAULTS)
    })

    it.each([
        ['tickIntervalMs', -1, 100], ['tickIntervalMs', 9999, 2000],
        ['indeterminateValue', -1, 0], ['indeterminateValue', 999, 100],
        ['sweepMin', -1, 0], ['sweepMin', 101, 10],
        ['sweepMax', -1, 90], ['sweepMax', 101, 100],
        ['sweepPeriodMs', 1, 200], ['sweepPeriodMs', 99999, 30000],
        ['staleTimeoutMs', -1, 0], ['staleTimeoutMs', 1, 1000], ['staleTimeoutMs', 9999999, 3600000],
    ])('clamps %s=%s to %s', (field, value, expected) => {
        expect((normalizeConfig({ aiProgress: { [field]: value } }) as any)[field]).toBe(expected)
    })

    it.each([[1, 200], [999999, 60000]])('clamps activityWindowMs=%s to %s', (value, expected) => {
        expect(normalizeConfig({ aiProgress: { fallback: { activityWindowMs: value } } }).fallback.activityWindowMs).toBe(expected)
    })

    it('restores the default sweep range when normalized endpoints do not ascend', () => {
        expect(normalizeConfig({ aiProgress: { sweepMin: 80, sweepMax: 20 } })).toMatchObject({ sweepMin: 10, sweepMax: 90 })
    })

    it('rejects unknown styles', () => {
        expect(normalizeConfig({ aiProgress: { indeterminateStyle: 'rainbow' } }).indeterminateStyle).toBe('sweep')
    })

    it('validates colors and accepts three- and six-digit hex', () => {
        expect(normalizeConfig({ aiProgress: { colors: { error: 'red', paused: '#abcd' } } }).colors).toEqual(AI_PROGRESS_DEFAULTS.colors)
        expect(normalizeConfig({ aiProgress: { colors: { error: '#abc', paused: '#aabbcc' } } }).colors).toEqual({ error: '#abc', paused: '#aabbcc' })
    })

    it('deeply fills defaults around partial nested values', () => {
        const result = normalizeConfig({ aiProgress: { fallback: { enabled: true } } })
        expect(result.fallback).toEqual({ enabled: true, activityWindowMs: 1500, agents: {} })
        expect(result.colors).toEqual(AI_PROGRESS_DEFAULTS.colors)
        expect(result.title).toEqual({ enabled: true })
    })

    it('preserves explicit per-agent fallback opt-outs only as booleans', () => {
        expect(normalizeConfig({ aiProgress: { fallback: { agents: { codex: false, aider: true, bad: 'no' } } } }).fallback.agents).toEqual({ codex: false, aider: true })
    })

    it('coerces numeric settings represented as strings', () => {
        expect(normalizeConfig({ aiProgress: { tickIntervalMs: '750', staleTimeoutMs: '5000' } })).toMatchObject({
            tickIntervalMs: 750,
            staleTimeoutMs: 5000,
        })
    })
})
