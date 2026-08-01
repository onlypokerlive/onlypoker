import { describe, expect, it } from 'vitest'

import { audible, tableIsAudible } from '@/lib/use-table-events'
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

  it('keeps the table quiet on anything but "all"', () => {
    // The table says the moments it is the only one that can time — a hand
    // turning over, the pot going out — and every one of them is about
    // somebody else. It was handed `mode !== 'off'`, so the middle setting
    // silenced the hook and left the table talking.
    expect(tableIsAudible('all')).toBe(true)
    expect(tableIsAudible('turn')).toBe(false)
    expect(tableIsAudible('off')).toBe(false)
    // Which is the same answer `audible` gives for the events it says.
    expect(tableIsAudible('turn')).toBe(audible('turn', 'potWon'))
  })
})
