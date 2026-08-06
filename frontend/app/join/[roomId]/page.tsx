import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowLeft, Plus, Spade } from 'lucide-react'

import { JoinRoomForm } from '@/components/join-room-form'
import { InvitationTelemetry } from '@/components/invitation-telemetry'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { getRoomPreview, getRoomPreviewResult } from '@/lib/room-preview'
import { APP_NAME } from '@/lib/app-name'

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
    title: `Join ${roomName} · ${APP_NAME}`,
    description,
    openGraph: {
      title: `You’re invited to ${roomName}`,
      description,
      type: 'website',
    },
    twitter: {
      card: 'summary_large_image',
      title: `You’re invited to ${roomName}`,
      description,
    },
  }
}

export default async function JoinPage({ params }: JoinPageProps) {
  const { roomId } = await params
  const result = await getRoomPreviewResult(roomId)
  const preview = result.status === 'available' ? result.preview : null

  return (
    <main id="main-content" tabIndex={-1} className="flex min-h-dvh items-center justify-center px-5 py-10 outline-none">
      <div className="w-full max-w-md">
        <Link
          href="/"
          className="mb-6 inline-flex min-h-11 items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <Spade className="size-4 text-primary" aria-hidden />
          {APP_NAME}
        </Link>

        {result.status === 'missing' ? (
          <Card className="border-primary/15 shadow-xl">
            <InvitationTelemetry status="missing" />
            <CardHeader>
              <CardTitle as="h1" className="font-serif text-2xl">
                This invitation has expired
              </CardTitle>
              <CardDescription>
                The room may have ended, expired, or the link may be incomplete.
                Nothing was entered or shared.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              <Link
                href="/?source=dead-invite#create-table"
                className={cn(buttonVariants({ size: 'lg' }), 'w-full')}
              >
                <Plus data-icon="inline-start" />
                Create your table
              </Link>
              <Link
                href="/"
                className={cn(buttonVariants({ variant: 'outline', size: 'lg' }), 'w-full')}
              >
                <ArrowLeft data-icon="inline-start" />
                Go home
              </Link>
            </CardContent>
          </Card>
        ) : (
          <Card className="border-primary/15 shadow-xl">
            <CardHeader>
              <CardTitle as="h1" className="font-serif text-2xl">
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
                    We couldn’t confirm the invitation yet. You can still try room{' '}
                    <span className="font-mono font-semibold text-foreground">
                      {roomId}
                    </span>{' '}
                    with the password from your host.
                  </>
                )}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <JoinRoomForm
                roomId={roomId}
                previewStatus={result.status === 'available' ? 'available' : 'unavailable'}
              />
            </CardContent>
          </Card>
        )}
      </div>
    </main>
  )
}
