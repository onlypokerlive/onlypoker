import type { CreateRoomInput, GameView } from '@/lib/poker-api'
import { DEFAULT_BAIZE, DEFAULT_DECK } from '@/lib/table-style'

/**
 * What kind of night this is, in one place.
 *
 * The host used to answer twenty questions before the table existed, on the
 * screen where they had not yet decided whether they were even doing this. Now
 * they answer two — what it is called and what the password is — and the night
 * itself is agreed in the lobby, with the people who turned up, off four
 * formats and a sheet that opens if they want to argue with one.
 *
 * Everything here is data and pure functions. The four formats, the defaults
 * and the summary the lobby reads back are all derived from this module, so a
 * rule that changes changes once.
 */

/** The stack, said the way people actually say it. */
export const STARTING_BLIND_CHOICES = [50, 100, 200] as const
export const LEVEL_MINUTE_CHOICES = [5, 10, 20] as const
export const REBUY_COUNT_CHOICES = [1, 2, 0] as const
export const WINDOW_CHOICES = [2, 4, 99] as const

export type BlindLadder = 'gentle' | 'standard' | 'beast'

export const BLIND_LADDER_CHOICES: {
  id: BlindLadder
  label: string
  blurb: string
}[] = [
  { id: 'gentle', label: 'Gentle', blurb: 'Doubles every four levels' },
  { id: 'standard', label: 'Standard', blurb: 'Doubles every two' },
  { id: 'beast', label: 'Beast', blurb: 'Doubles every level' },
]

/**
 * The night, before it is chips.
 *
 * The stack is held in big blinds and not in chips, because "1000" is a number
 * that means nothing without the blinds next to it — 1000 at 5/10 is a hundred
 * blinds and a tournament, and 1000 at 100/200 is five and a coin flip. It is
 * translated on the way out, in `toCreateInput`.
 */
export interface TableRules {
  startingBlinds: number
  smallBlind: number
  bigBlind: number
  levelMinutes: number
  blindLadder: BlindLadder
  actionSeconds: number
  timeBankSeconds: number
  anteMode: 'off' | 'bb' | 'all'
  straddle: boolean
  bombPotEvery: number
  sevenDeuce: number
  runItTwice: boolean
  breakEveryLevels: number
  breakMinutes: number
  lateEntryLevels: number
  lateEntryChips: 'start' | 'average'
  allowLeaving: boolean
  rebuyLevels: number
  /** 0 means as many as you like, which the server spells as 10. */
  rebuysPerPlayer: number
  rebuyChips: 'start' | 'average' | 'fixed'
  rebuyChipsFixed: number
  addOn: boolean
  baize: CreateRoomInput['baize']
  deck: CreateRoomInput['deck']
}

/** The table you get for saying nothing: Classic. */
export const DEFAULT_RULES: TableRules = {
  startingBlinds: 100,
  smallBlind: 5,
  bigBlind: 10,
  levelMinutes: 10,
  blindLadder: 'standard',
  actionSeconds: 20,
  timeBankSeconds: 60,
  anteMode: 'off',
  straddle: false,
  bombPotEvery: 0,
  sevenDeuce: 0,
  runItTwice: false,
  breakEveryLevels: 0,
  breakMinutes: 5,
  lateEntryLevels: 4,
  lateEntryChips: 'start',
  allowLeaving: true,
  rebuyLevels: 4,
  rebuysPerPlayer: 2,
  rebuyChips: 'start',
  rebuyChipsFixed: 0,
  addOn: false,
  baize: DEFAULT_BAIZE,
  deck: DEFAULT_DECK,
}

export interface TableFormat {
  id: string
  label: string
  duration: string
  blurb: string
  rules: TableRules
}

/**
 * Four nights, and the fourth is the 7-2 on its own.
 *
 * Chaos carries everything, and everything includes the 7-2 — it is the format
 * that does not choose, so an extra that exists is an extra that is on. "The
 * 7-2" is the same prize with the standard structure underneath it, which is
 * what makes it the thing that happens rather than one of six things.
 *
 * Five big blinds and not two, because at two almost nobody goes for it, and
 * the whole rule exists so that somebody tries.
 */
