import { describe, expect, mock, test } from 'claude-code/testing'

import { TAUNTS } from '../hooks/taunts'

const SCROLL = { offset: 0, bodyRows: 20 }

const PANE = {
  component: 'Pane',
  requestId: 'gpu-lette',
  props: { title: 'GPU-lette!', isFocused: true, bodyColumns: 60, placement: 'dock', scroll: SCROLL, view: {} },
} as const

describe('gpu-lette', () => {
  test('idle machine shows the burn and a spin button', async $ => {
    const ui = await $.ui.mount({ plugin: 'gpu-lette', surface: 'terminal', ...PANE })
    expect(await ui.find({ type: 'Text', text: /GPU-lette!/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Balance/ })).toBeDefined()
    expect(await ui.find({ key: 'spin' })).toBeDefined()
    await ui.unmount()
  })
})

describe('spinning', () => {
  test('a submitted prompt starts a spin and hides SPIN until it lands', async ($, on) => {
    const clock = mock.clock(on)
    let usd = 0
    on('session.usage', () => ({ value: { startedAt: 0, context: {}, rateLimits: [], cost: { usd } } }) as never)
    on('prompt.submit', ($, e) => ({ text: e.text }))

    await $.prompt.submit({ text: 'hello', wait: false, origin: { kind: 'composer' } })
    const ui = await $.ui.mount({ plugin: 'gpu-lette', surface: 'terminal', ...PANE })
    expect(await ui.find({ type: 'Text', text: /spinning/ })).toBeDefined()
    expect(await ui.find({ key: 'spin' })).toBeUndefined()

    usd = 0.42
    await clock.advance(16_000)
    expect(await ui.find({ key: 'spin' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /0\.42|JACKPOT/ })).toBeDefined()
    await ui.unmount()
  })
})

