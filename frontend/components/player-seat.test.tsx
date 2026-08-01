import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'

import { PlayerSeat } from '@/components/player-seat'
import { player } from '@/lib/test-fixtures'

const seat = (overrides = {}) =>
  render(<PlayerSeat player={player(overrides)} showdown={false} />)

/**
 * Where the blinds are is the one thing on the felt that nothing else says.
 *
 * The dealer button has its own home on the corner of the avatar; folding and
 * being away are drawn by fading the whole seat. The blinds have exactly one
 * channel — this pill — and they were losing it to states that already had one
 * of their own.
 */
describe('the position tag', () => {
  it('names the blinds', () => {
    seat({ isBigBlind: true })
    expect(screen.getByText('BB')).toBeInTheDocument()
  })

  it('still names them when the player let their clock run out', () => {
    // The case that showed it up: a table of people looking at their phones
    // times both blinds out, and the blinds disappear from the felt.
    seat({ isBigBlind: true, timedOut: true })
    expect(screen.getByText('BB')).toBeInTheDocument()
    expect(screen.queryByText('Away')).not.toBeInTheDocument()
  })

  it('still names them after they have folded', () => {
    seat({ isSmallBlind: true, folded: true })
    expect(screen.getByText('SB')).toBeInTheDocument()
  })

  it('prefers the straddle, which is the position that is actually posted', () => {
    seat({ isBigBlind: true, isStraddle: true })
    expect(screen.getByText('STR')).toBeInTheDocument()
  })

  it('says what the state is when there is no position to report', () => {
    seat({ folded: true })
    expect(screen.getByText('Fold')).toBeInTheDocument()
  })

  it('says nothing at all for an ordinary seat', () => {
    const { container } = seat()
    for (const word of ['BB', 'SB', 'STR', 'Fold', 'Away', 'Out', 'Sat out']) {
      expect(container.textContent).not.toContain(word)
    }
  })

  it('gives being knocked out the last word — they hold no position', () => {
    seat({ isBigBlind: true, out: true })
    expect(screen.getByText('Out')).toBeInTheDocument()
  })

  it('says somebody is away, even though they are in the hand', () => {
    // Sitting out no longer takes a player out of the deal — they are dealt
    // in and blinded like everybody else — so `inHand` is true for them and
    // the badge used to require it to be false. It never showed.
    seat({ sittingOut: true, inHand: true })
    expect(screen.getByText('Sat out')).toBeInTheDocument()
  })

  it('keeps saying it once the table has folded their hand for them', () => {
    // Which happens within a second of every deal. Folding is already drawn by
    // the seat fading; being away had nothing else to say it.
    seat({ sittingOut: true, inHand: true, folded: true })
    expect(screen.getByText('Sat out')).toBeInTheDocument()
    expect(screen.queryByText('Fold')).not.toBeInTheDocument()
  })

  it('still lets the blinds through, because nothing else reports them', () => {
    seat({ sittingOut: true, inHand: true, isBigBlind: true })
    expect(screen.getByText('BB')).toBeInTheDocument()
  })
})
