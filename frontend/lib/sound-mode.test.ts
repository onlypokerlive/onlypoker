import { describe, expect, it } from 'vitest'

import { audible } from '@/lib/use-table-events'
import type { TableEvent } from '@/lib/table-events'

const EVERYTHING: TableEvent[] = [
  'deal',
  'street',
  'yourTurn',
  'chips',
  'potWon',
  'levelUp',
  'elimination',
  'tournamentEnd',
  'check',
  'fold',
  'raise',
  'allIn',
  'potCollect',
]

describe('the three-state switch', () => {
  it('says everything on "all"', () => {
    expect(EVERYTHING.filter((e) => audible('all', e))).toEqual(EVERYTHING)
  })

  it('says nothing on "off"', () => {
    expect(EVERYTHING.filter((e) => audible('off', e))).toEqual([])
  })

  it('says only your turn on "turn"', () => {
    // The middle setting is the whole reason there are three: somebody on the
    // sofa with people in the room, who wants to know when it is on them and
    // nothing else. Anything about another player leaking through here makes
    // it the same as "all" with extra steps.
    expect(EVERYTHING.filter((e) => audible('turn', e))).toEqual(['yourTurn'])
  })
})
