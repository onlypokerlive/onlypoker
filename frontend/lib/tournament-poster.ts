import type { GameView, Standing } from '@/lib/poker-api'

export interface PosterAward {
  label: string
  name: string
  detail: string
}

export interface TournamentPosterModel {
  roomName: string
  champion: Standing
  podium: Standing[]
  playerCount: number
  handCount: number
  awards: PosterAward[]
}

export function buildTournamentPosterModel(view: GameView): TournamentPosterModel {
  const podium = [...view.standings].sort((a, b) => a.place - b.place).slice(0, 3)
  const champion = podium[0]
  if (!champion) throw new Error('The tournament has no final standings.')

  const awards: PosterAward[] = []
  const host = view.players.find((player) => player.isHost)
  if (host) {
    awards.push({ label: 'Table captain', name: host.name, detail: 'Brought the night together' })
  }

  const comeback = view.players.reduce<(typeof view.players)[number] | null>(
    (best, player) => (!best || player.rebuys > best.rebuys ? player : best),
    null,
  )
  if (comeback && comeback.rebuys > 0) {
    awards.push({
      label: 'Second wind',
      name: comeback.name,
      detail: `${comeback.rebuys} ${comeback.rebuys === 1 ? 'rebuy' : 'rebuys'}`,
    })
  }

  const runnerUp = podium.find((standing) => standing.place === 2)
  if (runnerUp) {
    awards.push({ label: 'Final challenger', name: runnerUp.name, detail: 'Made it to heads-up' })
  }

  return {
    roomName: view.roomName,
    champion,
    podium,
    playerCount: view.standings.length || view.players.length,
    handCount: view.handNumber,
    awards: awards.slice(0, 3),
  }
}

function roundedRect(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  context.beginPath()
  context.roundRect(x, y, width, height, radius)
}

function fittedText(
  context: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  startSize: number,
  weight: number,
  family: string,
  y: number,
) {
  let size = startSize
  do {
    context.font = `${weight} ${size}px ${family}`
    size -= 2
  } while (size > 28 && context.measureText(text).width > maxWidth)
  context.fillText(text, 540, y, maxWidth)
}

function isStanding(standing: Standing | undefined): standing is Standing {
  return standing !== undefined
}

