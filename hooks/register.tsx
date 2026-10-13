import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Machine } from '../types'
import { GENERATE_COUNT, GENERATE_EVERY_TURNS, GENERATED_MAX, TAUNT_EMOJIS, TAUNTS } from './taunts'

const PANE = 'gpu-lette'
// One code point each: joined emoji such as 7️⃣ draw at uneven widths and shift the line.
const SYMBOLS = ['🍒', '🍋', '🔔', '💎', '🍀', '🍉', '👑']
// A spin runs 9s: frames start fast and stretch out towards the end.
const SPIN_MS = 9_000
// Cells a word-wrapped row may leave empty at its end, at most.
const LONG_WORD = 14
// How long past its time a spin may run before it is called off.
const GRACE_MS = 5_000
const FAST_FRAME_MS = 40
const SLOW_FRAME_MS = 650
// Reels lock in one by one, at these fractions of the spin.
const REEL_STOPS = [0.7, 0.85, 1]
const JACKPOT_ODDS = 0.05
const GENERATED_KEY = 'generated-taunts'

const initial: Machine = {
  phase: 'idle',
  // Three different symbols: a machine at rest must not look like a jackpot.
  reels: [0, 4, 6],
  stopped: 0,
  lastSpendUsd: 0,
  landedAtUsd: 0,
  sessionUsd: 0,
  askedAtUsd: 0,
  lastAnswerUsd: 0,
  isJackpot: false,
  taunt: '',
  isTicketDone: false,
}
const machine = atom({ plugin: 'gpu-lette', key: 'machine' } as const, initial)

const pick = () => Math.floor(Math.random() * SYMBOLS.length)
const usd = (n: number) => `$${n.toFixed(2)}`
const symbol = (i: number) => SYMBOLS[i] ?? '?'
const any = (list: string[]) => list[Math.floor(Math.random() * list.length)] ?? ''
const taunt = () => `${any(TAUNT_EMOJIS)} ${any([...TAUNTS, ...generated])} ${any(TAUNT_EMOJIS)}`

// The symbols a spin lands on, chosen up front: three of a kind exactly 5% of the time.
function outcome() {
  if (Math.random() < JACKPOT_ODDS) {
    const s = pick()
    return [s, s, s]
  }
  const reels = [pick(), pick(), pick()]
  while (reels.every(r => r === reels[0])) reels[2] = pick()
  return reels
}

let spinId = 0
let spinStartedAt = 0
let lastKnownUsd = 0
// Timers die with the module on a reload, so whether a spin runs is the module's to say, not $.state's.
let isSpinning = false
// Taunts Claude wrote, as last read from $.store; loaded on first use, since a reload starts the module afresh.
let generated: string[] = []
let generatedLoad: Promise<void> | null = null
let turnsSinceGenerated = 0
let isGenerating = false
// The docked pane's body width as last drawn: the spinner line gets the columns beside it.
let paneColumns = 0

async function storedGenerated($: EngineInterface) {
  const kept = await $.store.get(GENERATED_KEY)
  return Array.isArray(kept) ? kept.filter((t): t is string => typeof t === 'string') : []
}

// Reads Claude's taunts once per module; a failed read is tried again next time.
function loadGenerated($: EngineInterface) {
  generatedLoad ??= storedGenerated($).then(
    kept => {
      generated = kept
    },
    () => {
      generatedLoad = null
    },
  )
  return generatedLoad
}

// Who the next batch of taunts is written as: a random voice keeps them varied.
const VOICES = [
  'a smooth Las Vegas casino host',
  'an overexcited sports commentator',
  'a mystic fortune teller',
  'a crypto bro on a podcast',
  'a motivational speaker',
  'a pirate captain',
  'a shady used-car salesman',
  'a nature documentary narrator',
]

// `n` distinct items of `list`, each equally likely (a partial Fisher-Yates shuffle).
function sample<T>(list: readonly T[], n: number) {
  const pool = [...list]
  const count = Math.min(n, pool.length)
  for (let i = 0; i < count; i += 1) {
    const j = i + Math.floor(Math.random() * (pool.length - i))
    ;[pool[i], pool[j]] = [pool[j] as T, pool[i] as T]
  }
  return pool.slice(0, count)
}

