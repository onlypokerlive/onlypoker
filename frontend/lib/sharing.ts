export type InviteShareResult = 'native' | 'clipboard' | 'cancelled'

export function buildInviteUrl(origin: string, roomId: string): string {
  return `${origin.replace(/\/$/, '')}/join/${encodeURIComponent(roomId)}`
}

function cancelled(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

export async function shareInvite({
  roomId,
  roomName,
}: {
  roomId: string
  roomName: string
}): Promise<InviteShareResult> {
  const url = buildInviteUrl(window.location.origin, roomId)
  const data: ShareData = {
    title: `${roomName} · Felt & Gold`,
    text: `Take a seat at ${roomName}. No account or download needed.`,
    url,
  }

  if (typeof navigator.share === 'function') {
    try {
      await navigator.share(data)
      return 'native'
    } catch (error) {
      if (cancelled(error)) return 'cancelled'
      // A browser can advertise Web Share and still reject a particular
      // invocation. Clipboard remains a useful invitation in that case.
    }
  }

  if (!navigator.clipboard?.writeText) {
    throw new Error('Sharing is not available in this browser.')
  }
  await navigator.clipboard.writeText(url)
  return 'clipboard'
}
