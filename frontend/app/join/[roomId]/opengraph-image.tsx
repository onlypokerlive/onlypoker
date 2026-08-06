import { ImageResponse } from 'next/og'

import { APP_NAME } from '@/lib/app-name'
import { getRoomPreview } from '@/lib/room-preview'

export const alt = `A private ${APP_NAME} poker table invitation`
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'
export const revalidate = 15

export default async function OpenGraphImage({
  params,
}: {
  params: Promise<{ roomId: string }>
}) {
  const { roomId } = await params
  const preview = await getRoomPreview(roomId)
  const name = preview?.name ?? 'Private poker table'
  const state = preview
    ? preview.phase === 'lobby'
      ? `${preview.playerCount}/${preview.maxSeats} seats filled`
      : preview.phase === 'finished'
        ? 'Final table'
        : `Hand ${preview.handNumber} in progress`
    : 'Private invitation'

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          position: 'relative',
          overflow: 'hidden',
          background: '#09110e',
          color: '#f4efe3',
          padding: '58px 66px',
          fontFamily: 'Georgia, serif',
        }}
      >
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            opacity: 0.24,
            backgroundImage:
              'repeating-linear-gradient(0deg, transparent 0, transparent 24px, rgba(215,182,94,.09) 25px)',
          }}
        />

        <div style={{ display: 'flex', flex: 1, flexDirection: 'column' }}>
          <div
            style={{
              display: 'flex',
              color: '#d7b65e',
              fontFamily: 'monospace',
              fontSize: 22,
              fontWeight: 700,
              letterSpacing: 4,
            }}
          >
            PRIVATE HOME GAME
          </div>
          <div
            style={{
              display: 'flex',
              maxWidth: 660,
              marginTop: 30,
              fontSize: 70,
              fontWeight: 700,
              lineHeight: 1.04,
              letterSpacing: -2,
            }}
          >
            You’re invited to {name}
          </div>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              marginTop: 36,
              gap: 14,
              fontFamily: 'monospace',
              fontSize: 22,
              color: '#cbd5ce',
            }}
          >
            <div
              style={{
                display: 'flex',
                border: '1px solid #52665a',
                borderRadius: 999,
                padding: '10px 18px',
              }}
            >
              {state}
            </div>
            {preview ? (
              <div
                style={{
                  display: 'flex',
                  border: '1px solid #52665a',
                  borderRadius: 999,
                  padding: '10px 18px',
                }}
              >
                {preview.smallBlind}/{preview.bigBlind} blinds
              </div>
            ) : null}
          </div>
          <div
            style={{
              display: 'flex',
              marginTop: 'auto',
              color: '#92a198',
              fontFamily: 'monospace',
              fontSize: 18,
              letterSpacing: 1.5,
            }}
          >
            NO ACCOUNT · NO DOWNLOAD · ROOM {roomId}
          </div>
        </div>

        <div
          style={{
            position: 'absolute',
            right: 62,
            top: 112,
            width: 330,
            height: 405,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: '50%',
            border: '16px solid #8e6533',
            background: '#18533b',
            boxShadow: 'inset 0 0 50px rgba(0,0,0,.4), 0 28px 60px rgba(0,0,0,.35)',
          }}
        >
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              transform: 'rotate(-7deg)',
            }}
          >
            <div style={{ display: 'flex', color: '#d7b65e', fontSize: 42 }}>♠</div>
            <div
              style={{
                display: 'flex',
                marginTop: 8,
                fontFamily: 'monospace',
                fontSize: 20,
                fontWeight: 700,
                letterSpacing: 3,
                color: '#d7b65e',
              }}
            >
              FELT & GOLD
            </div>
            <div
              style={{
                display: 'flex',
                marginTop: 14,
                fontFamily: 'monospace',
                fontSize: 17,
                color: '#d8e0d9',
              }}
            >
              DEALT AMONG FRIENDS
            </div>
          </div>
        </div>
      </div>
    ),
    size,
  )
}
