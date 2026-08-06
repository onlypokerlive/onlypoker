import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test'

const PASSWORD = 'friends-only'

async function createTable(
  browser: Browser,
  viewport = { width: 390, height: 844 },
): Promise<{ context: BrowserContext; page: Page; roomId: string }> {
  const context = await browser.newContext({
    viewport,
    permissions: ['clipboard-read', 'clipboard-write'],
  })
  // Native share sheets require a person to dismiss operating-system UI. This
  // journey exercises the real clipboard/download fallbacks; focused tests
  // cover native success and cancellation separately.
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: undefined,
    })
  })
  const page = await context.newPage()
  await page.goto('/')
  const form = page.locator('#create-table form')
  await expect(form).toHaveCount(1)
  await expect(form).toHaveAttribute('data-ready', 'true')
  await form.getByLabel(/Your profile/).fill('Alex')
  await form.getByLabel('Password').fill(PASSWORD)
  await form.getByRole('button', { name: 'Create table' }).click()
  await page.waitForURL(/\/room\/[A-Z0-9]+$/)

  // A one-hand table keeps the browser journey deterministic without bypassing
  // the product UI: one all-in and call produces a real final table. The rules
  // now live in the lobby, so this is where the stack is cut down to two big
  // blinds — through the sheet a host would use, not through the API.
  await page.getByRole('button', { name: 'Adjust the detail' }).click()
  const sheet = page.getByRole('dialog', { name: 'Adjust the detail' })
  const stack = sheet.getByRole('group', { name: 'What everybody starts with' })
  await stack.getByRole('button', { name: 'Other' }).click()
  await sheet.getByLabel('What everybody starts with, exact value').fill('2')
  // And the door shut behind whoever busts. Every format buys back in twice by
  // default, and a table that can still be rejoined correctly refuses to crown
  // anybody — which is right, and is not the journey under test here.
  await sheet.getByText('Doors and rebuys').click()
  await sheet
    .getByRole('group', { name: 'Buying back in' })
    .getByRole('button', { name: 'No' })
    .click()
  await sheet.getByRole('button', { name: 'Save' }).click()
  await expect(sheet).toHaveCount(0)
  await expect(page.getByText('20 · 2 blinds')).toBeVisible()

  return {
    context,
    page,
    roomId: page.url().split('/').at(-1)!,
  }
}

async function joinTable(
  browser: Browser,
  roomId: string,
  viewport = { width: 1440, height: 900 },
): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext({ viewport })
  const page = await context.newPage()
  await page.goto(`/join/${roomId}`)
  await page.getByLabel('Your name (for a seat)').fill('Sam')
  await page.getByLabel('Room password').fill(PASSWORD)
  await page.getByRole('button', { name: 'Take a seat' }).click()
  await page.waitForURL(new RegExp(`/room/${roomId}$`))
  return { context, page }
}