export async function renderTournamentPoster(view: GameView): Promise<Blob> {
  const model = buildTournamentPosterModel(view)
  await document.fonts?.ready

  const canvas = document.createElement('canvas')
  canvas.width = 1080
  canvas.height = 1350
  const context = canvas.getContext('2d')
  if (!context) throw new Error('This browser cannot draw the tournament poster.')

  context.fillStyle = '#09110e'
  context.fillRect(0, 0, canvas.width, canvas.height)

  // Quiet ruled texture: enough physicality to feel printed without fighting
  // the names and scores that make this artifact belong to one real night.
  context.strokeStyle = 'rgba(215,182,94,0.055)'
  context.lineWidth = 1
  for (let y = 26; y < canvas.height; y += 26) {
    context.beginPath()
    context.moveTo(0, y)
    context.lineTo(canvas.width, y)
    context.stroke()
  }

  context.textAlign = 'center'
  context.fillStyle = '#d7b65e'
  context.font = '600 24px ui-monospace, monospace'
  context.fillText('FELT & GOLD  ·  FINAL TABLE', 540, 92)

  context.fillStyle = '#f4efe3'
  fittedText(context, model.roomName, 900, 78, 700, 'Georgia, serif', 242)

  context.fillStyle = '#92a198'
  context.font = '500 23px ui-sans-serif, sans-serif'
  context.fillText(`${model.playerCount} players  ·  ${model.handCount} hands`, 540, 300)

  // The night-ticket seal: a felt oval, brass rail, and the champion stamped
  // through its centre. The same motif appears in the on-screen/OG artwork.
  context.save()
  context.shadowColor = 'rgba(0,0,0,.45)'
  context.shadowBlur = 36
  context.fillStyle = '#18533b'
  context.strokeStyle = '#8e6533'
  context.lineWidth = 18
  context.beginPath()
  context.ellipse(540, 610, 370, 250, 0, 0, Math.PI * 2)
  context.fill()
  context.stroke()
  context.restore()

  context.fillStyle = '#d7b65e'
  context.font = '700 21px ui-monospace, monospace'
  context.fillText('CHAMPION', 540, 505)
  context.fillStyle = '#f4efe3'
  fittedText(context, model.champion.name, 610, 70, 700, 'Georgia, serif', 620)
  context.fillStyle = '#d8e0d9'
  context.font = '600 28px ui-monospace, monospace'
  context.fillText(`${model.champion.chips.toLocaleString()} CHIPS`, 540, 710)

  const podiumY = 900
  const podium = [model.podium[1], model.podium[0], model.podium[2]].filter(isStanding)
  const podiumX = podium.length === 3 ? [270, 540, 810] : podium.length === 2 ? [375, 705] : [540]
  podium.forEach((standing, index) => {
    const x = podiumX[index]
    roundedRect(context, x - 115, podiumY - 62, 230, 124, 22)
    context.fillStyle = standing.place === 1 ? '#d7b65e' : '#151f1a'
    context.fill()
    context.strokeStyle = standing.place === 1 ? '#f4d985' : '#35483d'
    context.lineWidth = 2
    context.stroke()
    context.fillStyle = standing.place === 1 ? '#142018' : '#f4efe3'
    context.font = '700 20px ui-monospace, monospace'
    context.fillText(`#${standing.place}`, x, podiumY - 20)
    context.font = '600 24px ui-sans-serif, sans-serif'
    context.fillText(standing.name.slice(0, 18), x, podiumY + 20, 190)
  })

  const awardWidth = 860 / Math.max(model.awards.length, 1)
  model.awards.forEach((award, index) => {
    const x = 110 + awardWidth * index
    context.textAlign = 'left'
    context.fillStyle = '#d7b65e'
    context.font = '700 17px ui-monospace, monospace'
    context.fillText(award.label.toUpperCase(), x, 1090)
    context.fillStyle = '#f4efe3'
    context.font = '600 23px ui-sans-serif, sans-serif'
    context.fillText(award.name.slice(0, 18), x, 1126, awardWidth - 24)
    context.fillStyle = '#92a198'
    context.font = '400 16px ui-sans-serif, sans-serif'
    context.fillText(award.detail.slice(0, 28), x, 1156, awardWidth - 24)
  })

  context.textAlign = 'center'
  context.fillStyle = '#92a198'
  context.font = '600 19px ui-monospace, monospace'
  context.fillText('DEALT AMONG FRIENDS  ·  NO ACCOUNTS  ·  NO REAL-MONEY CHIPS', 540, 1274)

  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('The poster could not be saved.'))),
      'image/png',
      0.94,
    )
  })
}

function posterFileName(roomName: string) {
  const safe = roomName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  return `${safe || 'poker-night'}-final-table.png`
}

function download(blob: Blob, roomName: string) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = posterFileName(roomName)
  anchor.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}

export async function shareTournamentPoster(
  view: GameView,
): Promise<'native' | 'download' | 'cancelled'> {
  const blob = await renderTournamentPoster(view)
  const file = new File([blob], posterFileName(view.roomName), { type: 'image/png' })
  const data: ShareData = {
    title: `${view.roomName} · Final table`,
    text: `${view.standings[0]?.name ?? 'A champion'} took down ${view.roomName}. Open your own table on Felt & Gold.`,
    url: window.location.origin,
    files: [file],
  }

  if (typeof navigator.share === 'function' && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share(data)
      return 'native'
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return 'cancelled'
    }
  }

  download(blob, view.roomName)
  return 'download'
}