describe('spinner line', () => {
  const SPINNER = {
    component: 'Spinner',
    requestId: 'main',
    props: { word: 'Blanching', message: null, suffix: '…', mode: 'requesting' },
  } as const

  test('a narrow terminal keeps the top row whole and puts the quote beneath it', async ($, on) => {
    const clock = mock.clock(on)
    on('session.usage', () => ({ value: { startedAt: 0, context: {}, rateLimits: [], cost: { usd: 0.5 } } }) as never)
    on('prompt.submit', ($, e) => ({ text: e.text }))
    await $.prompt.submit({ text: 'hello', wait: false, origin: { kind: 'composer' } })
    await clock.advance(11_000)

    const narrow = await $.ui.mount({
      plugin: 'gpu-lette', surface: 'terminal', ...SPINNER, viewport: { columns: 50, rows: 24 },
    })
    expect(await narrow.find({ type: 'Text', text: /Balance/ })).toBeDefined()
    expect(await narrow.find({ key: 'spin' })).toBeDefined()
    const anyTaunt = new RegExp(TAUNTS.map(t => t.slice(0, 20).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|') + '|expert in burning money')
    const quote = await narrow.find({ type: 'Text', text: anyTaunt })
    expect(quote?.text ?? '').not.toMatch(/Balance/)
    expect(quote).toBeDefined()
    await narrow.unmount()
  })
})

describe('resilience', () => {
  test('a failing cost lookup still lets the reels land and the lever come back', async ($, on) => {
    const clock = mock.clock(on)
    on('session.usage', () => ({ deny: 'no ledger here' }) as never)
    on('prompt.submit', ($, e) => ({ text: e.text }))

    await $.prompt.submit({ text: 'hello', wait: false, origin: { kind: 'composer' } })
    await clock.advance(11_000)
    const ui = await $.ui.mount({ plugin: 'gpu-lette', surface: 'terminal', ...PANE })
    expect(await ui.find({ key: 'spin' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /spinning/ })).toBeUndefined()
    await ui.unmount()
  })
})

describe('spinner width', () => {
  const SPINNER = {
    component: 'Spinner',
    requestId: 'main',
    props: { word: 'Blanching', message: null, suffix: '…', mode: 'requesting' },
  } as const
  const cells = (text: string) =>
    [...text].reduce((n, c) => {
      const code = c.codePointAt(0) ?? 0
      if (code === 0x200d || (code >= 0xfe00 && code <= 0xfe0f)) return n
      return n + (code >= 0x1f000 || (code >= 0x2e80 && code <= 0xa4cf) ? 2 : 1)
    }, 0)

  test('the whole line fits the row at every width', async ($, on) => {
    const clock = mock.clock(on)
    on('session.usage', () => ({ value: { startedAt: 0, context: {}, rateLimits: [], cost: { usd: 12.34 } } }) as never)
    on('prompt.submit', ($, e) => ({ text: e.text }))
    await $.prompt.submit({ text: 'hello', wait: false, origin: { kind: 'composer' } })
    await clock.advance(11_000)

    for (const columns of [50, 70, 90, 120, 157]) {
      const ui = await $.ui.mount({ plugin: 'gpu-lette', surface: 'terminal', ...SPINNER, viewport: { columns, rows: 40 } })
      const line = await ui.find({ type: 'Text', text: /^\[ .*\]/ })
      const balance = await ui.find({ type: 'Text', text: /Balance/ })
      const spin = (await ui.find({ key: 'spin' })) ? cells('[ SPIN ]') : 0
      const width = cells(line?.text ?? '') + spin + cells(balance?.text ?? '')
      expect(width).toBeLessThanOrEqual(columns)
      await ui.unmount()
    }
  })
})

describe('quotes Claude writes', () => {
  const answered = { answer: 'done', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' } as const

  test('a new batch adds to the stored quotes, even when this module never loaded them', async ($, on) => {
    const clock = mock.clock(on)
    const kept = Array.from({ length: 40 }, (_, i) => `kept quote number ${i}`)
    let stored: unknown = kept
    on('store.get', () => ({ value: stored }))
    on('store.set', ($, e) => {
      stored = e.value
      return { value: undefined }
    })
    on('ui.toast', () => ({ value: undefined }))
    on('session.usage', () => ({ value: { startedAt: 0, context: {}, rateLimits: [], cost: { usd: 1 } } }) as never)
    on('model.complete', () =>
      ({ value: { isAnswered: true, text: '1. fresh one here\n- "fresh two here."\n99% of you will spin again', usage: {} } }) as never,
    )
    on('turn.complete', ($, e) => ({ text: e.answer }))

    for (let i = 0; i < 3; i += 1) await $.turn.complete(answered as never)
    await clock.settle()

    const saved = stored as string[]
    expect(saved.length).toBe(43)
    expect(saved.slice(0, 40)).toEqual(kept)
    expect(saved.slice(40)).toEqual(['fresh one here', 'fresh two here', '99% of you will spin again'])
  })
})

describe('stuck reels', () => {
  test('/spin answers while turning, then pulls again once the reels land', async ($, on) => {
    const clock = mock.clock(on)
    on('session.usage', () => ({ value: { startedAt: 0, context: {}, rateLimits: [], cost: { usd: 1 } } }) as never)
    on('ui.toast', () => ({ value: undefined }))

    expect((await $.command.run({ command: 'spin', args: '' } as never)).text).toBe('Lever pulled.')
    expect((await $.command.run({ command: 'spin', args: '' } as never)).text).toBe('The reels are still turning.')
    await clock.advance(10_000)
    expect((await $.command.run({ command: 'spin', args: '' } as never)).text).toBe('Lever pulled.')
  })

  test('a spin whose frames stop arriving is called off and the lever comes back', async ($, on) => {
    // A hand-made clock: frame timers (short waits) are refused, longer waits (the watchdog) are held until moved past.
    let now = 0
    const held: { at: number; go: () => void }[] = []
    on('clock.now', () => ({ value: now }))
    on('clock.after', async ($, e) => {
      if (e.ms < 1_000) return { deny: 'no frames' }
      await new Promise<void>(go => held.push({ at: now + e.ms, go }))
      return { value: undefined }
    })
    const advance = async (ms: number) => {
      now += ms
      for (const wait of held.filter(w => w.at <= now)) wait.go()
      for (let i = 0; i < 50; i += 1) await Promise.resolve()
    }
    on('session.usage', () => ({ value: { startedAt: 0, context: {}, rateLimits: [], cost: { usd: 1 } } }) as never)

    expect((await $.command.run({ command: 'spin', args: '' } as never)).text).toBe('Lever pulled.')
    await advance(1_000)
    expect((await $.command.run({ command: 'spin', args: '' } as never)).text).toBe('The reels are still turning.')
    await advance(15_000)
    const ui = await $.ui.mount({ plugin: 'gpu-lette', surface: 'terminal', ...PANE })
    expect(await ui.find({ key: 'spin' })).toBeDefined()
    await ui.unmount()
  })
})

describe('ticket done', () => {
  test('the popup shows what the answer cost, not the session total', async ($, on) => {
    const clock = mock.clock(on)
    let usd = 5
    const toasts: string[] = []
    on('ui.toast', ($, e) => {
      toasts.push(e.text)
      return { value: undefined }
    })
    on('session.usage', () => ({ value: { startedAt: 0, context: {}, rateLimits: [], cost: { usd } } }) as never)
    on('prompt.submit', ($, e) => ({ text: e.text }))
    on('turn.complete', ($, e) => ({ text: e.answer }))

    await $.prompt.submit({ text: 'fix it', wait: false, origin: { kind: 'composer' } })
    usd = 5.75
    await $.turn.complete({ answer: 'done', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' } as never)
    await clock.settle()
    expect(toasts).toContain('✅ Ticket done: this answer burned $0.75')
  })
})

describe('spinner notices', () => {
  test("Claude Code's own spinner message still shows under the machine", async $ => {
    const ui = await $.ui.mount({
      plugin: 'gpu-lette',
      surface: 'terminal',
      component: 'Spinner',
      requestId: 'main',
      props: { word: 'Blanching', message: 'Compacting conversation', suffix: '…', mode: 'requesting' },
      viewport: { columns: 120, rows: 40 },
    })
    expect(await ui.find({ type: 'Text', text: 'Compacting conversation…' })).toBeDefined()
    await ui.unmount()
  })
})

describe('the Claude-written quotes setting', () => {
  const answered = { answer: 'done', durationMs: 1, isAborted: false, turnId: 't', reason: 'answer' } as const

  test('turned off, no model call is ever made', { options: { claudeQuotes: false } }, async ($, on) => {
    const clock = mock.clock(on)
    let calls = 0
    on('model.complete', () => {
      calls += 1
      return { value: { isAnswered: true, text: 'nope', usage: {} } } as never
    })
    on('ui.toast', () => ({ value: undefined }))
    on('session.usage', () => ({ value: { startedAt: 0, context: {}, rateLimits: [], cost: { usd: 1 } } }) as never)
    on('turn.complete', ($, e) => ({ text: e.answer }))

    for (let i = 0; i < 6; i += 1) await $.turn.complete(answered as never)
    await clock.settle()
    expect(calls).toBe(0)
  })
})

describe('when Claude writes quotes', () => {
  test('only finished answers count: interrupted turns never bring the batch forward', async ($, on) => {
    const clock = mock.clock(on)
    let calls = 0
    on('model.complete', () => {
      calls += 1
      return { value: { isAnswered: true, text: 'a fresh one', usage: {} } } as never
    })
    on('store.get', () => ({ value: [] }))
    on('store.set', () => ({ value: undefined }))
    on('ui.toast', () => ({ value: undefined }))
    on('session.usage', () => ({ value: { startedAt: 0, context: {}, rateLimits: [], cost: { usd: 1 } } }) as never)
    on('turn.complete', ($, e) => ({ text: e.answer }))
    const turn = (reason: 'answer' | 'aborted') =>
      $.turn.complete({ answer: '', durationMs: 1, isAborted: reason === 'aborted', turnId: 't', reason } as never)

    for (let i = 0; i < 5; i += 1) await turn('aborted')
    await turn('answer')
    await turn('answer')
    await clock.settle()
    expect(calls).toBe(0)
    await turn('answer')
    await clock.settle()
    expect(calls).toBe(1)
  })
})

describe('the damage per spin', () => {
  test('each spin shows only what was spent since the previous one landed', async ($, on) => {
    const clock = mock.clock(on)
    let usd = 2
    on('session.usage', () => ({ value: { startedAt: 0, context: {}, rateLimits: [], cost: { usd } } }) as never)
    on('ui.toast', () => ({ value: undefined }))
    on('store.get', () => ({ value: [] }))
    const spin = async () => {
      await $.command.run({ command: 'spin', args: '' } as never)
      await clock.advance(10_000)
    }
    const shows = async (pattern: RegExp) => {
      const ui = await $.ui.mount({ plugin: 'gpu-lette', surface: 'terminal', ...PANE })
      const found = await ui.find({ type: 'Text', text: pattern })
      await ui.unmount()
      return found !== undefined
    }

    await spin()
    expect(await shows(/−\$2\.00|JACKPOT/)).toBe(true)
    usd = 2.3
    await spin()
    expect(await shows(/−\$0\.30|JACKPOT/)).toBe(true)
  })
})
