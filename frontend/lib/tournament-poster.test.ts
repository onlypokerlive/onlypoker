import { describe, expect, it } from 'vitest'

import { buildTournamentPosterModel } from './tournament-poster'
import { gameView, player } from './test-fixtures'

describe('tournament poster model', () => {
  it('builds the podium and honest awards from final table data', () => {
    const model = buildTournamentPosterModel(
      gameView({
        phase: 'finished',
        roomName: 'Thursday Night',
        handNumber: 42,
        players: [
          player({ id: 'host', name: 'Mara', isHost: true }),
          player({ id: 'comeback', name: 'Sol', rebuys: 2 }),
          player({ id: 'winner', name: 'Nico' }),
        ],
        standings: [
          { place: 1, playerId: 'winner', name: 'Nico', chips: 3000 },
          { place: 2, playerId: 'comeback', name: 'Sol', chips: 0 },
          { place: 3, playerId: 'host', name: 'Mara', chips: 0 },
        ],
      }),
    )

    expect(model.champion.name).toBe('Nico')
    expect(model.podium.map((standing) => standing.name)).toEqual(['Nico', 'Sol', 'Mara'])
    expect(model.awards).toEqual([
      { label: 'Table captain', name: 'Mara', detail: 'Brought the night together' },
      { label: 'Second wind', name: 'Sol', detail: '2 rebuys' },
      { label: 'Final challenger', name: 'Sol', detail: 'Made it to heads-up' },
    ])
    expect(model.handCount).toBe(42)
  })

  it('refuses to make a final poster before standings exist', () => {
    expect(() => buildTournamentPosterModel(gameView())).toThrow(/no final standings/i)
  })
})
