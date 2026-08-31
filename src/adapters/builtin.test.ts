import { describe, expect, it } from 'vitest'
import { BUILTIN_ADAPTERS, codexAdapter } from './builtin'
import { AdapterRegistry } from './registry'

const banners: Record<string, string> = {
    'claude-code': 'Claude Code v2.1.251',
    codex: '>_ OpenAI Codex (v0.151.0)',
    opencode: 'OpenCode v1.2.3',
    'gemini-cli': 'Gemini CLI v0.9.0',
    aider: 'Aider v0.86.1',
}

describe('built-in adapter detection', () => {
    it.each(BUILTIN_ADAPTERS)('$id detects only its realistic banner', adapter => {
        expect(adapter.detect(banners[adapter.id])).toBe(true)
        for (const [id, banner] of Object.entries(banners)) {
            if (id !== adapter.id) expect(adapter.detect(banner)).toBe(false)
        }
    })

    it.each([
        '$ ls -la\ndrwxr-xr-x  src',
        'On branch main\nnothing to commit, working tree clean',
        'Error: Ready Player One\n    at main (index.js:1:1)',
    ])('does not match ordinary shell output', text => {
        expect(BUILTIN_ADAPTERS.some(adapter => adapter.detect(text))).toBe(false)
    })

    it('registry identifies and retrieves adapters', () => {
        const registry = new AdapterRegistry(BUILTIN_ADAPTERS)
        expect(registry.identify('plain text')).toBeNull()
        expect(registry.identify(banners.codex)?.id).toBe('codex')
        expect(registry.get('codex')).toBe(codexAdapter)
        expect(registry.get('missing')).toBeNull()
        expect(registry.all).toHaveLength(5)
    })
})

describe('Codex adapter titles', () => {
    it.each([
        ['⠹ my-project', 'working', null, true],
        ['[ ! ] Action Required | my-project', 'paused', null, true],
        ['[ . ] Action Required | my-project', 'paused', null, true],
        ['Tasks 3/12 | my-project', 'progress', 25, true],
        ['Working | my-project', 'working', null, false],
        ['Ready | my-project', 'idle', null, false],
        ['Waiting | my-project', 'paused', null, false],
        ['Thinking | my-project', 'working', null, false],
        ['Starting | my-project', 'working', null, false],
    ])('interprets %j', (title, activity, percent, identifying) => {
        expect(codexAdapter.interpretTitle?.(title)).toEqual({ activity, percent, identifying })
    })

    it('rejects a zero-total task ratio', () => {
        expect(codexAdapter.interpretTitle?.('Tasks 0/0')).toEqual({
            activity: 'idle', percent: null, identifying: false,
        })
    })

    it('reads a bare project-name title as idle, non-identifying', () => {
        // Codex's default title config leaves just "<project>" once it stops working.
        expect(codexAdapter.interpretTitle?.('my-project')).toEqual({
            activity: 'idle', percent: null, identifying: false,
        })
    })

    it('recognizes a UTF-8 spinner preserved through the byte scanner as Latin-1', () => {
        const bytePreservingTitle = Buffer.from('⠹ my-project', 'utf8').toString('latin1')
        expect(codexAdapter.interpretTitle?.(bytePreservingTitle)).toEqual({
            activity: 'working', percent: null, identifying: true,
        })
    })

    // An ordinary shell title must never be *identifying* — that is the property that
    // keeps the title source from claiming tabs that are not running Codex. It may
    // report idle, which TitleSource then discards for an unidentified tab.
    it.each(['~/src/project', 'user@host: ~', 'vim README.md', 'npm run build', 'Ready Player One'])(
        'never treats ordinary shell title %j as identifying or active', title => {
            const verdict = codexAdapter.interpretTitle?.(title)
            expect(verdict).toEqual({ activity: 'idle', percent: null, identifying: false })
        },
    )

    it.each([
        '>_ OpenAI Codex (v0.151.0)',
        'OpenAI Codex v0.151.0',
        'Working (3s • esc to interrupt)',
    ])('detects Codex output anchor %j', text => expect(codexAdapter.detect(text)).toBe(true))

    it('does not detect a Claude Code banner', () => {
        expect(codexAdapter.detect('Claude Code v2.1.251')).toBe(false)
    })

    it('does not identify Codex from an anchor buried in an unreasonably long line', () => {
        expect(codexAdapter.detect('x'.repeat(300) + ' to interrupt)')).toBe(false)
    })
})
