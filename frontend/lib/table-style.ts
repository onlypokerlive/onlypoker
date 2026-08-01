// What the table is made of.
//
// Four cloths and four decks, chosen once by whoever sets the table up. Not a
// settings screen and not per-player: a poker table is a shared object, and
// half the point of a group having their own table is that it looks like
// theirs. Everybody sees the same felt for the same reason everybody sees the
// same cards.
//
// The ids are the values of the `data-baize` and `data-deck` attributes in
// globals.css, and this list is the only place they are written down. A room
// that names one nobody has heard of falls back rather than rendering a table
// with no surface at all.

export const BAIZES = [
  { id: 'emerald', label: 'Emerald', blurb: 'The green everybody pictures' },
  { id: 'claret', label: 'Claret', blurb: 'Deep red, back-room' },
  { id: 'midnight', label: 'Midnight', blurb: 'Blue, easy at 2am' },
  { id: 'slate', label: 'Slate', blurb: 'Grey, and the cards do the talking' },
] as const

export const DECKS = [
  { id: 'claret', label: 'Claret', blurb: 'The house deck' },
  { id: 'navy', label: 'Navy', blurb: 'The other house deck' },
  { id: 'forest', label: 'Forest', blurb: 'Dark green' },
  { id: 'bone', label: 'Bone', blurb: 'Pale, ink lattice' },
] as const

export type BaizeId = (typeof BAIZES)[number]['id']
export type DeckId = (typeof DECKS)[number]['id']

export const DEFAULT_BAIZE: BaizeId = 'emerald'
export const DEFAULT_DECK: DeckId = 'claret'

/**
 * The cloth this room asked for, or the default.
 *
 * Rooms created before there was a choice have no answer, and a room saved by
 * a newer client than this one might name a cloth this bundle has never heard
 * of. Both come out as a table that looks like a table.
 */
export function baizeOf(id: string | null | undefined): BaizeId {
  return BAIZES.some((b) => b.id === id) ? (id as BaizeId) : DEFAULT_BAIZE
}

export function deckOf(id: string | null | undefined): DeckId {
  return DECKS.some((d) => d.id === id) ? (id as DeckId) : DEFAULT_DECK
}
