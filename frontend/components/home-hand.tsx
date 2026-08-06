'use client'

import { useEffect, useState } from 'react'

import { baizeOf, deckOf } from '@/lib/table-style'

/**
 * One hand of poker, on a loop, above the form.
 *
 * The screen used to answer "what is this" with a fan of five hearts that never
 * moved and three paragraphs headed "How it works". This answers it in the only
 * way a card game can be answered — by dealing one — and it answers it before
 * anybody has read a word.
 *
 * It is an all-in, which is the one hand with no decisions left in it: that is
 * what lets the six cards go face up *before* the flop and the board run out in
 * front of everybody. It is also the hand this product is about. Blinsky shoves
 * seven-deuce, the two big pairs call, and the board pairs his seven three
 * times. The 7-2 is a whole format in the lobby; here it is the thing you watch
 * happen to somebody.
 *
 * The choreography is in globals.css, where the beats are percentages of one
 * `--cycle`. This file is the cast: who is sitting where, holding what.
 */

/** One turn round the scene, from `--cycle` in globals.css. */
const CYCLE_MS = 13_000
/**
 * How many times it plays before it stops for good.
 *
 * Two. Somebody arriving mid-hand gets a whole one from the top, and a screen
 * still animating on the twentieth loop is spending a phone's battery to say
 * something it finished saying at the fourth second. It settles on the frame
 * where the hand was decided — see the `data-settled` block in globals.css —
 * which is a table with a story on it rather than a table that stopped.
 */
const CYCLES = 2

/** Four-colour, same as the deck the app deals with. */
const INK: Record<string, string> = {
  h: 'var(--cred)',
  d: 'var(--cblue)',
  c: 'var(--cgreen)',
  s: 'var(--cink)',
}
const PIP: Record<string, string> = { s: '♠', h: '♥', d: '♦', c: '♣' }

type Outcome = 'win' | 'lose'

function Card({
  card,
  width,
  turn,
  outcome,
  deal,
  street,
}: {
  /** Rank then suit, e.g. `7d`. */
  card: string
  /** Which of the scene's card sizes this one is drawn at. */
  width: string
  /** When it turns over: with your own hand, or when the all-in is called. */
  turn?: 'mine' | 'rival'
  outcome: Outcome
  /** Its place in the deal, which is the only thing that staggers it. */
  deal?: number
  /** Milliseconds behind its street — the flop's three, dealt one by one. */
  street?: number
}) {
  const rank = card.slice(0, -1)
  const suit = card.slice(-1)

  return (
    <span
      className="home-card"
      data-win={outcome === 'win' ? '' : undefined}
      data-lose={outcome === 'lose' ? '' : undefined}
      style={
        {
          '--w': width,
          ...(deal === undefined ? {} : { '--d': deal }),
          ...(street === undefined ? {} : { '--s': street }),
        } as React.CSSProperties
      }
    >
      <span className="home-flip" data-turn={turn}>
        <span className="home-face card-face" style={{ color: INK[suit] }}>
          <span className="home-rank">{rank}</span>
          <span className="home-pip">{PIP[suit]}</span>
        </span>
        {/* Sits over the face until the card is edge-on, then steps away. Not
            a cross-fade: at the halfway point there is nothing to fade
            between, and a fade shows as a ghost through the card. */}
        <span className="home-back card-back" />
      </span>
    </span>
  )
}

/**
 * A face at the table.
 *
 * Plain `<img>`, like every other photo in this app — they are 160px webp of
 * about five kilobytes each, drawn at thirty, and putting a loader in front of
 * that costs a round trip to save nothing. `alt` is empty on purpose: the whole
 * table is one `role="img"` with one description, and three more alt strings
 * inside it would have a screen reader read the furniture.
 */
function Face({ who }: { who: string }) {
  return (
    <span className="home-avatar">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={`/home/${who}.webp`} alt="" width={160} height={160} />
    </span>
  )
}

function Stack({ chips }: { chips: string[] }) {
  return (
    <span className="home-stack">
      {chips.map((value, i) => (
        <span key={i} className="home-chip" data-v={value} />
      ))}
    </span>
  )
}

