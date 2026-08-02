export type HandoverState =
  | { kind: 'finishing'; label: 'Finishing the night…' }
  | { kind: 'host'; label: string }
  | { kind: 'guest'; label: string }

/** The single truthful primary state between hands, with final-hand priority. */
export function handoverState({
  lastHand,
  isHost,
  paused,
  autoDealIn,
}: {
  lastHand: boolean
  isHost: boolean
  paused: boolean
  autoDealIn: number | null
}): HandoverState {
  if (lastHand) return { kind: 'finishing', label: 'Finishing the night…' }
  if (isHost) {
    return {
      kind: 'host',
      label:
        autoDealIn != null && !paused
          ? `Deal now · ${Math.ceil(autoDealIn)}s`
          : 'Deal next hand',
    }
  }
  return {
    kind: 'guest',
    label: paused
      ? 'The host stopped the table…'
      : autoDealIn != null
        ? `Next hand in ${Math.ceil(autoDealIn)}s`
        : 'Dealing the next hand…',
  }
}
