// Saying out loud what just happened.
//
// This is the line a real table gets for free: somebody says "raise, nine
// hundred" and everyone who was looking at their own cards knows where the
// action is. On a phone the only person who sees a decision is whoever happens
// to be watching that seat at that second, and the player most likely to miss
// it is the one about to have to answer it.
//
// Kept pure and apart from the component so the wording can be tested — it is
// read aloud by screen readers, which makes a sloppy sentence an accessibility
// bug rather than a typo.

import type { PlayerView, TableAction } from '@/lib/poker-api'

/** Enough of a player to name them. */
type Named = Pick<PlayerView, 'id' | 'name' | 'isYou'>

function nameFor(players: Named[], id: string): string {
  const player = players.find((p) => p.id === id)
  if (!player) return 'Someone'
  // Second person for yourself. "You check" is what you would say; "Marcos
  // checks" about yourself reads as somebody else at the table.
  return player.isYou ? 'You' : player.name
}

/**
 * One decision, in a sentence.
 *
 * Amounts are spelled out in full rather than shortened the way the chips on
 * the felt are: the pill on the table is read at a glance and this is read
 * once, and "24.5k" is not a number anybody says.
 */
export function actionLine(action: TableAction, players: Named[]): string {
  const who = nameFor(players, action.playerId)
  const you = who === 'You'
  const verb = (second: string, third: string) => (you ? second : third)
  const chips = (n: number) => n.toLocaleString()

  // The clock played it, or a player who had already left the table did. Said
  // plainly, because a fold nobody chose is a completely different moment from
  // one somebody agonised over — and the difference explains the pause.
  const auto = action.auto ? ' (time)' : ''

  switch (action.kind) {
    case 'check':
      return `${who} ${verb('check', 'checks')}${auto}`
    case 'fold':
      return `${who} ${verb('fold', 'folds')}${auto}`
    case 'call':
      return action.allIn
        ? `${who} ${verb('call', 'calls')} ${chips(action.to)} — all-in${auto}`
        : `${who} ${verb('call', 'calls')} ${chips(action.to)}${auto}`
    case 'bet':
      return action.allIn
        ? `${who} ${verb('are', 'is')} all-in for ${chips(action.to)}`
        : `${who} ${verb('bet', 'bets')} ${chips(action.to)}`
    case 'raise':
      return action.allIn
        ? `${who} ${verb('are', 'is')} all-in for ${chips(action.to)}`
        : `${who} ${verb('raise', 'raises')} to ${chips(action.to)}`
  }
}

/**
 * What the table is saying right now, or null when it has nothing to say.
 *
 * The last decision only. A feed of everything scrolling past is a second
 * thing to read while the shot clock runs; the history belongs behind the ☰,
 * where it can be studied instead of glanced at.
 */
export function latestLine(
  actions: TableAction[],
  players: Named[],
): string | null {
  const last = actions[actions.length - 1]
  return last ? actionLine(last, players) : null
}
