import type { Metadata } from 'next'
import Link from 'next/link'
import { Spade } from 'lucide-react'

import { JoinRoomForm } from '@/components/join-room-form'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { getRoomPreview } from '@/lib/room-preview'

type JoinPageProps = {
  params: Promise<{ roomId: string }>
}

function inviteDescription(
  preview: Awaited<ReturnType<typeof getRoomPreview>>,
  roomId: string,
) {
  if (!preview) return `Take a seat at private poker table ${roomId}. No account or download needed.`
  const status =
    preview.phase === 'lobby'
      ? `${preview.playerCount}/${preview.maxSeats} seats filled`
      : preview.phase === 'finished'
        ? `Final table after ${preview.handNumber} hands`
        : `Hand ${preview.handNumber} in progress`
  return `${status} · ${preview.smallBlind}/${preview.bigBlind} blinds · No account or download needed.`
}

export async function generateMetadata({ params }: JoinPageProps): Promise<Metadata> {
  const { roomId } = await params
  const preview = await getRoomPreview(roomId)
  const roomName = preview?.name ?? 'Private poker table'
  const description = inviteDescription(preview, roomId)

  return {
    title: `Join ${roomName} · Felt & Gold`,
    description,
    openGraph: {
      title: `You have a seat at ${roomName}`,
      description,
      type: 'website',
    },
    twitter: {
      card: 'summary_large_image',
      title: `You have a seat at ${roomName}`,
      description,
    },
  }
}

export default async function JoinPage({ params }: JoinPageProps) {
  const { roomId } = await params
  const preview = await getRoomPreview(roomId)

  return (
    <main className="flex min-h-dvh items-center justify-center px-5 py-10">
      <div className="w-full max-w-md">
        <Link
          href="/"
          className="mb-6 inline-flex min-h-11 items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <Spade className="size-4 text-primary" aria-hidden />
          Felt &amp; Gold
        </Link>

        <Card className="border-primary/15 shadow-xl">
          <CardHeader>
            <CardTitle className="font-serif text-2xl">
              {preview?.name ?? 'Join the table'}
            </CardTitle>
            <CardDescription>
              {preview ? (
                <>
                  <span className="mb-2 block font-mono text-xs font-semibold text-foreground">
                    {preview.playerCount}/{preview.maxSeats} seats · {preview.smallBlind}/
                    {preview.bigBlind} blinds
                  </span>
                  You’ve been invited to a private table. Enter your name and
                  the room password.
                </>
              ) : (
                <>
                  You’ve been invited to room{' '}
                  <span className="font-mono font-semibold text-foreground">
                    {roomId}
                  </span>
                  . Enter your name and the room password.
                </>
              )}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <JoinRoomForm roomId={roomId} />
          </CardContent>
        </Card>
      </div>
    </main>
  )
}
