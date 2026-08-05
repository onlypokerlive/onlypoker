import { expect, test, type Page } from '@playwright/test'

/**
 * The order an all-in is told in.
 *
 * Hands first, then the board, then the answer. It used to be the other way
 * round — the board was dealt out card by card over hole cards that stayed face
 * down until the river landed — and the reasoning behind that was sound: nothing
 * may name the hand before the board exists. Naming a hand and turning it over
 * are not the same act, and a board dealt out over cards nobody has seen is
 * three cards and no stakes. The tension of an all-in is entirely in knowing
 * what each player needs.
 *
 * Not a unit test, and it could not be: the two halves are timed by two
 * different hooks in two different components (`use-runout` and `use-showdown`),
 * and what this asserts is the *relation* between their clocks. jsdom will tell
 * you each of them is correct on its own, which is exactly what it did while
 * they disagreed.
 */

const PASSWORD = 'friends-only'

/** Both players all-in preflop, seen from the seat that shoved. */
async function allInPreflop(page: Page): Promise<void> {
  const api = page.request
  const host = await (
    await api.post('/api/rooms', {
      data: {
        name: 'Run-out test',
        hostName: 'Pablo',
        startingChips: 1000,
        smallBlind: 5,
        bigBlind: 10,
        password: PASSWORD,
        actionSeconds: 0,
      },
    })
  ).json()
  const guest = await (
    await api.post(`/api/rooms/${host.roomId}/join`, {
      data: { name: 'Sam', password: PASSWORD },
    })
  ).json()
  await api.post(`/api/rooms/${host.roomId}/start`, {
    data: { playerId: host.playerId, action: 'start' },
    headers: { 'x-player-token': host.token },
  })

  await page.addInitScript(
    ([id, value]) => localStorage.setItem(`holdem:session:${id}`, value),
    [
      host.roomId,
      JSON.stringify({
        roomId: host.roomId,
        playerId: guest.playerId,
        token: guest.token,
        isHost: false,
      }),
    ] as const,
  )
  await page.goto(`/room/${host.roomId}`)
  await expect(page.getByTestId('board')).toBeVisible()

  // Heads-up the small blind acts first, and that is the guest whose seat this
  // page is sitting in. Shove, then call — through the API, because how the
  // chips got in is not what this test is about and two browsers racing to a
  // preflop all-in is the flaky part.
  const act = async (
    who: { playerId: string; token: string },
    body: Record<string, unknown>,
  ) => {
    const state = await (
      await api.get(`/api/rooms/${host.roomId}/state?playerId=${who.playerId}`, {
        headers: { 'x-player-token': who.token },
      })
    ).json()
    const response = await api.post(`/api/rooms/${host.roomId}/action`, {
      data: { playerId: who.playerId, handNumber: state.room.handNumber, turnId: state.turnId, ...body },
      headers: { 'x-player-token': who.token },
    })
    expect(response.ok()).toBe(true)
  }
  await act(guest, { action: 'raise', amount: 1000 })
  await act(host, { action: 'call' })
}

/**
 * What is on the table right now.
 *
 * Four numbers and not one, because the failure this exists to catch is an
 * *order* between them. A first version counted face-up cards and stopped
 * there, and it passed while the ending it was supposedly guarding collapsed
 * into a single frame: the board was right, the hands were right, and
 * everything after the river happened at once.
 */
async function frame(page: Page) {
  return page.evaluate(() => {
    const outside = (selector: string) =>
      [...document.querySelectorAll(selector)].filter(
        (el) => !el.closest('[data-testid="board"]') && !el.closest('[data-peek-band]'),
      )
    return {
      board: Number(
        document.querySelector('[data-testid="board"]')?.getAttribute('data-cards') ?? 0,
      ),
      // Hands, not cards. Counted by the seat they are in, because a single
      // Hold'em hand is already two faces — so "two cards are up" and "both
      // players have shown" are the same number and different claims.
      //
      // Your own seat is excluded by construction rather than by a filter: it
      // stays face down whatever the hand did, and the person next to you does
      // not get to read it off your screen.
      handsUp: new Set(outside('.card-face').map((card) => card.closest('[data-piece="seat"]')))
        .size,
      // The winning five picking themselves out — the beat that answers the
      // hand, and the one that used to fire on the river.
      //
      // Counted across the whole table and not `outside` it: three of the five
      // are usually on the board and two are in a hand, and counting only the
      // hand half would be watching two of the five light and calling it the
      // sequence.
      lit: document.querySelectorAll('[data-lit="true"]').length,
      // And the money. It leaves only when the hand has finished being told.
      //
      // `pay-` and not any `[data-flight]`: chips fly three times in a hand —
      // a bet going forward, the street being raked in, and the pot going out —
      // and only the third is the answer. Asked without the prefix, the blinds
      // posting at the top of the hand count as the pot being paid.
      payingOut: [...document.querySelectorAll('[data-flight]')].some((el) =>
        el.getAttribute('data-flight')?.startsWith('pay-'),
      ),
    }
  })
}

