import { Suspense } from 'react'
import { Link2, ShieldCheck, Spade, Users } from 'lucide-react'

import { CreateRoomEntry } from '@/components/create-room-entry'
import { CreateRoomForm } from '@/components/create-room-form'
import { PlayingCard } from '@/components/playing-card'
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
    body: 'Use the dealt setup or customize the stakes, pace, and house rules.',
  },
  {
    icon: Link2,
    title: 'Share the link',
    body: 'Send friends one private invite. No account or download needed.',
  },
  {
    icon: Users,
    title: 'Deal the cards',
    body: 'Start once two players are seated. Friends can still join later.',
  },
] as const

function HowItWorks({ className = '' }: { className?: string }) {
  return (
    <ul className={`grid gap-4 sm:grid-cols-3 ${className}`}>
      {STEPS.map((step) => (
        <li key={step.title} className="flex flex-col gap-2">
          <span className="flex size-9 items-center justify-center rounded-lg bg-primary/15 text-primary">
            <step.icon className="size-4.5" aria-hidden />
          </span>
          <p className="text-sm font-semibold">{step.title}</p>
          <p className="text-sm leading-relaxed text-muted-foreground">{step.body}</p>
        </li>
      ))}
    </ul>
  )
}

export default function HomePage() {
  return (
    <main id="main-content" tabIndex={-1} className="min-h-dvh outline-none">
      <div className="compact-phone-shell mx-auto flex min-h-dvh max-w-6xl flex-col gap-4 px-5 py-5 lg:flex-row lg:items-center lg:gap-16 lg:py-16">
        <section className="flex-1">
          <div className="compact-phone-badge inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
            <ShieldCheck className="size-3.5" aria-hidden />
            Private tables, powered by pokerkit
          </div>

          <h1 className="compact-phone-title mt-4 max-w-xl text-pretty font-serif text-4xl font-extrabold leading-[1.08] sm:text-5xl lg:mt-5 lg:text-6xl">
            Your poker night starts with{' '}
            <span className="text-primary">one link.</span>
          </h1>

          <p className="compact-phone-copy mt-3 max-w-md text-pretty text-sm leading-relaxed text-muted-foreground sm:text-base lg:mt-4">
            Name the table, send one link, and deal. The usual setup is ready.
          </p>

          <div className="compact-phone-cards mt-3 flex items-center gap-2 lg:mt-6" aria-hidden>
            <PlayingCard card="Ah" size="md" className="-rotate-6" />
            <PlayingCard card="Kh" size="md" className="rotate-3" />
            <PlayingCard card="Qh" size="md" className="-rotate-2" />
            <PlayingCard card="Jh" size="md" className="rotate-6" />
            <PlayingCard card="Th" size="md" className="rotate-12" />
          </div>

          <HowItWorks className="mt-8 hidden lg:grid" />
        </section>

        <section id="create-table" className="compact-phone-create w-full scroll-mt-4 lg:max-w-md">
          <Card className="border-primary/15 shadow-xl">
            <CardHeader className="compact-phone-card-header gap-1 pb-4">
              <CardTitle className="font-serif text-2xl">
                Create a table
              </CardTitle>
              <CardDescription className="compact-phone-card-description">
                You’ll be the host. Share the invitation on the next screen.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Suspense fallback={<CreateRoomForm />}>
                <CreateRoomEntry />
              </Suspense>
            </CardContent>
          </Card>
          <SignedOutCta />
        </section>

        <HowItWorks className="pb-5 lg:hidden" />
      </div>
    </main>
  )
}