export function HomeHand() {
  const [settled, setSettled] = useState(false)
  const [hidden, setHidden] = useState(false)

  useEffect(() => {
    /* The clock only runs while somebody is looking. A tab left open in the
       background would otherwise reach the end of its two turns without
       anybody having seen one, and come back already finished. */
    let elapsed = 0
    let since = Date.now()
    let timer: ReturnType<typeof setTimeout> | undefined

    const stopIn = (ms: number) => {
      timer = setTimeout(() => setSettled(true), ms)
    }
    const onVisibility = () => {
      const away = document.hidden
      setHidden(away)
      if (away) {
        elapsed += Date.now() - since
        clearTimeout(timer)
      } else {
        since = Date.now()
        stopIn(Math.max(0, CYCLE_MS * CYCLES - elapsed))
      }
    }

    /* No `setHidden` here: a synchronous setState in an effect is a cascading
       render, and mounting into an already-hidden tab needs no attribute —
       browsers throttle animations in background tabs on their own, and the
       first `visibilitychange` puts the state right before anybody sees it. */
    if (!document.hidden) stopIn(CYCLE_MS * CYCLES)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])

  return (
    <div
      className="home-table"
      data-baize={baizeOf(null)}
      data-deck={deckOf(null)}
      data-settled={settled ? '' : undefined}
      data-paused={hidden ? '' : undefined}
      role="img"
      aria-label="Blinsky goes all in with seven-deuce, is called by two big pairs, and the board gives him four sevens."
    >
      {/* The rail and the cloth inside it — the app's own two surfaces. An
          ellipse rather than the table's racetrack: this is a table seen from
          a chair, which is the only honest view on a phone held upright. */}
      <span className="rail grain absolute inset-x-0 inset-y-[11%] bottom-[15%] rounded-[50%]" aria-hidden />
      <span
        className="baize grain absolute inset-x-[6px] inset-y-[calc(11%+6px)] bottom-[calc(15%+6px)] rounded-[50%]"
        aria-hidden
      />

      <span className="home-seat" data-at="l">
        <Face who="andylon" />
        <span className="home-act">Calls</span>
        <span className="home-name">Andylon</span>
        <span className="home-chips">3.1k</span>
        <span className="home-hand">
          <Card card="As" width="var(--rc)" turn="rival" outcome="lose" deal={0} />
          <Card card="Ac" width="var(--rc)" turn="rival" outcome="lose" deal={1} />
        </span>
      </span>

      <span className="home-seat" data-at="r">
        <Face who="alvariki" />
        <span className="home-act">Calls</span>
        <span className="home-name">Alvariki</span>
        <span className="home-chips">2.4k</span>
        <span className="home-hand">
          <Card card="Ks" width="var(--rc)" turn="rival" outcome="lose" deal={2} />
          <Card card="Kd" width="var(--rc)" turn="rival" outcome="lose" deal={3} />
        </span>
      </span>

      <span className="home-middle">
        <span className="home-board">
          <Card card="Ad" width="var(--bc)" outcome="win" street={0} />
          <Card card="Kh" width="var(--bc)" outcome="lose" street={110} />
          <Card card="7s" width="var(--bc)" outcome="win" street={220} />
          <Card card="7h" width="var(--bc)" outcome="win" street={600} />
          <Card card="7c" width="var(--bc)" outcome="win" street={980} />
        </span>
        <span className="home-pot">
          <Stack chips={['w', 'r', 'g', 'k', 'k']} />
          <Stack chips={['r', 'b', 'k', 'g']} />
          <Stack chips={['b', 'k', 'r', 'w']} />
        </span>
        <span className="home-called">Quad sevens</span>
      </span>

      <span className="home-seat" data-at="me">
        <span className="home-act" data-shove="">
          ALL IN
        </span>
        <span className="home-who">
          <Face who="blinsky" />
          <span className="home-name">Blinsky</span>
        </span>
        <span className="home-hand">
          <Card card="7d" width="var(--mc)" turn="mine" outcome="win" deal={4} />
          <Card card="2c" width="var(--mc)" turn="mine" outcome="lose" deal={5} />
        </span>
        <span className="home-won">+2,400</span>
      </span>
    </div>
  )
}