test('an all-in shows the hands before it deals the board', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await allInPreflop(page)

  // Sampled rather than waited on, because what is being checked is an order
  // and not a final state — and the final state of every one of these, right
  // and wrong, is identical: five cards, every hand face up, five cards lit and
  // the pot paid.
  type Frame = Awaited<ReturnType<typeof frame>> & { at: number }
  const shots: Frame[] = []
  const start = Date.now()
  while (Date.now() - start < 12_000) {
    shots.push({ at: Date.now() - start, ...(await frame(page)) })
    await page.waitForTimeout(50)
  }

  const dealt = shots.find((f) => f.board >= 5)
  expect(dealt, 'the board never finished').toBeTruthy()

  // The hands are up while the board is still short. This is the whole claim.
  const sweating = shots.filter((f) => f.handsUp >= 1 && f.board < 5)
  expect(sweating.length, 'no frame had a hand up over an unfinished board').toBeGreaterThan(0)

  // And they were up before the first card of the run-out, not partway through
  // it: the flop lands on a table that already knows what it is looking at.
  const firstUp = shots.find((f) => f.handsUp >= 1)!
  const firstCard = shots.find((f) => f.board > 0)!
  expect(firstUp.at).toBeLessThan(firstCard.at)

  // Street by street, and unhurried. Each one on screen on its own, and long
  // enough to be a card rather than a flicker.
  //
  // Asserted as "these were seen, in this direction" rather than as the exact
  // list, because the list also contains the empty board — and whether this
  // loop got a sample in before the flop landed is a fact about how busy the
  // machine running it is, not about the table. The streets themselves cannot
  // be missed: they are more than a second apart, which is the actual claim.
  const sizes = [...new Set(shots.map((f) => f.board))]
  expect(sizes).toContain(3)
  expect(sizes).toContain(4)
  expect(sizes).toContain(5)
  // Forwards only: a board that went back is the next hand being dealt over it.
  expect(sizes).toEqual([...sizes].sort((a, b) => a - b))
  const landed = (n: number) => shots.find((f) => f.board === n)!.at
  expect(landed(4) - landed(3)).toBeGreaterThan(600)
  expect(landed(5) - landed(4)).toBeGreaterThan(600)

  // And then the answer, which is a separate act with a separate beat.
  //
  // This is the half the first version of this test did not look at, and it is
  // the half that was broken: the moment the river landed, the hook that timed
  // the run-out stopped saying how long it had taken, every beat still to come
  // fell into a past the clock had gone by, and the whole ending fired at once
  // — five cards lit in one frame with the pot leaving underneath them.
  const river = landed(5)
  const onTheRiver = shots.find((f) => f.at >= river)!
  expect(onTheRiver.lit, 'the winning five lit on the river itself').toBe(0)
  expect(onTheRiver.payingOut, 'the pot left with the river').toBe(false)

  // The five light one at a time rather than together.
  const litCounts = [...new Set(shots.filter((f) => f.at >= river).map((f) => f.lit))]
  expect(litCounts.length, 'the lighting happened in a single frame').toBeGreaterThan(2)

  // And the money is last. `payingOut` catches the chips mid-flight, so a run
  // that samples either side of it still sees the order it happened in.
  const firstLit = shots.find((f) => f.lit > 0)!
  const paid = shots.find((f) => f.payingOut)
  if (paid) expect(paid.at).toBeGreaterThanOrEqual(firstLit.at)
})
