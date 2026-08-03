import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

import { ChatSheet } from '@/components/chat-sheet'
import { pokerApi, type ChatView, type Session } from '@/lib/poker-api'

const player: Session = {
  roomId: 'ROOM42',
  playerId: 'public-seat-id',
  token: 'private-player-capability',
  isHost: false,
}

const emptyChat: ChatView = {
  messages: [],
  canSend: true,
  serverTime: 1_700_000_000_000,
}

describe('ChatSheet', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it('stays out of the table layout, traps focus, and restores the trigger', async () => {
    vi.spyOn(pokerApi, 'getChat').mockResolvedValue(emptyChat)
    render(<ChatSheet roomId={player.roomId} session={player} />)
    await waitFor(() => expect(pokerApi.getChat).toHaveBeenCalledOnce())

    const trigger = screen.getByRole('button', { name: 'Table talk' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    await userEvent.click(trigger)

    const dialog = screen.getByRole('dialog', { name: 'Table talk' })
    expect(document.body.contains(dialog)).toBe(true)
    expect(screen.getByRole('button', { name: 'Close table talk' })).toHaveFocus()
    expect(document.body.style.overflow).toBe('hidden')

    // With the close control first and an enabled send control last, both
    // edges wrap inside the dialog instead of letting focus reach the table.
    fireEvent.change(screen.getByRole('textbox', { name: 'Message the table' }), {
      target: { value: 'focus trap check' },
    })
    const send = screen.getByRole('button', { name: 'Send message' })
    expect(send).toBeEnabled()
    await userEvent.keyboard('{Shift>}{Tab}{/Shift}')
    expect(send).toHaveFocus()
    await userEvent.keyboard('{Tab}')
    expect(screen.getByRole('button', { name: 'Close table talk' })).toHaveFocus()

    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(trigger).toHaveFocus()
    expect(document.body.style.overflow).toBe('')
  })

  it('shows authenticated spectators the messages without a composer', async () => {
    const spectator: Session = {
      ...player,
      playerId: 'watch-random-label',
      token: 'shared-watch-capability',
      spectator: true,
    }
    vi.spyOn(pokerApi, 'getChat').mockResolvedValue({
      messages: [
        {
          id: 'server-message-1',
          authorName: 'Nina',
          text: 'Nice call',
          createdAt: 1_700_000_000_000,
          isMine: false,
        },
      ],
      canSend: false,
      serverTime: 1_700_000_001_000,
    })

    render(<ChatSheet roomId={spectator.roomId} session={spectator} />)
    await waitFor(() => expect(pokerApi.getChat).toHaveBeenCalledOnce())
    expect(
      screen.queryByRole('complementary', { name: 'New table talk preview' }),
    ).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Table talk' }))

    expect(screen.getByText('Nice call')).toBeInTheDocument()
    expect(screen.getByText(/watching — seated players can send/i)).toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: 'Message the table' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Send message' })).not.toBeInTheDocument()
  })

  it('sends only text plus a retry id and renders hostile-looking text literally', async () => {
    const hostile = '<img src=x onerror="window.hacked=true"> nice river'
    vi.spyOn(pokerApi, 'getChat').mockResolvedValue(emptyChat)
    const sendChat = vi.spyOn(pokerApi, 'sendChat').mockResolvedValue({
      messages: [
        {
          id: 'server-owned-stable-id',
          authorName: 'Actual seat name',
          text: hostile,
          createdAt: 1_700_000_002_000,
          isMine: true,
        },
      ],
      canSend: true,
      serverTime: 1_700_000_002_000,
    })

    render(<ChatSheet roomId={player.roomId} session={player} />)
    await waitFor(() => expect(pokerApi.getChat).toHaveBeenCalledOnce())
    await userEvent.click(screen.getByRole('button', { name: 'Table talk' }))
    const composer = screen.getByRole('textbox', { name: 'Message the table' })
    expect(composer).toHaveAttribute('maxlength', '280')
    await userEvent.type(composer, hostile)
    await userEvent.click(screen.getByRole('button', { name: 'Send message' }))

    await waitFor(() => expect(sendChat).toHaveBeenCalledOnce())
    expect(sendChat).toHaveBeenCalledWith(
      player.roomId,
      player.token,
      hostile,
      expect.any(String),
    )
    expect(screen.getByText(hostile)).toBeInTheDocument()
    expect(screen.getByRole('log').querySelector('img')).toBeNull()
  })

  it('previews only new stable ids while closed, with dismiss and open actions', async () => {
    const getChat = vi.spyOn(pokerApi, 'getChat').mockResolvedValueOnce(emptyChat)
    render(<ChatSheet roomId={player.roomId} session={player} />)
    await waitFor(() => expect(getChat).toHaveBeenCalledOnce())
    expect(screen.getByRole('button', { name: 'Table talk' })).toHaveAccessibleName(
      'Table talk',
    )

    getChat.mockResolvedValue({
      messages: [
        {
          id: 'new-server-id',
          authorName: 'Mara',
          text: '<b>I saw that bluff</b>',
          createdAt: 1_700_000_003_000,
          isMine: false,
        },
      ],
      canSend: true,
      serverTime: 1_700_000_003_000,
    })
    fireEvent(document, new Event('visibilitychange'))

    const trigger = await screen.findByRole('button', {
      name: 'Table talk, 1 unread message',
    })
    const firstPreview = screen.getByRole('complementary', {
      name: 'New table talk preview',
    })
    expect(within(firstPreview).getByText('<b>I saw that bluff</b>')).toBeInTheDocument()
    expect(firstPreview.querySelector('b')).toBeNull()
    await userEvent.click(
      within(firstPreview).getByRole('button', { name: 'Dismiss message preview' }),
    )
    expect(
      screen.queryByRole('complementary', { name: 'New table talk preview' }),
    ).not.toBeInTheDocument()
    expect(trigger).toHaveAccessibleName('Table talk, 1 unread message')
    await waitFor(() => expect(trigger).toHaveFocus())
    expect(localStorage.getItem(`holdem:chat-read:${player.roomId}`)).toBeNull()

    getChat.mockResolvedValue({
      messages: [
        {
          id: 'new-server-id',
          authorName: 'Mara',
          text: '<b>I saw that bluff</b>',
          createdAt: 1_700_000_003_000,
          isMine: false,
        },
        {
          id: 'newest-server-id',
          authorName: 'Jo',
          text: 'Your action',
          createdAt: 1_700_000_004_000,
          isMine: false,
        },
      ],
      canSend: true,
      serverTime: 1_700_000_004_000,
    })
    fireEvent(document, new Event('visibilitychange'))

    const secondPreview = await screen.findByRole('complementary', {
      name: 'New table talk preview',
    })
    expect(within(secondPreview).getByText('Your action')).toBeInTheDocument()
    await userEvent.click(
      within(secondPreview).getByRole('button', { name: 'Open table talk from Jo' }),
    )
    expect(screen.getByRole('dialog', { name: 'Table talk' })).toBeInTheDocument()
    expect(screen.getByText('Your action')).toBeInTheDocument()
    expect(trigger).toHaveAccessibleName('Table talk')
    await waitFor(() =>
      expect(localStorage.getItem(`holdem:chat-read:${player.roomId}`)).toBe(
        'newest-server-id',
      ),
    )
  })
})
