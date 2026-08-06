import { describe, expect, it } from 'vitest'

import {
  DEFAULT_RULES,
  FORMATS,
  blindPreview,
  doorsLabel,
  houseRulesLabel,
  houseSummary,
  formatBlinds,
  isBlindCount,
  matchFormat,
  startingBlinds,
  startingChips,
  withBlindCount,
  toRulesPayload,
  type TableRules,
} from '@/lib/table-rules'

const rules = (over: Partial<TableRules> = {}): TableRules => ({
  ...DEFAULT_RULES,
  ...over,
})

describe('the four formats', () => {
  it('names four nights, and one of them is the usual one', () => {
    expect(FORMATS.map((f) => f.id)).toEqual([
      'fast',
      'classic',
      'chaos',
      'seven-deuce',
    ])
    expect(FORMATS.find((f) => f.id === 'classic')!.rules).toEqual(DEFAULT_RULES)
  })

  it('gives Chaos every extra there is, because that is what Chaos means', () => {
    // The one that does not choose. An extra that exists is an extra that is
    // on — including the 7-2, which has its own format and belongs in both.
    const chaos = FORMATS.find((f) => f.id === 'chaos')!.rules
    expect(chaos.sevenDeuce).toBeGreaterThan(0)
    expect(chaos.bombPotEvery).toBeGreaterThan(0)
    expect(chaos.straddle).toBe(true)
    expect(chaos.anteMode).not.toBe('off')
    expect(chaos.runItTwice).toBe(true)
  })

  it('pays the 7-2 enough that somebody actually goes for it', () => {
    // At two big blinds almost nobody chases it, and the entire rule exists so
    // that somebody tries.
    for (const id of ['chaos', 'seven-deuce']) {
      expect(FORMATS.find((f) => f.id === id)!.rules.sevenDeuce).toBeGreaterThanOrEqual(5)
    }
  })

  it('recognises a format until the host edits it', () => {
    expect(matchFormat(FORMATS[2].rules)).toBe('chaos')
    expect(matchFormat({ ...FORMATS[2].rules, straddle: false })).toBeNull()
  })
})

describe('the stack', () => {
  it('turns a chosen blind count into chips at the stakes actually chosen', () => {
    expect(startingChips(withBlindCount(rules({ bigBlind: 10 }), 100))).toBe(1000)
    expect(startingChips(withBlindCount(rules({ bigBlind: 200 }), 100))).toBe(20_000)
  })

  it('survives a round trip that nobody asked to change the stack in', () => {
    // 1000 chips at 150/300 is 3.33 blinds. Held as a blind count it comes
    // back as 3 — and 900 chips — so a host who opened the sheet to move the
    // clock would have silently changed the buy-in of their own table.
    const legacy = rules({ startingChips: 1000, smallBlind: 150, bigBlind: 300 })
    expect(startingChips(legacy)).toBe(1000)
    expect(startingBlinds(legacy)).toBeCloseTo(3.33, 2)
    expect(formatBlinds(startingBlinds(legacy))).toBe('3.3')
    expect(startingChips({ ...legacy, levelMinutes: 20 })).toBe(1000)
  })

  it('only calls a count exact when it is exact', () => {
    const legacy = rules({ startingChips: 1000, bigBlind: 300 })
    expect(isBlindCount(legacy, 3)).toBe(false)
    expect(isBlindCount(rules({ startingChips: 900, bigBlind: 300 }), 3)).toBe(true)
  })

  it('never opens a table with less than two big blinds in front of anybody', () => {
    // Which is the one thing the server refuses outright, so the sheet cannot
    // build a table it will then be told it cannot have.
    expect(startingChips(rules({ startingChips: 100, bigBlind: 100 }))).toBe(200)
  })
})

describe('what the server is told', () => {
  it('spells "as many rebuys as you like" the way the server counts it', () => {
    expect(toRulesPayload(rules({ rebuysPerPlayer: 0 }), 'x').rebuysPerPlayer).toBe(10)
    expect(toRulesPayload(rules({ rebuysPerPlayer: 2 }), 'x').rebuysPerPlayer).toBe(2)
  })

  it('drops the time bank with the clock it belongs to', () => {
    // A bank of extra seconds on a table with no shot clock is sixty seconds
    // added to a countdown that does not exist.
    const payload = toRulesPayload(rules({ actionSeconds: 0, timeBankSeconds: 60 }), 'x')
    expect(payload.timeBankSeconds).toBe(0)
  })

  it('only sends a fixed rebuy amount when the rebuy is fixed', () => {
    expect(
      toRulesPayload(rules({ rebuyChips: 'average', rebuyChipsFixed: 2500 }), 'x')
        .rebuyChipsFixed,
    ).toBe(0)
    expect(
      toRulesPayload(rules({ rebuyChips: 'fixed', rebuyChipsFixed: 2500 }), 'x')
        .rebuyChipsFixed,
    ).toBe(2500)
  })
})

describe('the night read back', () => {
  it('always says something on every line, including when a rule is off', () => {
    // A row that disappears when it is off reads as a row that failed to load,
    // and the host is scanning this to check they got what they meant.
    const lines = houseSummary(rules())
    expect(lines).toHaveLength(6)
    expect(lines.every((l) => l.value.trim().length > 0)).toBe(true)
    expect(houseRulesLabel(rules())).toBe('No extras')
  })

  it('lists the extras that are on, and only those', () => {
    expect(houseRulesLabel(rules({ sevenDeuce: 5, straddle: true }))).toBe(
      '7-2 pays 5 · straddle',
    )
  })

  it('says the blinds are fixed rather than showing an empty level', () => {
    const blinds = houseSummary(rules({ levelMinutes: 0 }))[1].value
    expect(blinds).toContain('fixed')
  })

  it('counts rebuys the way the host set them, unlimited included', () => {
    expect(doorsLabel(rules({ rebuyLevels: 4, rebuysPerPlayer: 2 }))).toBe(
      '×2 rebuys, 4 levels',
    )
    expect(doorsLabel(rules({ rebuyLevels: 99, rebuysPerPlayer: 0 }))).toBe(
      'unlimited rebuys, any time',
    )
    expect(doorsLabel(rules({ rebuyLevels: 0, lateEntryLevels: 0 }))).toBe(
      'Closed once it starts',
    )
  })
})

describe('the ladder preview', () => {
  const ladders = { standard: [1, 2, 3, 4, 6, 8], beast: [1, 2, 4, 8, 16] }

  it('shows the host their own stakes climbing, not an example', () => {
    expect(blindPreview(ladders, 'standard', rules({ smallBlind: 25, bigBlind: 50 }), 3)).toBe(
      '25/50 → 50/100 → 75/150',
    )
  })

  it('says nothing at all rather than inventing a ladder it was not sent', () => {
    // The multipliers are the engine's. A fallback here would be a second copy
    // of them, and a second copy is the one that quietly stops matching.
    expect(blindPreview(undefined, 'standard', rules())).toBe('')
    expect(blindPreview(ladders, 'gentle', rules())).toBe('')
  })
})
