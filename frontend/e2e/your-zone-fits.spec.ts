import { expect, test, type Page } from '@playwright/test'

/**
 * Does your own zone actually hold what is put in it?
 *
 * This is the one question about this layout that jsdom cannot answer and that
 * `table-layout.test.ts` only *appears* to. That suite's fit check compares the
 * model against itself —
 *
 *     expect(OWN_ZONE_H).toBeGreaterThanOrEqual(PEEK_BAND_H + GAP + OWN_ACTION_H)
 *
 * — which is three hand-written constants agreeing with each other. It passes
 * whatever the browser does, and it passed while the browser was clipping the
 * top of the peek band on every phone: a pass that raised every button in the
 * app to a 44px touch target took the controls from 139px to 166.8px inside a
 * reservation of 150, and the zone is `overflow-hidden` with `justify-end`, so
 * the 16.7px came off the top of your own cards in silence. Nothing threw,
 * nothing scrolled, no test noticed. With the slider's disclosure open it was
 * 81.7px and the band was gone entirely.
 *
 * So this measures the DOM. It is deliberately not a screenshot comparison:
 * what matters is not that the pixels match a golden file but that one box
 * still contains another, which is a number the browser will tell you.
 */

const PASSWORD = 'friends-only'

/** Every phone this is built for, plus the two ends of the range. */
const PHONES = [
  { name: 'iPhone SE — the floor', width: 320, height: 568 },
  { name: 'iPhone SE 3rd gen', width: 375, height: 667 },
  { name: 'iPhone 14', width: 390, height: 844 },
  { name: 'iPhone 15 Pro Max, Safari', width: 430, height: 745 },
  { name: 'iPhone 17 Pro Max', width: 440, height: 956 },
]

/**
 * A table with a hand in progress, seen from the seat that is on the clock.
 *
 * Built through the API rather than through the UI. Two browser contexts
 * clicking their way to somebody's turn is the slowest possible way to reach a
 * state this test does not care how you got to, and it is the part that goes
 * flaky. What the test does care about — the room, the seat, the page — is all
 * real.
 *
 * The small blind, heads-up, is the seat that gives the tallest bar there is:
 * on the clock, facing a bet it can call, with a raise available and preflop
 * sizes to offer. `actionSeconds: 0` turns the shot clock off so the hand does
 * not fold itself out from under the measurement.
 */
