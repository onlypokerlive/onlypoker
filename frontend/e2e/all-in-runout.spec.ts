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

/** What is on the table right now: board size, and how many hands are face up. */
async function frame(page: Page) {
  return page.evaluate(() => ({
    board: Number(document.querySelector('[data-testid="board"]')?.getAttribute('data-cards') ?? 0),
    // Every face-up card that is not a board card and not your own peek band.
    // At a showdown that is exactly the hands that have turned over — and it
    // does not include your own, which stay face down in your seat whatever
    // the hand did: the person next to you does not get to read them off your
    // screen.
    handsUp: [...document.querySelectorAll('.card-face')].filter(
      (card) => !card.closest('[data-testid="board"]') && !card.closest('[data-peek-band]'),
    ).length,
  }))
}

test('an all-in shows the hands before it deals the board', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await allInPreflop(page)

  // Sampled rather than waited on, because what is being checked is an order
  // and not a final state — and the final state of every one of these, right
  // and wrong, is identical: five cards and two hands face up.
  const film: { at: number; board: number; handsUp: number }[] = []
  const start = Date.now()
  while (Date.now() - start < 9_000) {
    film.push({ at: Date.now() - start, ...(await frame(page)) })
    await page.waitForTimeout(80)
  }

  const dealt = film.find((f) => f.board >= 5)
  expect(dealt, 'the board never finished').toBeTruthy()

  // The hands are up while the board is still short. This is the whole claim.
  const sweating = film.filter((f) => f.handsUp >= 2 && f.board < 5)
  expect(sweating.length, 'no frame had the hands up over an unfinished board').toBeGreaterThan(0)

  // And they were up before the first card of the run-out, not partway through
  // it: the flop lands on a table that already knows what it is looking at.
  const firstUp = film.find((f) => f.handsUp >= 2)!
  const firstCard = film.find((f) => f.board > 0)!
  expect(firstUp.at).toBeLessThan(firstCard.at)

  // Street by street, and unhurried. Every board size on the way, each one on
  // screen long enough to be a card rather than a flicker.
  const sizes = [...new Set(film.map((f) => f.board))]
  expect(sizes).toEqual([0, 3, 4, 5])
  const landed = (n: number) => film.find((f) => f.board === n)!.at
  expect(landed(4) - landed(3)).toBeGreaterThan(600)
  expect(landed(5) - landed(4)).toBeGreaterThan(600)
})
