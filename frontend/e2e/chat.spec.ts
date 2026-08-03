import {
  expect,
  test,
  type APIRequestContext,
  type Browser,
  type BrowserContext,
  type Page,
} from '@playwright/test'

const PASSWORD = 'friends-only'

type RoomSession = {
  roomId: string
  playerId: string
  token: string
  isHost: boolean
  spectator?: boolean
}

async function createRunningRoom(request: APIRequestContext) {
  const hostResponse = await request.post('/api/rooms', {
    data: {
      name: 'Friday table talk',
      hostName: 'Alex',
      startingChips: 1000,
      smallBlind: 5,
      bigBlind: 10,
      password: PASSWORD,
      actionSeconds: 0,
    },
  })
  expect(hostResponse.ok()).toBe(true)
  const host = (await hostResponse.json()) as RoomSession

  const guestResponse = await request.post(`/api/rooms/${host.roomId}/join`, {
    data: { name: 'Sam', password: PASSWORD },
  })
  expect(guestResponse.ok()).toBe(true)
  const guest = (await guestResponse.json()) as RoomSession

  const startResponse = await request.post(`/api/rooms/${host.roomId}/start`, {
    headers: { 'x-player-token': host.token },
    data: { playerId: host.playerId, action: 'start' },
  })
  expect(startResponse.ok()).toBe(true)

  const watchResponse = await request.post(`/api/rooms/${host.roomId}/watch`, {
    data: { password: PASSWORD },
  })
  expect(watchResponse.ok()).toBe(true)
  const spectator = (await watchResponse.json()) as RoomSession
  return { host, guest, spectator }
}

async function openRoom(
  browser: Browser,
  session: RoomSession,
  viewport: { width: number; height: number },
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ viewport })
  const page = await context.newPage()
  await page.addInitScript(
    ([roomId, serialized]) => {
      localStorage.setItem(`holdem:session:${roomId}`, serialized)
    },
    [session.roomId, JSON.stringify(session)] as const,
  )
  await page.goto(`/room/${session.roomId}`)
  await expect(page.getByRole('button', { name: 'Table talk', exact: true })).toBeVisible()
  return { context, page }
}

async function fixedLayout(page: Page) {
  return page.evaluate(() => {
    const main = document.querySelector('main#main-content') as HTMLElement
    const ownZone = document.querySelector('[data-own-zone]') as HTMLElement
    const mainRect = main.getBoundingClientRect()
    const ownRect = ownZone.getBoundingClientRect()
    return {
      mainHeight: mainRect.height,
      ownTop: ownRect.top,
      ownHeight: ownRect.height,
      pageScrolls: document.documentElement.scrollHeight > window.innerHeight,
    }
  })
}