async function seatOnTheClock(page: Page): Promise<string> {
  const api = page.request
  const room = await (
    await api.post('/api/rooms', {
      data: {
        name: 'Fit test',
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
    await api.post(`/api/rooms/${room.roomId}/join`, {
      data: { name: 'Sam', password: PASSWORD },
    })
  ).json()
  await api.post(`/api/rooms/${room.roomId}/start`, {
    data: { playerId: room.playerId, action: 'start' },
    headers: { 'x-player-token': room.token },
  })

  const session = {
    roomId: room.roomId,
    playerId: guest.playerId,
    token: guest.token,
    isHost: false,
  }
  await page.addInitScript(
    ([id, value]) => localStorage.setItem(`holdem:session:${id}`, value),
    [room.roomId, JSON.stringify(session)] as const,
  )
  await page.goto(`/room/${room.roomId}`)
  // The bar in its tallest state: sizes, sizing control and the three buttons.
  //
  // Waited on by the raise button and deliberately not by the slider, even
  // though the slider is what makes the bar tall. A bar that has hidden its
  // slider must still be measured — that is the exact shape the regression
  // took — and a wait that cannot see it turns a clipped band into a timeout
  // pointing at the wrong thing. Whether the slider is on the felt at all is a
  // separate claim with a test of its own below.
  await expect(raiseButton(page)).toBeVisible()
  return room.roomId
}

/** The button that commits the chips — present whenever raising is legal. */
const raiseButton = (page: Page) =>
  page.getByRole('button', { name: /^Raise to |^Go all in for / })

/** Where the zone is, where the band is, and what the controls are asking for. */
async function measure(page: Page) {
  return page.evaluate(() => {
    const zone = document.querySelector('[data-own-zone]') as HTMLElement
    const band = document.querySelector('[data-peek-band]') as HTMLElement
    const controls = zone.lastElementChild as HTMLElement
    const z = zone.getBoundingClientRect()
    return {
      zone: z.height,
      // Positive means the band's top edge is above the top of the box that
      // clips it — which is exactly how much of your own cards is not drawn.
      bandClippedBy: z.top - band.getBoundingClientRect().top,
      controlsNeed: controls.getBoundingClientRect().height,
      // Nothing below the fold either: the buttons are the one thing on this
      // screen that must never be cut off.
      controlsOverhang: controls.getBoundingClientRect().bottom - z.bottom,
      pageScrolls: document.documentElement.scrollHeight > window.innerHeight,
    }
  })
}

test.describe('your own zone holds what is put in it', () => {
  for (const phone of PHONES) {
    test(`${phone.name} (${phone.width}×${phone.height})`, async ({ page }) => {
      await page.setViewportSize({ width: phone.width, height: phone.height })
      await seatOnTheClock(page)

      const m = await measure(page)

      // The band, whole. Half a pixel of tolerance and no more: this is a
      // subpixel layout, not a soft limit.
      expect(m.bandClippedBy).toBeLessThan(0.5)
      expect(m.controlsOverhang).toBeLessThan(0.5)
      // And the reason it fits, so a failure says which of the two moved.
      expect(m.controlsNeed).toBeLessThan(m.zone)
      // The whole layout exists so that nothing scrolls. If it does, the table
      // is no longer the constant and every seat on it has moved.
      expect(m.pageScrolls).toBe(false)
    })
  }

  test('keeps your own cards clear of your own thumb', async ({ page }) => {
    // They lived pinned to the right of the band, which is the side the thumb
    // comes up for nine people in ten — and the band *is* the control the thumb
    // presses and drags. You pressed to look at your hand and what you looked
    // at was your finger.
    //
    // Measured rather than asserted against a class name: which half of the
    // band the cards are drawn in is a fact about the layout, and a
    // `flex-row-reverse` that stopped applying would leave the class in place.
    await page.setViewportSize({ width: 390, height: 844 })
    const roomId = await seatOnTheClock(page)

    const sideOfBand = async () =>
      page.evaluate(() => {
        const band = document.querySelector('[data-peek-band]')!.getBoundingClientRect()
        // Face down, which is how your hand sits until a thumb is on it.
        const cards = document
          .querySelector('[data-peek-band] .card-back, [data-peek-band] .card-face')!
          .getBoundingClientRect()
        return cards.left + cards.width / 2 < band.left + band.width / 2 ? 'left' : 'right'
      })

    expect(await sideOfBand()).toBe('left')

    // And the other hand moves them. Written straight to storage rather than
    // clicked through the help sheet, so this test is about the layout and not
    // about where the switch happens to live.
    await page.evaluate(() => localStorage.setItem('holdem:handed', 'left'))
    await page.goto(`/room/${roomId}`)
    await expect(raiseButton(page)).toBeVisible()
    expect(await sideOfBand()).toBe('right')

    // Whichever side they are on, the band still fits — this is the box that
    // clips in silence.
    expect((await measure(page)).bandClippedBy).toBeLessThan(0.5)
  })

  test('shows the slider without being asked for it', async ({ page }) => {
    // It spent a release collapsed behind a `<details>` labelled "Fine tune",
    // which is a slider nobody knows is there: the row reads as a caption, and
    // the only way to a size the presets do not offer is a disclosure you have
    // to guess at. Named, so that a future pass to save a row cannot quietly
    // take this one back.
    await page.setViewportSize({ width: 430, height: 745 })
    await seatOnTheClock(page)

    await expect(page.getByRole('slider', { name: 'Raise amount' }).first()).toBeVisible()
    await expect(page.getByText('Fine tune')).toHaveCount(0)
    // And to the left of the number it sets, which is where the eye goes to
    // read what it is about to commit.
    const slider = (await page.locator('[data-slot="slider"]').boundingBox())!
    const amount = (await page.getByText(/^\d+ BB$/).boundingBox())!
    expect(slider.x + slider.width).toBeLessThanOrEqual(amount.x + amount.width)
  })

  test('and holds the slider without giving up the cards above it', async ({ page }) => {
    // The regression that took the band off the screen entirely was not the
    // resting state — it was reaching for the slider. Whatever shape that
    // control takes, using it must not cost the row above it.
    await page.setViewportSize({ width: 430, height: 745 })
    await seatOnTheClock(page)

    const slider = page.getByRole('slider', { name: 'Raise amount' }).first()
    const before = await measure(page)
    // Drag it somewhere in the middle of its range, the way a thumb would.
    const box = (await slider.boundingBox())!
    await page.mouse.move(box.x + box.width * 0.1, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width * 0.6, box.y + box.height / 2, { steps: 8 })
    await page.mouse.up()

    const after = await measure(page)
    expect(after.bandClippedBy).toBeLessThan(0.5)
    expect(after.controlsNeed).toBe(before.controlsNeed)
    // It moved: a control that cannot be dragged is a caption.
    await expect(page.getByRole('button', { name: /^Raise to |^Go all in for / })).toBeVisible()
  })
})
