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

export default async function JoinPage({
  params,
}: {
  params: Promise<{ roomId: string }>
}) {
  const { roomId } = await params

  return (
    <main className="flex min-h-dvh items-center justify-center px-5 py-10">
      <div className="w-full max-w-md">
        <Link
          href="/"
          className="mb-6 inline-flex items-center gap-2 text-sm text-muted-foreground transition-colors hover:text-foreground"
        >
          <Spade className="size-4 text-primary" />
          Felt &amp; Gold
        </Link>

        <Card className="border-primary/15 shadow-xl">
          <CardHeader>
            <CardTitle className="font-serif text-2xl">
              Join the table
            </CardTitle>
            <CardDescription>
              You’ve been invited to room{' '}
              <span className="font-mono font-semibold text-foreground">
                {roomId}
              </span>
              . Enter your name and the room password.
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
