import { expect, test, type Page } from '@playwright/test'

/**
 * The hand on the home screen: on the felt, and face up before the flop.
 *
 * Two things this checks that no unit test can. jsdom does no layout, so a card
 * that has drifted off the cloth is invisible to it — and the cloth is an
 * *ellipse*, so "inside the table's box" is not the question. The question is
 * whether the card is inside the curve, and the curve narrows as it goes up.
 * That is how the rivals' hands ended up floating on the page background on a
 * long phone while every number in the CSS looked reasonable.
 *
 * The second is the order of the story. The whole reason this is an all-in is
 * that it lets the six hole cards turn over BEFORE the board runs out — which
 * is what a real table does and what makes the run-out worth watching. If the
 * beats ever slide, the scene still animates and still looks fine, and quietly
 * stops being the thing it was drawn to show. So the clock is driven by hand
 * and the frames are read.
 */

/** The scene's own clock, from `--cycle` in globals.css. */
const CYCLE_MS = 13_000
/**
 * The last moment before the flop exists.
 *
 * 42.5%: past 41.2%, where the rivals' cards have finished turning over
 * (`home-hide-rival`), and short of 43%, where the flop starts fading in
 * (`home-street-flop`). That gap is the claim — six cards face up and no board
 * — and it is a real gap on purpose, not a rounding artefact.
 */
const BEFORE_FLOP_MS = CYCLE_MS * 0.425
/** After the river has turned and the winning hand has lit. */
const SHOWDOWN_MS = CYCLE_MS * 0.82

const PHONES = [
  { name: 'iPhone SE — the floor', width: 320, height: 568 },
  { name: 'the common Android', width: 360, height: 640 },
  { name: 'Pixel with browser chrome', width: 393, height: 727 },
  { name: 'iPhone 15 Pro Max, Safari', width: 430, height: 745 },
  // Long enough to trip the container query that makes the table round. This
  // is the shape the rivals' hands fell off.
  { name: 'iPhone 14', width: 390, height: 844 },
]

/** Park every animation on the same frame of the cycle. */
async function freezeAt(page: Page, ms: number) {
  await page.evaluate((at) => {
    for (const animation of document.getAnimations()) {
      try {
        animation.pause()
        animation.currentTime = at
      } catch {
        // A finished or idle animation has nothing to seek; it is already
        // showing the frame we are asking about.
      }
    }
  }, ms)
}

async function readScene(page: Page) {
  return page.evaluate(() => {
    const de = document.documentElement
    const table = document.querySelector('.home-table')!.getBoundingClientRect()
    // The cloth read off the element that draws it, not off the stylesheet: the
    // point of this check is to catch the two disagreeing.
    const felt = document.querySelector('.baize')!.getBoundingClientRect()
    const cx = felt.left + felt.width / 2
    const cy = felt.top + felt.height / 2
    const rx = felt.width / 2
    const ry = felt.height / 2
    /** 1 is the edge of the cloth. Over 1 is off the table. */
    const howFarOut = (el: Element) => {
      const r = el.getBoundingClientRect()
      const corners = [
        [r.left, r.top],
        [r.right, r.top],
        [r.left, r.bottom],
        [r.right, r.bottom],
      ]
      return Math.max(
        ...corners.map(([x, y]) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2),
      )
    }
    const faceUp = (card: Element) =>
      Number(getComputedStyle(card.querySelector('.home-back')!).opacity) < 0.01
    const shown = (el: Element) => Number(getComputedStyle(el).opacity) > 0.01

    const seat = (at: string) => [
      ...document.querySelectorAll(`.home-seat[data-at="${at}"] .home-card`),
    ]
    const board = [...document.querySelectorAll('.home-board .home-card')]
    const create = [...document.querySelectorAll('button')].find((b) =>
      /Create table/.test(b.textContent ?? ''),
    )
    const createRect = create?.getBoundingClientRect()

    return {
      pageScrolls: de.scrollHeight > de.clientHeight,
      create: createRect
        ? {
            top: +createRect.top.toFixed(1),
            bottom: +createRect.bottom.toFixed(1),
            visible: createRect.top >= -0.5 && createRect.bottom <= window.innerHeight + 0.5,
          }
        : null,
      table: { w: +table.width.toFixed(1), h: +table.height.toFixed(1) },
      // Everything that is supposed to be lying on the cloth. Your own hand is
      // not in this list: it sits at the near rail, half off the table, which
      // is where your cards are when you are the one holding them.
      onFelt: [...seat('l'), ...seat('r'), ...board].map((c) => ({
        rank: c.querySelector('.home-rank')!.textContent,
        out: +howFarOut(c).toFixed(2),
      })),
      holeCardsFaceUp: [...seat('l'), ...seat('r'), ...seat('me')].filter(faceUp).length,
      boardShown: board.filter(shown).length,
      boardFaceUp: board.filter(faceUp).length,
      lit: document.querySelectorAll('.home-card[data-win]').length,
      photos: [...document.querySelectorAll('.home-avatar img')].map(
        (img) => (img as HTMLImageElement).naturalWidth,
      ),
    }
  })
}

for (const phone of PHONES) {
  test(`${phone.name} (${phone.width}×${phone.height})`, async ({ page }) => {
    await page.setViewportSize({ width: phone.width, height: phone.height })
    await page.goto('/')
    await expect(page.getByRole('button', { name: /Create table/ })).toBeVisible()

    // ── The flop is about to land, and the hands are already turned over.
    await freezeAt(page, BEFORE_FLOP_MS)
    const atFlop = await readScene(page)

    expect(atFlop.pageScrolls, 'the home screen scrolls').toBe(false)
    expect(atFlop.create, 'the create button was not rendered').not.toBeNull()
    expect(
      atFlop.create!.visible,
      `Create table at ${atFlop.create!.top}–${atFlop.create!.bottom} of ${phone.height}`,
    ).toBe(true)
    expect(atFlop.photos, 'three faces at the table').toHaveLength(3)
    for (const width of atFlop.photos) expect(width, 'a photo did not load').toBeGreaterThan(0)

    // The point of the whole scene: six cards face up with the board still to
    // come. If this ever reads 0, the run-out is being dealt over cards nobody
    // has seen and there is nothing at stake in it.
    expect(atFlop.holeCardsFaceUp, 'the hands are not up before the flop').toBe(6)
    expect(atFlop.boardShown, 'the board arrived before the hands turned over').toBe(0)

    // ── After the river, with the winning hand lit.
    await freezeAt(page, SHOWDOWN_MS)
    const atShowdown = await readScene(page)

    expect(atShowdown.boardShown, 'the board is not complete').toBe(5)
    expect(atShowdown.boardFaceUp, 'a board card is still face down').toBe(5)
    // Four sevens and the ace kicker.
    expect(atShowdown.lit, 'the winning five are not marked').toBe(5)

    /* And nothing is lying off the cloth. An ellipse pulls in as it rises, so
       a card can be well inside the table's box and still be on the page
       background — which is what happened the moment the table went round on a
       long phone. Measured against the element that draws the felt. */
    for (const card of atShowdown.onFelt) {
      expect(card.out, `${card.rank} sits at ${card.out} of the felt's radius`).toBeLessThanOrEqual(
        1,
      )
    }
  })
}