// One line of Haiku's reply as a taunt: list markers ("1.", "2)", "-", "•") and wrapping quotes go,
// a full stop at the end goes, and a quote's own leading digits ("99% of…") stay.
function cleanLine(line: string) {
  return line
    .trim()
    .replace(/^(?:[-*•]|\d{1,2}[.)])\s+/, '')
    .replace(/^["'“]+|["'”]+$/g, '')
    .replace(/[.\s]+$/, '')
}

// Asks a small model for a few new taunts. It sees none of the person's input: only examples and a random voice.
async function generateTaunts($: EngineInterface) {
  if (isGenerating) return
  isGenerating = true
  try {
    const r = await $.model.complete({
      model: 'haiku',
      maxTokens: 400,
      timeoutMs: 20_000,
      system:
        'You write one-line taunts for a joke slot machine that shows a developer how much money their AI coding session burns. ' +
        'Tone: a cheeky casino host egging them on to keep spending. Under 70 characters each, no emojis, no quotes, no numbering, no full stop at the end.',
      prompt:
        `Here are examples of the style:\n${sample(TAUNTS, 5).join('\n')}\n\n` +
        `This time, speak as ${any(VOICES)}.\n\n` +
        `Write ${GENERATE_COUNT} new taunts, one per line, nothing else.`,
    })
    if (!r.isAnswered) return
    const fresh = r.text
      .split('\n')
      .map(cleanLine)
      .filter(line => line.length > 3 && line.length <= 90)
      .slice(0, GENERATE_COUNT)
    if (fresh.length === 0) return
    // Add to what the store holds now, never to this module's copy, which may not have loaded.
    generated = [...(await storedGenerated($)), ...fresh].slice(-GENERATED_MAX)
    await $.store.set(GENERATED_KEY, generated)
  } catch {
    // No new taunts this time; the machine keeps the ones it has.
  } finally {
    isGenerating = false
  }
}

async function sessionUsd($: EngineInterface) {
  try {
    lastKnownUsd = (await $.session.usage()).cost?.usd ?? lastKnownUsd
  } catch {
    // Keep showing the last figure rather than failing the spin.
  }
  return lastKnownUsd
}

// Starts a spin; false when one is already turning.
async function startSpin($: EngineInterface) {
  const startedAt = await $.clock.now()
  // A spin that never landed (a timer refused, a failed write) stops blocking the lever after a grace period.
  if (isSpinning && startedAt - spinStartedAt < SPIN_MS + GRACE_MS) return false

  const id = ++spinId
  isSpinning = true
  spinStartedAt = startedAt
  const finals = outcome()
  // The watchdog: a spin still turning well past its time is called off.
  $.clock.after(SPIN_MS + GRACE_MS, () => {
    if (id === spinId && isSpinning) void stall($, id)
  })

  const frame = async () => {
    if (id !== spinId) return
    try {
      const progress = Math.min(1, ((await $.clock.now()) - startedAt) / SPIN_MS)
      const stopped = REEL_STOPS.filter(at => progress >= at).length
      await update($, machine, m => ({
        ...m,
        stopped,
        reels: m.reels.map((r, i) => (i < stopped ? (finals[i] ?? r) : pick())),
      }))
      if (stopped === REEL_STOPS.length) {
        await land($)
        return
      }
      // Ease out: the frame gap grows with the square of progress.
      $.clock.after(FAST_FRAME_MS + (SLOW_FRAME_MS - FAST_FRAME_MS) * progress * progress, frame)
    } catch {
      await stall($, id)
    }
  }

  try {
    const total = await sessionUsd($)
    await update($, machine, m => ({ ...m, phase: 'spinning' as const, stopped: 0, isJackpot: false, sessionUsd: total }))
    void frame()
  } catch {
    await stall($, id)
  }
  return true
}

// Pulls the lever from anywhere (a prompt, a press, /spin) without ever throwing.
async function pull($: EngineInterface) {
  try {
    return await startSpin($)
  } catch {
    await stall($, spinId)
    return false
  }
}

// A spin that broke: free the lever and show the machine at rest instead of spinning forever.
async function stall($: EngineInterface, id: number) {
  if (id !== spinId) return
  isSpinning = false
  try {
    await update($, machine, m => ({ ...m, phase: 'idle' as const, stopped: 0 }))
  } catch {
    // Nothing more to do; the next pull starts afresh.
  }
}

async function land($: EngineInterface) {
  isSpinning = false
  await loadGenerated($)
  const total = await sessionUsd($)
  const m = await update($, machine, x => ({
    ...x,
    phase: 'reveal' as const,
    lastSpendUsd: Math.max(0, total - x.landedAtUsd),
    landedAtUsd: total,
    sessionUsd: total,
    isJackpot: x.reels.every(r => r === x.reels[0]),
    taunt: taunt(),
  }))
  if (m.isJackpot) $.ui.toast('🎰 JACKPOT! You are an expert in burning money')
}

// The end of a main turn: what the answer cost, the ticket popup, and whether Claude writes quotes now.
async function settleTurn($: EngineInterface, isDone: boolean, isClaudeQuotesOn: boolean) {
  try {
    const total = await sessionUsd($)
    const m = await update($, machine, x => ({
      ...x,
      isTicketDone: isDone,
      sessionUsd: total,
      lastAnswerUsd: Math.max(0, total - x.askedAtUsd),
    }))
    if (isDone) $.ui.toast(`✅ Ticket done: this answer burned ${usd(m.lastAnswerUsd)}`)
  } catch {}
  // Only finished answers count towards the next batch; an interrupted or failed turn does not.
  if (isDone) turnsSinceGenerated += 1
  if (isDone && isClaudeQuotesOn && GENERATE_EVERY_TURNS > 0 && turnsSinceGenerated >= GENERATE_EVERY_TURNS) {
    turnsSinceGenerated = 0
    await generateTaunts($)
  }
}

export const register: Register = (on, options) => {
  // The person's switch in /plugin (userConfig claudeQuotes); on unless they turned it off.
  const isClaudeQuotesOn = options.claudeQuotes !== false

  on('session.start', async ($, e, next) => {
    // The machine's own failures never hold up the session: each step stands alone.
    try {
      // A spin cut off by a reload or restart would otherwise read 'spinning' forever.
      await update($, machine, m => (m.phase === 'spinning' ? { ...m, phase: 'idle' as const } : m))
    } catch {}
    void loadGenerated($)
    try {
      await $.command.register({ name: 'gpu-lette', description: 'Open the GPU-lette! pane' })
      await $.command.register({ name: 'spin', description: 'Pull the GPU-lette! lever' })
      // The spinner line is the machine; the pane opens only on /gpu-lette. One left up from before goes.
      if ((await $.ui.panes()).some(p => p.id === PANE)) await $.ui.close({ id: PANE })
    } catch {}

    return next(e)
  })

  on('command.run', { command: 'gpu-lette' }, async $ => {
    const { isPlaced } = await $.ui.open({ id: PANE, title: 'GPU-lette!' })

    return { text: isPlaced ? 'GPU-lette! is open.' : 'GPU-lette! waits for a wider terminal.' }
  })

  on('command.run', { command: 'spin' }, async $ => {
    return { text: (await pull($)) ? 'Lever pulled.' : 'The reels are still turning.' }
  })

  on('prompt.submit', async ($, e, next) => {
    try {
      const asked = await sessionUsd($)
      await update($, machine, m => ({ ...m, isTicketDone: false, askedAtUsd: asked }))
    } catch {}
    // Not awaited: the prompt goes through while the reels start.
    void pull($)

    return next(e)
  })

  on('turn.complete', ($, e, next) => {
    // Subagents' turns are not the person's answer. The bookkeeping runs beside the engine, never before it.
    if (e.agentId === undefined) void settleTurn($, e.reason === 'answer' && !e.isAborted, isClaudeQuotesOn)

    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const m = shown(await read($, machine))
    paneColumns = e.props.bodyColumns

    return (
      <Box flexDirection="column" alignItems="center" gap={1}>
        <Text bold color="magenta">★ GPU-lette! ★</Text>
        <Box borderStyle="double" borderColor="yellow" paddingX={1} gap={1}>
          {m.reels.map((r, i) => (
            <Box key={`reel-${i}`} borderStyle="round" borderColor={reelColor(m, i)} paddingX={1}>
              <Text>{symbol(r)}</Text>
            </Box>
          ))}
        </Box>
        <Text bold={m.isJackpot} color={m.isJackpot ? 'green' : undefined}>{status(m)}</Text>
        {m.phase !== 'spinning' && (
          <Button key="spin" label="SPIN (s)" hotkey="s" variant="primary" onPress={() => pull($)} />
        )}
        {m.isTicketDone ? (
          <Text bold color="green">+ TICKET DONE: {usd(m.lastAnswerUsd)} cashed into shipped work</Text>
        ) : (
          <Text color="red">Balance −{usd(m.sessionUsd)}</Text>
        )}
      </Box>
    )
  })

  // The working line ("Blanching…") becomes a one-row slot machine.
  on('ui.render', { component: 'Spinner' }, async ($, e) => {
    const { Box, Text, Button } = $.ui.resolve(e)
    const m = shown(await read($, machine))
    const reels = `[ ${m.reels.map(symbol).join(' ')} ]`
    const balance = ` │ Balance −${usd(m.sessionUsd)}`
    const hasSpin = m.phase !== 'spinning'
    const isLost = isLoss(m)
    // The top row is short and fixed; anything longer goes on the rows beneath it.
    const tag = isLost ? `−${usd(m.lastSpendUsd)}` : m.isJackpot ? 'JACKPOT!' : status(m)
    const quote = isLost
      ? m.taunt
      : m.isJackpot
        ? '🎰 You are an expert in burning money'
        : ''

    // The row is the terminal less a pane docked beside the transcript, when /gpu-lette opened one.
    const isPaneBeside = (await $.ui.panes().catch(() => [])).some(p => p.id === PANE && p.isShown && p.isPlaced)
    const columns = Math.max(20, (e.viewport?.columns ?? 80) - (isPaneBeside && paneColumns > 0 ? paneColumns + 6 : 0))
    // Up to three rows of quote; a longer one is cut with an ellipsis. Wrapping at words can leave up to a
    // word's width empty at the end of each row, so each row is counted a long word short.
    const quoteText = fit(quote, (columns - LONG_WORD) * 3)

    return (
      <Box flexDirection="column" paddingTop={1}>
        <Box flexDirection="row" flexWrap="nowrap">
          <Box flexShrink={1} minWidth={0}>
            <Text wrap="truncate-end">
              <Text bold color="yellow">{reels}</Text>
              <Text bold color={m.isJackpot ? 'green' : isLost ? 'red' : undefined}>{` ${tag}`}</Text>
              {hasSpin && <Text dimColor> │ </Text>}
            </Text>
          </Box>
          {hasSpin && (
            <Box flexShrink={0}>
              <Button key="spin" label="SPIN" variant="primary" onPress={() => pull($)} />
            </Box>
          )}
          <Box flexShrink={0}>
            <Text color="red" wrap="truncate-end">{balance}</Text>
          </Box>
        </Box>
        {e.props.message !== null && e.props.message !== '' && (
          // What Claude Code says in place of its spinner word (a notice of its own) still shows.
          <Text dimColor wrap="truncate-end">{`${e.props.message}${e.props.suffix}`}</Text>
        )}
        {quoteText !== '' && (
          <Text bold={m.isJackpot} color={m.isJackpot ? 'green' : undefined} wrap="wrap">{quoteText}</Text>
        )}
      </Box>
    )
  })
}

// Terminal cells a string takes: emoji and other wide glyphs count two, joiners and variation selectors none.
function cells(text: string) {
  let n = 0
  for (const c of text) n += cellsOf(c)
  return n
}

function cellsOf(c: string) {
  const code = c.codePointAt(0) ?? 0
  if (code === 0x200d || (code >= 0xfe00 && code <= 0xfe0f)) return 0
  return code >= 0x1f000 || (code >= 0x2e80 && code <= 0xa4cf) ? 2 : 1
}

// Cuts text to `room` cells with an ellipsis. Too little room shows nothing.
function fit(text: string, room: number) {
  if (room < 8) return ''
  if (cells(text) <= room) return text
  let out = ''
  for (const c of text) {
    if (cells(out) + cellsOf(c) > room - 1) break
    out += c
  }
  return `${out.trimEnd()}…`
}

// The machine as drawn: state saying 'spinning' with no spin running in this module (a reload
// cut it off, and its timers died with the old module) is drawn at rest, with the lever back.
function shown(m: Machine): Machine {
  return m.phase === 'spinning' && !isSpinning ? { ...m, phase: 'idle', stopped: 0 } : m
}

function reelColor(m: Machine, i: number) {
  if (m.isJackpot) return 'green'
  return m.phase === 'spinning' && i >= m.stopped ? 'yellow' : 'cyan'
}

function isLoss(m: Machine) {
  return m.phase === 'reveal' && !m.isJackpot
}

function status(m: Machine) {
  if (m.phase === 'idle') return 'pull the lever'
  if (m.phase === 'spinning') return 'spinning…'
  if (m.isJackpot) return '🎰 JACKPOT! You are an expert in burning money'
  return `−${usd(m.lastSpendUsd)}  ${m.taunt}`
}
