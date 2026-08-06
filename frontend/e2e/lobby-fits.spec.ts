import { expect, test, type Page } from '@playwright/test'

/**
 * The lobby fits the phone it is played on, and the action is always in sight.
 *
 * This gate did not exist, and that is why the screen shipped broken. The
 * table has `your-zone-fits`, the home has the viewport tests in
 * `host-conversion`, and the lobby — which had just grown a whole card of
 * house rules — had nothing. Measured at 320×568 the day it went live: the
 * seat ring cropped 133px off the top, "Invite players" at 598 on a 568-tall
 * screen, and `scrollHeight === clientHeight`, so it could not be scrolled to
 * either. Centring a flex child taller than its container clips it at *both*
 * ends, silently, which is this repo's signature failure.
 *
 * jsdom cannot make this check. It does no layout, so a unit test here would
 * only ever compare constants to each other while the browser cropped.
 */

const PASSWORD = 'friends-only'

/** Every phone this is played on, and the two that are only short. */
const PHONES = [
  { name: 'iPhone SE — the floor', width: 320, height: 568 },
  { name: 'the common Android', width: 360, height: 640 },
  { name: 'iPhone SE 2/3', width: 375, height: 667 },
  { name: 'iPhone 14', width: 390, height: 844 },
  // Not a device size: a tall phone with the browser's chrome showing, which
  // is what everybody actually has. It is where this broke by one pixel.
  { name: 'Pixel with browser chrome', width: 393, height: 727 },
  { name: 'iPhone 15 Pro Max, Safari', width: 430, height: 745 },
]

async function lobby(page: Page, seats: number) {
  const api = page.request
  const host = await (
    await api.post('/api/rooms', {
      data: {
        name: 'Poker Night',
        hostName: 'Andy',
        startingChips: 1000,
        smallBlind: 5,
        bigBlind: 10,
        password: PASSWORD,
      },
    })
  ).json()
  for (let i = 1; i < seats; i++) {
    await api.post(`/api/rooms/${host.roomId}/join`, {
      data: { name: `Player ${i}`, password: PASSWORD },
    })
  }
  await page.addInitScript(
    ([id, value]) => localStorage.setItem(`holdem:session:${id}`, value),
    [
      host.roomId,
      JSON.stringify({
        roomId: host.roomId,
        playerId: host.playerId,
        token: host.token,
        isHost: true,
      }),
    ] as const,
  )
  await page.goto(`/room/${host.roomId}`)
  await expect(page.getByRole('button', { name: 'Invite players' })).toBeVisible()
}

async function measure(page: Page) {
  return page.evaluate(() => {
    const de = document.documentElement
    const seen = (el: Element | null | undefined) => {
      const r = el?.getBoundingClientRect()
      if (!r) return null
      return {
        top: +r.top.toFixed(1),
        bottom: +r.bottom.toFixed(1),
        visible: r.top >= -0.5 && r.bottom <= window.innerHeight + 0.5,
      }
    }
    const byText = (re: RegExp) =>
      [...document.querySelectorAll('button, [role=status]')].find((el) =>
        re.test(el.textContent ?? ''),
      )
    const rail = document.querySelector('.lobby-seat-rail')
    return {
      pageScrolls: de.scrollHeight > de.clientHeight,
      invite: seen(byText(/Invite players/)),
      // Whichever of the three the host is being shown.
      action: seen(byText(/Start game|One more player|Waiting for the host/)),
      railTop: rail ? +rail.getBoundingClientRect().top.toFixed(1) : null,
    }
  })
}

for (const phone of PHONES) {
  // One seat is the host alone, which is what everybody sees first. Nine is the
  // full table, which is the tallest the list ever gets.
  for (const seats of [1, 9]) {
    test(`${phone.name} (${phone.width}×${phone.height}) · ${seats} seated`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: phone.width, height: phone.height })
      await lobby(page, seats)
      const m = await measure(page)

      // The whole of the claim: the button that does the thing is on screen,
      // whatever is above it. It is pinned, so this holds before anybody
      // scrolls anything.
      expect(m.invite, 'the invite button was not rendered').not.toBeNull()
      expect(m.invite!.visible, `invite at ${m.invite!.top}–${m.invite!.bottom}`).toBe(true)
      expect(m.action, 'the start action was not rendered').not.toBeNull()
      expect(m.action!.visible, `action at ${m.action!.top}–${m.action!.bottom}`).toBe(true)

      // And the page itself does not scroll: the table is the constant, and a
      // lobby that pushes the document is a lobby that has stopped being one.
      expect(m.pageScrolls).toBe(false)

      // The seat ring starts on screen rather than above it. This is the one
      // that failed silently — cropped by an ancestor, with nothing to scroll.
      expect(m.railTop, 'the seat ring was cropped off the top').toBeGreaterThanOrEqual(0)
    })
  }
}