export const FORMATS: TableFormat[] = [
  {
    id: 'fast',
    label: 'Fast',
    duration: '~1 h',
    blurb: 'Short stacks and blinds that bite',
    rules: {
      ...DEFAULT_RULES,
      startingBlinds: 50,
      levelMinutes: 5,
      blindLadder: 'beast',
    },
  },
  {
    id: 'classic',
    label: 'Classic',
    duration: '~2-3 h',
    blurb: 'The usual',
    rules: { ...DEFAULT_RULES },
  },
  {
    id: 'chaos',
    label: 'Chaos',
    duration: '~2 h',
    blurb: 'Everything at once: bombs, straddle, ante and 7-2',
    rules: {
      ...DEFAULT_RULES,
      sevenDeuce: 5,
      bombPotEvery: 8,
      straddle: true,
      anteMode: 'bb',
      runItTwice: true,
    },
  },
  {
    id: 'seven-deuce',
    label: 'The 7-2',
    duration: '~2-3 h',
    blurb: 'Win with seven-deuce and everybody pays',
    rules: { ...DEFAULT_RULES, sevenDeuce: 5, runItTwice: true },
  },
]

/** Which format these rules are, or null once the host has edited one. */
export function matchFormat(rules: TableRules): string | null {
  return FORMATS.find((f) => sameRules(f.rules, rules))?.id ?? null
}

function sameRules(a: TableRules, b: TableRules): boolean {
  return (Object.keys(a) as (keyof TableRules)[]).every((key) => a[key] === b[key])
}

/** Chips, from the stack the host actually chose. */
export function startingChips(rules: TableRules): number {
  return Math.max(rules.bigBlind * 2, rules.startingBlinds * rules.bigBlind)
}

/**
 * The first few levels of a ladder at these stakes.
 *
 * The multipliers come from the server rather than from a constant here: they
 * are the engine's, and a second copy of them in the frontend is a copy that
 * quietly stops matching the one that decides what you actually pay.
 */
export function blindPreview(
  ladders: Record<string, number[]> | undefined,
  ladder: BlindLadder,
  rules: TableRules,
  levels = 5,
): string {
  const rungs = ladders?.[ladder]
  if (!rungs?.length) return ''
  return rungs
    .slice(0, levels)
    .map((m) => `${rules.smallBlind * m}/${rules.bigBlind * m}`)
    .join(' → ')
}

export interface SummaryLine {
  label: string
  value: string
}

/**
 * The night read back in six lines.
 *
 * Every line always says something, including "no ante" and "no extras". A row
 * that disappears when it is off reads as a row that failed to load, and the
 * host is scanning this to check they got what they meant.
 */
export function houseSummary(rules: TableRules): SummaryLine[] {
  return [
    {
      label: 'Chips',
      value: `${startingChips(rules).toLocaleString()} · ${rules.startingBlinds} blinds`,
    },
    {
      label: 'Blinds',
      value:
        `${rules.smallBlind}/${rules.bigBlind} · ` +
        (rules.levelMinutes > 0 ? `up every ${rules.levelMinutes} min` : 'fixed'),
    },
    {
      label: 'Clock',
      value:
        rules.actionSeconds > 0
          ? `${rules.actionSeconds}s` +
            (rules.timeBankSeconds > 0 ? ` + ${rules.timeBankSeconds}s bank` : ' · no bank')
          : 'No clock',
    },
    { label: 'Antes', value: anteLabel(rules) },
    { label: 'Rules', value: houseRulesLabel(rules) },
    { label: 'Doors', value: doorsLabel(rules) },
  ]
}

export function anteLabel(rules: TableRules): string {
  const ante =
    rules.anteMode === 'bb'
      ? 'Big blind ante'
      : rules.anteMode === 'all'
        ? 'Everybody antes'
        : 'No ante'
  if (!rules.breakEveryLevels) return ante
  return `${ante} · ${rules.breakMinutes} min break every ${rules.breakEveryLevels}`
}

export function houseRulesLabel(rules: TableRules): string {
  const on = [
    rules.sevenDeuce > 0 ? `7-2 pays ${rules.sevenDeuce}` : null,
    rules.straddle ? 'straddle' : null,
    rules.bombPotEvery > 0 ? `bomb every ${rules.bombPotEvery}` : null,
    rules.runItTwice ? 'two boards' : null,
  ].filter(Boolean)
  return on.length ? on.join(' · ') : 'No extras'
}