test.describe('responsive host-conversion journey', () => {
  for (const viewport of [
    { width: 320, height: 568 },
    { width: 375, height: 667 },
    { width: 390, height: 844 },
  ]) {
    test(`keeps the creation action in the initial ${viewport.width}x${viewport.height} viewport`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport)
      await page.goto('/')

      const form = page.locator('#create-table form')
      await expect(form).toHaveCount(1)
      await expect(form).toHaveAttribute('data-ready', 'true')
      const create = form.getByRole('button', { name: 'Create table' })
      await expect(create).toBeVisible()
      const buttonBox = await create.boundingBox()

      expect(buttonBox).not.toBeNull()
      expect(buttonBox!.y + buttonBox!.height).toBeLessThanOrEqual(viewport.height)

      // And nothing on this screen is a rule of the game. The button used to
      // be pushed under the fold by twenty controls that belong in the lobby,
      // so "it fits" is only half the claim worth holding.
      await expect(form.getByText('Customize the night')).toHaveCount(0)
      await expect(form.getByRole('textbox')).toHaveCount(3)
    })
  }

  test('runs host and guest from creation through results and the next table', async ({ browser }) => {
    const host = await createTable(browser)

    await host.page.getByRole('button', { name: 'Invite players' }).click()
    await expect(host.page.getByRole('button', { name: 'Invite ready' })).toBeVisible()

    const guest = await joinTable(browser, host.roomId)

    await expect(host.page.getByRole('button', { name: 'Start game' })).toBeVisible()
    await expect(guest.page.getByText('Waiting for the host to start the game…')).toBeVisible()
    await host.page.getByRole('button', { name: 'Start game' }).click()

    await expect(host.page.getByRole('button', { name: 'Invite players' })).toBeVisible()
    await expect(guest.page.getByRole('button', { name: 'Invite players' })).toBeVisible()

    await expect
      .poll(async () =>
        (await host.page.getByRole('button', { name: /^All-in/ }).isVisible()) ||
        (await guest.page.getByRole('button', { name: /^All-in/ }).isVisible()),
      )
      .toBe(true)
    const firstActorIsHost = await host.page
      .getByRole('button', { name: /^All-in/ })
      .isVisible()
    const firstActor = firstActorIsHost ? host.page : guest.page
    const firstActorName = firstActorIsHost ? 'Alex' : 'Sam'
    const secondActor = firstActorIsHost ? guest.page : host.page
    const waitForAction = (page: Page) =>
      page.waitForResponse(
        (response) =>
          response.request().method() === 'POST' &&
          new URL(response.url()).pathname.endsWith(`/rooms/${host.roomId}/action`),
      )

    const allInResponse = waitForAction(firstActor)
    await firstActor.getByRole('button', { name: /^All-in/ }).click()
    expect((await allInResponse).ok()).toBe(true)

    // The fixed mobile action zone can briefly retain the previous poll's
    // controls. Wait until this browser has observed the all-in before using
    // its freshly rendered call action.
    await expect(
      secondActor.getByText(new RegExp(`${firstActorName} is all-in for`)),
    ).toBeVisible()
    const call = secondActor.getByRole('button', { name: /^Call/ })
    await expect(call).toBeEnabled()
    const callResponse = waitForAction(secondActor)
    await call.click()
    expect((await callResponse).ok()).toBe(true)

    await expect(host.page.getByText('Keep the night going')).toBeVisible({ timeout: 25_000 })
    await expect(guest.page.getByText('Keep the night going')).toBeVisible({ timeout: 25_000 })
    await expect(host.page.getByText('The final hand')).toBeVisible()
    await expect(host.page.getByRole('button', { name: 'Share the night' })).toBeVisible()
    await expect(host.page.getByRole('button', { name: 'Play again' })).toBeVisible()
    await expect(guest.page.getByRole('button', { name: 'Create your table' })).toBeVisible()

    const posterDownload = host.page.waitForEvent('download')
    await host.page.getByRole('button', { name: 'Share the night' }).click()
    await expect((await posterDownload).suggestedFilename()).toBe(
      'poker-night-final-table.png',
    )

    await guest.page.getByRole('button', { name: 'Create your table' }).click()
    const nextTableForm = guest.page.locator('#create-table form')
    await expect(nextTableForm).toHaveAttribute('data-ready', 'true')
    await nextTableForm.getByLabel(/Your profile/).fill('Sam')
    await nextTableForm.getByLabel('Password').fill(PASSWORD)
    await nextTableForm.getByRole('button', { name: 'Create table' }).click()
    await guest.page.waitForURL(/\/room\/[A-Z0-9]+$/)
    await expect(guest.page.getByRole('button', { name: 'Invite players' })).toBeVisible()

    await host.page.getByRole('button', { name: 'Play again' }).click()
    await expect(host.page).toHaveURL(new RegExp(`/room/${host.roomId}$`))
    await expect(host.page.getByRole('button', { name: 'Start game' })).toBeVisible()

    await guest.context.close()
    await host.context.close()
  })

  test('recovers and intentionally hands off accountless host authority', async ({ browser }) => {
    const originalHost = await createTable(browser, { width: 1440, height: 900 })
    await originalHost.page.getByText('Host controls').click()
    const recoveryCode = await originalHost.page.locator('code').textContent()
    expect(recoveryCode?.trim()).toBeTruthy()

    const recoveredContext = await browser.newContext({ viewport: { width: 390, height: 844 } })
    const recoveredPage = await recoveredContext.newPage()
    await recoveredPage.goto(`/join/${originalHost.roomId}`)
    await recoveredPage.getByLabel('Room password').fill(PASSWORD)
    await recoveredPage.getByText('Host on a new device?').click()
    await recoveredPage.getByLabel('Host backup code').fill(recoveryCode!.trim())
    await recoveredPage.getByRole('button', { name: 'Recover host access' }).click()
    await recoveredPage.waitForURL(new RegExp(`/room/${originalHost.roomId}$`))
    await expect(recoveredPage.getByText('Host controls')).toBeVisible()

    // Rotating authority signs the old device out rather than leaving two hosts.
    await expect(originalHost.page).toHaveURL(new RegExp(`/join/${originalHost.roomId}$`), {
      timeout: 12_000,
    })

    const guest = await joinTable(browser, originalHost.roomId)
    await recoveredPage.getByText('Host controls').click()
    await recoveredPage.getByRole('button', { name: 'Make Sam the host' }).click()
    await recoveredPage.getByRole('button', { name: 'Make host' }).click()
    await expect(guest.page.getByText('Host controls')).toBeVisible({ timeout: 12_000 })
    await expect(recoveredPage.getByText('Host controls')).toHaveCount(0)

    await guest.context.close()
    await recoveredContext.close()
    await originalHost.context.close()
  })

  test('turns a confirmed expired invitation into a clear recovery path', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 })
    await page.goto('/join/DOESNOTEXIST')
    await expect(page.getByRole('heading', { name: 'This invitation has expired' })).toBeVisible()
    await page.getByRole('link', { name: 'Create your table' }).click()
    await expect(page.getByRole('button', { name: 'Create table' })).toBeVisible()
  })
})