test('players talk while spectators read, with a non-reflowing mobile sheet', async ({
  browser,
  request,
}) => {
  const { host, spectator } = await createRunningRoom(request)
  const hostRoom = await openRoom(browser, host, { width: 390, height: 844 })
  const rail = await openRoom(browser, spectator, { width: 390, height: 844 })

  try {
    // Opening once establishes the spectator's empty unread baseline and proves
    // the shared watch capability exposes no composer.
    const railTrigger = rail.page.getByRole('button', { name: 'Table talk', exact: true })
    await railTrigger.click()
    await expect(rail.page.getByText('The rail is quiet')).toBeVisible()
    await expect(
      rail.page.getByText(/watching — seated players can send table talk/i),
    ).toBeVisible()
    await expect(rail.page.getByRole('textbox', { name: 'Message the table' })).toHaveCount(0)
    await rail.page.getByRole('button', { name: 'Close table talk' }).click()
    const railBeforePreview = await fixedLayout(rail.page)

    const before = await fixedLayout(hostRoom.page)
    const hostTrigger = hostRoom.page.getByRole('button', {
      name: 'Table talk',
      exact: true,
    })
    await hostTrigger.click()
    const sheet = hostRoom.page.getByRole('dialog', { name: 'Table talk' })
    await expect(sheet).toBeVisible()
    await expect(hostRoom.page.getByRole('button', { name: 'Close table talk' })).toBeFocused()

    // The sheet is a body portal over the fixed game. It may cover the felt
    // while invited open, but it never changes the table's height or own zone.
    const after = await fixedLayout(hostRoom.page)
    expect(after.mainHeight).toBeCloseTo(before.mainHeight, 1)
    expect(after.ownTop).toBeCloseTo(before.ownTop, 1)
    expect(after.ownHeight).toBeCloseTo(before.ownHeight, 1)
    expect(after.pageScrolls).toBe(false)
    const sheetGeometry = await sheet.evaluate((dialog) => {
      const overlay = dialog.parentElement as HTMLElement
      const rect = dialog.getBoundingClientRect()
      return {
        overlayPosition: getComputedStyle(overlay).position,
        bottom: rect.bottom,
        viewport: window.innerHeight,
        safePadding: Number.parseFloat(getComputedStyle(dialog.querySelector('footer')!).paddingBottom),
      }
    })
    expect(sheetGeometry.overlayPosition).toBe('fixed')
    expect(sheetGeometry.bottom).toBeLessThanOrEqual(sheetGeometry.viewport + 0.5)
    expect(sheetGeometry.safePadding).toBeGreaterThan(0)

    const hostile = '<img src=x onerror="window.hacked=true"> nice river'
    await hostRoom.page.getByRole('textbox', { name: 'Message the table' }).fill(hostile)
    const posted = hostRoom.page.waitForResponse(
      (response) =>
        response.request().method() === 'POST' &&
        new URL(response.url()).pathname.endsWith(`/rooms/${host.roomId}/chat`),
    )
    await hostRoom.page.getByRole('button', { name: 'Send message' }).click()
    expect((await posted).ok()).toBe(true)
    await expect(hostRoom.page.getByText(hostile)).toBeVisible()
    await expect(hostRoom.page.getByRole('log').locator('img')).toHaveCount(0)

    // Closed polling raises one unread line and a shallow fixed preview without
    // moving the table. Text is a literal React node, never executable HTML.
    const unreadTrigger = rail.page.getByRole('button', {
      name: 'Table talk, 1 unread message',
    })
    await expect(unreadTrigger).toBeVisible({ timeout: 10_000 })
    const preview = rail.page.getByRole('complementary', {
      name: 'New table talk preview',
    })
    await expect(preview).toBeVisible()
    await expect(preview.getByText(hostile)).toBeVisible()
    await expect(preview.locator('img')).toHaveCount(0)
    const dismissTarget = await preview
      .getByRole('button', { name: 'Dismiss message preview' })
      .boundingBox()
    expect(dismissTarget?.width).toBeGreaterThanOrEqual(44)
    expect(dismissTarget?.height).toBeGreaterThanOrEqual(44)
    const railAfterPreview = await fixedLayout(rail.page)
    expect(railAfterPreview.mainHeight).toBeCloseTo(railBeforePreview.mainHeight, 1)
    expect(railAfterPreview.ownTop).toBeCloseTo(railBeforePreview.ownTop, 1)
    expect(railAfterPreview.ownHeight).toBeCloseTo(railBeforePreview.ownHeight, 1)
    expect(railAfterPreview.pageScrolls).toBe(false)
    await expect
      .poll(() =>
        preview.evaluate((element) =>
          getComputedStyle(element.parentElement as HTMLElement).position,
        ),
      )
      .toBe('fixed')

    await preview.getByRole('button', { name: 'Open table talk from Alex' }).click()
    await expect(rail.page.getByText(hostile)).toBeVisible()
    const railLog = rail.page.getByRole('log')
    await expect(railLog.getByText('Alex')).toBeVisible()
    await expect(railLog.locator('img')).toHaveCount(0)
    await expect(railTrigger).toHaveAccessibleName('Table talk')

    await rail.page.keyboard.press('Escape')
    await expect(rail.page.getByRole('dialog', { name: 'Table talk' })).toHaveCount(0)
    await expect(railTrigger).toBeFocused()
  } finally {
    await rail.context.close()
    await hostRoom.context.close()
  }
})