export function doorsLabel(rules: TableRules): string {
  if (!rules.rebuyLevels && !rules.lateEntryLevels) return 'Closed once it starts'
  const rebuys =
    rules.rebuysPerPlayer === 0
      ? 'unlimited rebuys'
      : `×${rules.rebuysPerPlayer} rebuy${rules.rebuysPerPlayer === 1 ? '' : 's'}`
  const window = rules.rebuyLevels >= 99 ? 'any time' : `${rules.rebuyLevels} levels`
  if (!rules.rebuyLevels) return `Late entry: ${lateWindow(rules)}`
  return `${rebuys}, ${window}`
}

function lateWindow(rules: TableRules): string {
  if (!rules.lateEntryLevels) return 'closed'
  return rules.lateEntryLevels >= 99 ? 'any time' : `${rules.lateEntryLevels} levels`
}

/**
 * What the server is told.
 *
 * The two translations happen here and nowhere else: the stack from blinds to
 * chips, and "unlimited" from 0 to the 10 the server's range tops out at. Both
 * are the kind of conversion that gets done twice, differently, by two call
 * sites that each think they own it.
 */
export function toRulesPayload(rules: TableRules, name: string) {
  return {
    name,
    startingChips: startingChips(rules),
    smallBlind: rules.smallBlind,
    bigBlind: rules.bigBlind,
    levelMinutes: rules.levelMinutes,
    blindLadder: rules.blindLadder,
    actionSeconds: rules.actionSeconds,
    timeBankSeconds: rules.actionSeconds > 0 ? rules.timeBankSeconds : 0,
    anteMode: rules.anteMode,
    straddle: rules.straddle,
    bombPotEvery: rules.bombPotEvery,
    sevenDeuce: rules.sevenDeuce,
    runItTwice: rules.runItTwice,
    breakEveryLevels: rules.breakEveryLevels,
    breakMinutes: rules.breakMinutes,
    lateEntryLevels: rules.lateEntryLevels,
    lateEntryChips: rules.lateEntryChips,
    allowLeaving: rules.allowLeaving,
    rebuyLevels: rules.rebuyLevels,
    rebuysPerPlayer: rules.rebuysPerPlayer === 0 ? 10 : rules.rebuysPerPlayer,
    rebuyChips: rules.rebuyChips,
    rebuyChipsFixed: rules.rebuyChips === 'fixed' ? rules.rebuyChipsFixed : 0,
    addOn: rules.addOn,
    baize: rules.baize,
    deck: rules.deck,
  }
}

/**
 * The rules back out of a table that already exists.
 *
 * The stack comes back as chips and has to be divided into blinds again. The
 * division is exact for anything the sheet can produce; anything else is a
 * table made before this screen existed, and rounding it is better than
 * showing the host a number their own table does not have.
 */
export function rulesFromView(view: GameView): TableRules {
  const room = view.room
  return {
    startingBlinds: Math.max(1, Math.round(room.startingChips / room.bigBlind)),
    smallBlind: room.smallBlind,
    bigBlind: room.bigBlind,
    levelMinutes: room.levelMinutes,
    blindLadder: (room.blindLadder ?? 'standard') as BlindLadder,
    actionSeconds: room.actionSeconds,
    timeBankSeconds: room.timeBankSeconds,
    anteMode: room.anteMode,
    straddle: room.straddle,
    bombPotEvery: room.bombPotEvery,
    sevenDeuce: room.sevenDeuce,
    runItTwice: room.runItTwice ?? false,
    breakEveryLevels: room.breakEveryLevels,
    breakMinutes: room.breakMinutes,
    lateEntryLevels: room.lateEntryLevels ?? 0,
    lateEntryChips: room.lateEntryChips ?? 'start',
    allowLeaving: room.allowLeaving,
    rebuyLevels: room.rebuyLevels ?? 0,
    rebuysPerPlayer: room.rebuysPerPlayer ?? 0,
    rebuyChips: room.rebuyChips ?? 'start',
    rebuyChipsFixed: room.rebuyChipsFixed ?? 0,
    addOn: room.addOn,
    baize: room.baize as TableRules['baize'],
    deck: room.deck as TableRules['deck'],
  }
}
