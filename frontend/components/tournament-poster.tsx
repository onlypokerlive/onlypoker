import { Award, Crown } from 'lucide-react'

import { cn } from '@/lib/utils'
import { buildTournamentPosterModel } from '@/lib/tournament-poster'
import type { GameView } from '@/lib/poker-api'
import type { Standing } from '@/lib/poker-api'

const PLACE_TONE = [
  'border-primary/60 bg-primary text-primary-foreground',
  'border-zinc-300/30 bg-zinc-200/10 text-zinc-100',
  'border-amber-700/40 bg-amber-900/20 text-amber-100',
]

function isStanding(standing: Standing | undefined): standing is Standing {
  return standing !== undefined
}

export function TournamentPoster({ view }: { view: GameView }) {
  const model = buildTournamentPosterModel(view)
  const podium = [model.podium[1], model.podium[0], model.podium[2]].filter(isStanding)

  return (
    <article className="relative isolate mx-auto flex aspect-[4/5] w-full max-w-md flex-col overflow-hidden rounded-[1.75rem] border border-primary/30 bg-[#09110e] p-5 shadow-2xl shadow-black/30">
      <div
        className="pointer-events-none absolute inset-0 -z-10 opacity-35"
        style={{
          backgroundImage:
            'repeating-linear-gradient(0deg, transparent 0, transparent 17px, rgba(215,182,94,.07) 18px)',
        }}
        aria-hidden
      />

      <header className="text-center">
        <p className="font-mono text-[9px] font-bold uppercase tracking-[0.22em] text-primary">
          Felt & Gold · Final table
        </p>
        <h2 className="mt-2 truncate font-serif text-2xl font-bold text-[#f4efe3]">
          {model.roomName}
        </h2>
        <p className="mt-1 font-mono text-[10px] text-[#92a198]">
          {model.playerCount} players · {model.handCount} hands
        </p>
      </header>

      <div className="relative mx-auto mt-4 flex h-[38%] w-[76%] flex-col items-center justify-center rounded-[50%] border-[7px] border-[#8e6533] bg-[#18533b] px-4 text-center shadow-[inset_0_0_45px_rgba(0,0,0,.35),0_18px_35px_rgba(0,0,0,.3)]">
        <Crown className="size-5 text-[#d7b65e]" aria-hidden />
        <p className="mt-1 font-mono text-[9px] font-bold uppercase tracking-[0.2em] text-[#d7b65e]">
          Champion
        </p>
        <p className="mt-1 max-w-full truncate font-serif text-xl font-bold text-[#f4efe3]">
          {model.champion.name}
        </p>
        <p className="mt-1 font-mono text-[10px] font-semibold text-[#d8e0d9]">
          {model.champion.chips.toLocaleString()} chips
        </p>
      </div>

      <ol className="mt-4 grid grid-cols-3 items-end gap-2">
        {podium.map((standing) => (
          <li
            key={standing.playerId}
            className={cn(
              'min-w-0 rounded-xl border px-2 py-2 text-center',
              PLACE_TONE[standing.place - 1],
              standing.place === 1 && 'py-3',
            )}
          >
            <span className="block font-mono text-[9px] font-black">#{standing.place}</span>
            <span className="mt-0.5 block truncate text-xs font-semibold">{standing.name}</span>
          </li>
        ))}
      </ol>

      <div className="mt-auto grid grid-cols-2 gap-2 border-t border-primary/15 pt-3">
        {model.awards.slice(0, 2).map((award) => (
          <div key={award.label} className="min-w-0">
            <p className="flex items-center gap-1 font-mono text-[8px] font-bold uppercase tracking-wider text-primary">
              <Award className="size-3" aria-hidden />
              {award.label}
            </p>
            <p className="mt-0.5 truncate text-[11px] font-semibold text-[#f4efe3]">{award.name}</p>
            <p className="truncate text-[9px] text-[#92a198]">{award.detail}</p>
          </div>
        ))}
      </div>
    </article>
  )
}
