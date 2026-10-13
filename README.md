# GPU-lette! 🎰

**The plugin that shows you what you are really doing while you wait to press the approve button.**

Claude Code always had a spinner. It was always a slot machine; GPU-lette! just stops pretending. Every prompt pulls the lever, the reels spin while Claude thinks, and each spin shows what your session burned since the last one, cheering you on to keep going. The running balance never lies. Three of a kind is the jackpot.

```
[ 🍀 👑 👑 ] −$0.08 │ [ SPIN ] │ Balance −$6.40
😏 Your strategy is long-term; they just don't understand the vision 🚀
```

## Install

In Claude Code (2.1.275 or later), type:

```
/plugin install gpu-lette --marketplace Zan-23/gpu-lette
```

Answer `y` to add the marketplace, then press Enter to install it for your user. It starts working right away, and in every session after.

## How it plays

- **Every prompt pulls the lever.** The reels spin for 9 seconds, fast at first and slowing down, and lock in one at a time.
- **Each spin shows the damage**: what the session cost since the previous spin landed, in red, with a quote underneath.
- **Ticket done**: when Claude finishes an answer, a popup says what that answer burned.
- **Balance** on the right is what the whole session has cost, as `/cost` reports it.
- **Jackpot**: three of a kind, 5% of spins. "You are an expert in burning money"
- **Spin again** with the **SPIN** button or `/spin` once the reels stop.
- `/gpu-lette` opens a bigger casino pane, which turns green with that answer's cost when Claude finishes.

## Quotes

Over 100 quotes ship in [`hooks/taunts.ts`](hooks/taunts.ts); add your own, one per line.

Every third finished answer, Claude (Haiku) writes five new ones in a random voice (a casino host, a pirate, a fortune teller…). They join the mix and are kept across sessions, up to 100.

> **Heads-up:** GPU-lette! never sends your prompts or code anywhere; Haiku only sees a few of the shipped quotes as examples. Each batch is a small model call that counts toward your session cost. Turn it off with the **Claude-written quotes** setting in `/config`; you are also asked about it when you install.

## Uninstall

Type `/plugin`, pick **gpu-lette**, and uninstall it.

## Develop

```
git clone https://github.com/Zan-23/gpu-lette
claude --plugin-dir ./gpu-lette     # run it from your copy
claude plugin validate ./gpu-lette
claude plugin test ./gpu-lette
```

`tsconfig.json` extends the type declarations Claude Code writes into `.claude-plugin/types/` the first time it loads the plugin (they are not committed). Run `claude --plugin-dir ./gpu-lette` once, then `npx tsc -p ./gpu-lette` type-checks it.

## License

[MIT](LICENSE)
