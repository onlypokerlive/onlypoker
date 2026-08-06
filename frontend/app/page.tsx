import { Suspense } from 'react'

import { CreateRoomEntry } from '@/components/create-room-entry'
import { CreateRoomForm } from '@/components/create-room-form'
import { HomeHand } from '@/components/home-hand'
import { SiteHeader } from '@/components/site-header'

/**
 * The first screen: a headline, a hand being played, and four fields.
 *
 * It used to be a marketing page — a badge saying which library deals the
 * cards, a fan of five hearts that never moved, and three paragraphs headed
 * "How it works" explaining a thing that takes eleven seconds to simply show.
 * All three were answers to "what is this" written for somebody reading, and
 * nobody reads a poker app; they look at it and decide whether it looks like a
 * table.
 *
 * So the middle of the screen is a table, with a hand being played on it, and
 * the words are down to two lines. What is left is the shortest possible
 * distance between arriving and having a link to send.
 *
 * One column at every width. This is a phone product held upright — that is
 * the first line of the README — and a desktop layout that spreads the same
 * four fields across a hero and a sidebar is a second screen to keep in step
 * with the one people actually use.
 */
export default function HomePage() {
  return (
    <main
      id="main-content"
      tabIndex={-1}
      className="home-screen mx-auto flex h-dvh max-w-md flex-col overflow-hidden outline-none"
    >
      <div className="shrink-0">
        <SiteHeader />
      </div>

      <div className="home-body">
        <h1 className="home-title text-pretty font-serif font-extrabold">
          Your game starts with <span className="text-primary">a link.</span>
        </h1>
        <p className="home-sub text-pretty leading-snug text-muted-foreground">
          Poker with friends, in seconds, from anywhere.
        </p>

        <div className="home-stage">
          <HomeHand />
        </div>

        <section id="create-table" className="home-form">
          <Suspense fallback={<CreateRoomForm />}>
            <CreateRoomEntry />
          </Suspense>
        </section>
      </div>
    </main>
  )
}
