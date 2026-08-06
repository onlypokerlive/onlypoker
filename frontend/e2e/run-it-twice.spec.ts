import { expect, test, type Page } from '@playwright/test'

/**
 * Two boards, one after the other, on the felt where they happen.
 *
 * The server has always sent both. The table drew `boards[0]` and nothing else,
 * so a hand run twice showed one run-out and then a results panel announcing
 * that the other half of the pot went somewhere else — on the strength of five
 * cards nobody ever saw dealt. The one thing dealing twice puts on the table
 * that the stacks cannot say is *which board went to whom*: winning both and
 * chopping both come out to the same chips.
 *
 * Not a unit test, and it could not be. jsdom does no layout, so what a second
 * row of cards does to the seats either side of it is a question only a real
 * browser can answer — and the middle of the ring is its narrowest part, which
 * is exactly where the row lands.
 */

const PASSWORD = 'friends-only'

/** Both players all-in preflop on a table that offers two boards. */
async function allInWithTwoBoards(page: Page, viewport: { width: number; height: number }) {
  await page.setViewportSize(viewport)
  const api = page.request
  const host = await (
    await api.post('/api/rooms', {
      data: {
        name: 'Two boards',
        hostName: 'Pablo',
        startingChips: 1000,
        smallBlind: 5,
        bigBlind: 10,
        password: PASSWORD,
        actionSeconds: 0,
        runItTwice: true,
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

  const state = (who: { playerId: string; token: string }) =>
    api
      .get(`/api/rooms/${host.roomId}/state?playerId=${who.playerId}`, {
        headers: { 'x-player-token': who.token },
      })
      .then((r) => r.json())

  const act = async (
    who: { playerId: string; token: string },
    body: Record<string, unknown>,
  ) => {
    const at = await state(who)
    const response = await api.post(`/api/rooms/${host.roomId}/action`, {
      data: { playerId: who.playerId, handNumber: at.room.handNumber, turnId: at.turnId, ...body },
      headers: { 'x-player-token': who.token },
    })
    expect(response.ok()).toBe(true)
  }
  // Heads-up the small blind acts first, and that is the seat this page is in.
  await act(guest, { action: 'raise', amount: 1000 })
  await act(host, { action: 'call' })

  // Everybody left in has to agree, which is the rule and not a formality —
  // so the answers go in one at a time, asking each time who is still being
  // asked. Sending both blind is how this raced: the engine can finish with
  // the selection before the second answer is posted, and the second answer
  // then arrives at a hand that has stopped asking.
  let answered = 0
  for (let round = 0; round < 4; round++) {
    const at = await state(guest)
    const waiting: string[] = at.runoutSeats ?? []
    if (!waiting.length) break
    const who = [guest, host].find((p) => waiting.includes(p.playerId))
    if (!who) break
    const response = await api.post(`/api/rooms/${host.roomId}/runout`, {
      data: { playerId: who.playerId, action: 'twice', handNumber: at.room.handNumber },
      headers: { 'x-player-token': who.token },
    })
    expect(response.ok(), `runout ${response.status()}: ${await response.text()}`).toBe(true)
    answered++
  }
  expect(answered, 'nobody was ever asked about a second board').toBeGreaterThan(0)
  return host.roomId
}

/** Every board row, and every seat, as the browser has them. */
async function felt(page: Page) {
  return page.evaluate(() => {
    const rect = (el: Element) => {
      const r = el.getBoundingClientRect()
      return { left: r.left, top: r.top, right: r.right, bottom: r.bottom }
    }
    return {
      boards: [...document.querySelectorAll('[data-board]')].map((el) => ({
        cards: Number(el.getAttribute('data-cards') ?? 0),
        box: rect(el),
      })),
      seats: [...document.querySelectorAll('[data-piece="seat"]')].map(rect),
      // Your own zone is the thing this repo breaks. It is a fixed-height box
      // with `overflow-hidden` and `justify-end`, so anything that pushes into
      // it is silently cropped off the top — nothing throws, nothing scrolls,
      // and you stop being able to see your own cards.
      zone: (() => {
        const el = document.querySelector('[data-own-zone]')
        return el ? rect(el) : null
      })(),
      band: (() => {
        const el = document.querySelector('[data-peek-band]')
        if (!el) return null
        const card = el.querySelector('.card-back, .card-face')
        return {
          box: rect(el),
          // How much of your own cards is not being drawn.
          clipped: card
            ? el.getBoundingClientRect().top - card.getBoundingClientRect().top
            : 0,
        }
      })(),
      winners: [...document.querySelectorAll('[data-testid^="board-winner-"]')].map(
        (el) => el.textContent?.trim() ?? '',
      ),
    }
  })
}

const overlaps = (
  a: { left: number; top: number; right: number; bottom: number },
  b: { left: number; top: number; right: number; bottom: number },
) =>
  Math.min(a.right, b.right) - Math.max(a.left, b.left) > 0.5 &&
  Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top) > 0.5

// The floor and a common phone. The floor is where the middle is tightest, so
// it is the case that matters; the second is there because a bug that only
// appears at 320 and a bug that only appears above it are both real.
for (const viewport of [
  { width: 320, height: 568 },
  { width: 390, height: 844 },
]) {
  test(`a hand run twice deals both boards on the felt at ${viewport.width}×${viewport.height}`, async ({
    page,
  }) => {
    await allInWithTwoBoards(page, viewport)

    type Shot = Awaited<ReturnType<typeof felt>> & { at: number }
    const shots: Shot[] = []
    const start = Date.now()
    while (Date.now() - start < 22_000) {
      shots.push({ at: Date.now() - start, ...(await felt(page)) })
      await page.waitForTimeout(50)
    }

    // Two rows, and the second one is not an afterthought that appeared once
    // the hand was over.
    const twoRows = shots.filter((s) => s.boards.length === 2)
    expect(twoRows.length, 'the second board never appeared').toBeGreaterThan(0)

    // One board, then the other — the order a card room deals them in. Side by
    // side they are one event that happens to have ten cards in it; in sequence
    // they are two answers to the same question, and the second is read against
    // one everybody already has.
    //
    // Asserted as "the second never runs ahead of the first, and the first was
    // finished alone at some point", which is the claim. Asserting the exact
    // pair on every frame would be asserting how busy the machine is.
    for (const shot of twoRows) {
      expect(
        shot.boards[1].cards,
        `boards were ${shot.boards.map((b) => b.cards).join(' and ')} at ${shot.at}ms`,
      ).toBeLessThanOrEqual(shot.boards[0].cards)
    }
    const aloneOnTheRiver = twoRows.filter(
      (s) => s.boards[0].cards === 5 && s.boards[1].cards === 0,
    )
    expect(
      aloneOnTheRiver.length,
      'the second board was being dealt before the first had finished',
    ).toBeGreaterThan(0)

    // And each of them ran out street by street rather than appearing whole.
    for (const b of [0, 1]) {
      const sizes = [...new Set(twoRows.map((s) => s.boards[b].cards))]
      expect(sizes, `board ${b + 1} skipped a street`).toContain(3)
      expect(sizes).toContain(4)
      expect(sizes).toContain(5)
    }

    // And nothing covers anything, on every frame — which is the claim jsdom
    // cannot make. The second row lands in the narrowest part of the ring.
    const covered: string[] = []
    for (const shot of shots) {
      shot.boards.forEach((board, b) => {
        shot.seats.forEach((seat, s) => {
          if (overlaps(board.box, seat)) {
            covered.push(`board ${b + 1} over seat ${s} at ${shot.at}ms`)
          }
        })
        if (shot.zone && overlaps(board.box, shot.zone)) {
          covered.push(`board ${b + 1} over your own zone at ${shot.at}ms`)
        }
      })
      // And your own cards are still all there. A second row of community
      // cards is height taken out of the middle of the felt, and the box that
      // pays for height it did not get is this one — silently.
      if (shot.band && shot.band.clipped > 0.5) {
        covered.push(`your own cards clipped by ${shot.band.clipped} at ${shot.at}ms`)
      }
    }
    expect(covered).toEqual([])

    // Each row says who took it. With two boards the same player usually has
    // two different hands, so the server sends no `handCards` at all and
    // nothing lights up — leaving the one question the second board exists to
    // answer unanswered on the felt.
    const named = shots.filter((s) => s.winners.length === 2).at(-1)
    expect(named, 'neither board was ever named').toBeTruthy()
    expect(named!.winners.every((w) => w.length > 0)).toBe(true)
  })
}
