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
    const invite = byText(/Invite players/)
    const action = byText(/Start game|One more player|Waiting for the host/)
    // The four formats are the middle of the screen, and the thing the two
    // buttons have to sit either side of.
    const formats = [...document.querySelectorAll('button')].filter((el) =>
      /^(Fast|Classic|Chaos|The 7-2)/.test(el.textContent?.trim() ?? ''),
    )
    const box = (els: Element[]) => {
      if (!els.length) return null
      const rects = els.map((el) => el.getBoundingClientRect())
      return {
        top: +Math.min(...rects.map((r) => r.top)).toFixed(1),
        bottom: +Math.max(...rects.map((r) => r.bottom)).toFixed(1),
      }
    }

    /* Pinned or in flow, answered by scrolling rather than by reading CSS.
       Walk up from the formats to whatever actually scrolls, run it to the
       end, and see which of the two buttons came along. */
    let scroller: Element | null = formats[0] ?? null
    while (scroller && scroller.scrollHeight <= scroller.clientHeight + 1) {
      scroller = scroller.parentElement
    }
    const before = { invite: seen(invite), action: seen(action) }
    if (scroller) scroller.scrollTop = scroller.scrollHeight
    const after = { invite: seen(invite), action: seen(action) }
    if (scroller) scroller.scrollTop = 0

    return {
      pageScrolls: de.scrollHeight > de.clientHeight,
      invite: before.invite,
      // Whichever of the three the host is being shown.
      action: before.action,
      formats: box(formats),
      railTop: rail ? +rail.getBoundingClientRect().top.toFixed(1) : null,
      // The fine print that says who starts it and how many it takes.
      fineprint: [...document.querySelectorAll('p, span')].some((el) =>
        /Two is enough to deal/.test(el.textContent ?? ''),
      ),
      scrolls: Boolean(scroller),
      /* Order asked of the DOM, not of the geometry. The formats live inside
         the scroll area, so once the list is longer than the box their rects
         carry on past the pinned footer even though nothing is drawn there —
         comparing those two numbers measures the overflow, not the order. */
      order:
        invite && formats[0] && action
          ? {
              inviteBeforeFormats: Boolean(
                invite.compareDocumentPosition(formats[0]) &
                  Node.DOCUMENT_POSITION_FOLLOWING,
              ),
              formatsBeforeAction: Boolean(
                formats[formats.length - 1]!.compareDocumentPosition(action) &
                  Node.DOCUMENT_POSITION_FOLLOWING,
              ),
            }
          : null,
      movedOnScroll: {
        invite:
          before.invite && after.invite
            ? +Math.abs(after.invite.top - before.invite.top).toFixed(1)
            : null,
        action:
          before.action && after.action
            ? +Math.abs(after.action.top - before.action.top).toFixed(1)
            : null,
      },
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

      /* And the order is the approved one: ring, invite, the formats, and the
         one button that deals the cards on its own at the bottom.
         Invite belongs to the ring — it is what you do about the empty seats
         you are looking at — and it stops being that the moment it is filed
         next to "Start game", where it reads as the other half of a choice
         nobody is making. */
      expect(m.formats, 'the four formats were not rendered').not.toBeNull()
      expect(m.order, 'could not find all three of ring, invite and action').not.toBeNull()
      expect(m.order!.inviteBeforeFormats, 'the invite is below the formats').toBe(true)
      expect(m.order!.formatsBeforeAction, 'the action is above the formats').toBe(true)
      // And on screen the invite really is under the ring rather than beside
      // something else: it starts below where the seats end.
      expect(
        m.invite!.top,
        `invite at ${m.invite!.top}, ring ends at ${m.railTop}+`,
      ).toBeGreaterThan(m.railTop!)

      // Pinned, and the invite is not: scrolling to the bottom moves one and
      // leaves the other exactly where it was.
      if (m.scrolls) {
        expect(m.movedOnScroll.action, 'the start action is not pinned').toBeLessThanOrEqual(0.5)
        expect(m.movedOnScroll.invite, 'the invite is pinned too').toBeGreaterThan(0.5)
      }

      // "You start it. Two is enough to deal." — the line that answers the
      // two questions a host has while staring at eight empty seats.
      if (seats === 1) expect(m.fineprint, 'the fine print under the button is missing').toBe(true)
    })
  }
}
