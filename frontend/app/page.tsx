import { Spade, Users, Link2, ShieldCheck } from 'lucide-react'

import { CreateRoomForm } from '@/components/create-room-form'
import { PlayingCard } from '@/components/playing-card'
import { SiteHeader } from '@/components/site-header'
import { SignedOutCta } from '@/components/signed-out-cta'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'

const STEPS = [
  {
    icon: Spade,
    title: 'Configure the table',
    body: 'Set the starting stack, the small and big blinds, and a password.',
  },
  {
    icon: Link2,
    title: 'Share the link',
    body: 'Send friends the invite link. They enter their name and the password.',
  },
  {
    icon: Users,
    title: 'Deal the cards',
    body: 'Once everyone is seated, start the hand and play No-Limit Hold’em.',
  },
]

export default function HomePage() {
  return (
    <main className="min-h-dvh">
      <SiteHeader />
      <div className="mx-auto flex max-w-6xl flex-col gap-10 px-5 py-10 lg:flex-row lg:items-center lg:gap-16 lg:py-16">
        {/* Hero / pitch */}
        <section className="flex-1">
          <div className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
            <ShieldCheck className="size-3.5" />
            Private tables, powered by pokerkit
          </div>

          <h1 className="mt-5 text-pretty font-serif text-4xl font-extrabold leading-tight sm:text-5xl lg:text-6xl">
            Deal your friends into a private{' '}
            <span className="text-primary">Texas Hold’em</span> table.
          </h1>

          <p className="mt-4 max-w-md text-pretty leading-relaxed text-muted-foreground">
            Spin up a room in seconds, choose the stakes, and invite everyone
            with a single link. No downloads, no accounts — just cards.
          </p>

          <div className="mt-6 flex items-center gap-2" aria-hidden>
            <PlayingCard card="Ah" size="md" className="-rotate-6" />
            <PlayingCard card="Kh" size="md" className="rotate-3" />
            <PlayingCard card="Qh" size="md" className="-rotate-2" />
            <PlayingCard card="Jh" size="md" className="rotate-6" />
            <PlayingCard card="Th" size="md" className="rotate-12" />
          </div>

          <ul className="mt-8 grid gap-4 sm:grid-cols-3">
            {STEPS.map((step) => (
              <li key={step.title} className="flex flex-col gap-2">
                <span className="flex size-9 items-center justify-center rounded-lg bg-primary/15 text-primary">
                  <step.icon className="size-4.5" />
                </span>
                <p className="text-sm font-semibold">{step.title}</p>
                <p className="text-sm leading-relaxed text-muted-foreground">
                  {step.body}
                </p>
              </li>
            ))}
          </ul>
        </section>

        {/* Create form */}
        <section className="w-full lg:max-w-md">
          <Card className="border-primary/15 shadow-xl">
            <CardHeader>
              <CardTitle className="font-serif text-2xl">
                Create a table
              </CardTitle>
              <CardDescription>
                You’ll be the host. You can share the invite link on the next
                screen.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <CreateRoomForm />
            </CardContent>
          </Card>
          <SignedOutCta />
        </section>
      </div>
    </main>
  )
}
