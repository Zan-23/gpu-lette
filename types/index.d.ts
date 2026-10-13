export type Phase = 'idle' | 'spinning' | 'reveal'

export type Machine = {
  phase: Phase
  // Indexes into the module's SYMBOLS, one per reel.
  reels: number[]
  // How many reels have stopped during the current spin.
  stopped: number
  lastSpendUsd: number
  // The session's cost when the last spin landed: what the next spin's loss counts from.
  landedAtUsd: number
  sessionUsd: number
  // The session's cost when the latest prompt went in, and what the last finished answer cost.
  askedAtUsd: number
  lastAnswerUsd: number
  isJackpot: boolean
  // What the machine says after a losing spin.
  taunt: string
  isTicketDone: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'gpu-lette': { machine: Machine }
  }
}
