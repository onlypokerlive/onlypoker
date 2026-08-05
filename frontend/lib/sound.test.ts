import { existsSync } from 'node:fs'
import path from 'node:path'

import { beforeEach, describe, expect, it } from 'vitest'

import { GAIN, SAMPLE_FILES, pickVariant, setAudioAudible, unlockAudio } from '@/lib/sound'

const SOUNDS = path.resolve(__dirname, '..', 'public', 'sounds')

describe('las grabaciones existen', () => {
  // Lo único que este módulo no puede comprobar solo. El compilador ya obliga a
  // que cada evento tenga fichero y volumen, pero no sabe si el fichero está en
  // el disco: renombrar un corte en build-sounds.py y no aquí deja ese momento
  // sintetizado para siempre y sin decir nada, que es el fallo que nadie ve
  // hasta que hay gente jugando.
  it.each(SAMPLE_FILES)('%s está en los dos formatos', (name) => {
    expect(existsSync(path.join(SOUNDS, `${name}.webm`)), `falta ${name}.webm`).toBe(true)
    // Los dos, no uno: el .m4a es el que sostiene el Safari viejo, y descubrir
    // que falta significa descubrirlo en el iPhone de otra persona.
    expect(existsSync(path.join(SOUNDS, `${name}.m4a`)), `falta ${name}.m4a`).toBe(true)
  })
})

describe('los volúmenes', () => {
  // Ojo con lo que se puede afirmar aquí. Los ficheros están normalizados al
  // mismo **pico**, y un pico no dice nada de lo alto que suena algo: un golpe
  // seco y un puñado de fichas pueden topar igual y estar seis decibelios
  // aparte para quien escucha. Así que comparar dos números de esta tabla entre
  // sí solo vale cuando los dos sonidos son del mismo material — y la primera
  // versión de este test comparaba madera contra arcilla y daba por buena una
  // jerarquía que no medía nada.

  it('mantiene lo que suena una vez en la noche por encima de todo lo demás', () => {
    // Esta sí se sostiene, porque la distancia es enorme: el grupo raro empieza
    // en 0,246 y el frecuente acaba en 0,151. Ningún reparto espectral cruza un
    // hueco así, y es la única forma de la regla que sobrevive a que los
    // ficheros estén normalizados por pico.
    const cadaMano = [GAIN.chips, GAIN.fold, GAIN.deal, GAIN.flip, GAIN.potCollect,
      GAIN.check, GAIN.raise, GAIN.street, GAIN.potWon, GAIN.yourTurn]
    const unaVezEnLaNoche = [GAIN.allIn, GAIN.levelUp, GAIN.elimination, GAIN.tournamentEnd]

    expect(Math.max(...cadaMano)).toBeLessThan(Math.min(...unaVezEnLaNoche))
  })

  it('deja el final del torneo como el más alto', () => {
    expect(Math.max(...Object.values(GAIN))).toBe(GAIN.tournamentEnd)
  })

  it('da un volumen a cada momento y ninguno se pasa de la raya', () => {
    // Un 3,7 donde iba un 0,37 no lo caza el compilador y no lo caza nadie
    // leyendo: lo caza el que tenga el móvil en la mano cuando alguien suba.
    for (const [moment, gain] of Object.entries(GAIN)) {
      expect(gain, `${moment} fuera de rango`).toBeGreaterThan(0)
      expect(gain, `${moment} fuera de rango`).toBeLessThanOrEqual(1)
    }
    // Escrita a mano y no derivada del módulo: una lista que se saca del propio
    // sitio que comprueba no comprueba nada. `timeWarning` y `error` no están,
    // y no estar es el punto — son la app hablando, no la mesa.
    expect(Object.keys(GAIN).sort()).toEqual([
      'allIn', 'check', 'chips', 'deal', 'elimination', 'flip', 'fold',
      'levelUp', 'potCollect', 'potWon', 'raise', 'street', 'tournamentEnd',
      'yourTurn',
    ])
  })
})

describe('elegir variante', () => {
  const POOL = ['deal-1', 'deal-2', 'deal-3'] as const

  it('nunca repite la anterior', () => {
    // Nueve repartos seguidos con el mismo fichero son una ametralladora, y el
    // oído nota la igualdad mucho antes que el tono.
    for (const previous of POOL) {
      for (let roll = 0; roll < 1; roll += 0.05) {
        expect(pickVariant(POOL, previous, roll)).not.toBe(previous)
      }
    }
  })

  it('puede dar cualquiera de las que quedan', () => {
    const salen = new Set([0, 0.5, 0.99].map((roll) => pickVariant(POOL, 'deal-1', roll)))
    expect([...salen].sort()).toEqual(['deal-2', 'deal-3'])
  })

  it('se queda dentro del array con un 1 redondo', () => {
    // `Math.random()` no devuelve 1, pero el parámetro está abierto para los
    // tests y un índice fuera del array sería `undefined` reproduciéndose como
    // silencio en el momento más ruidoso de la mano.
    expect(POOL).toContain(pickVariant(POOL, 'deal-1', 1))
  })

  it('devuelve la única que hay aunque acabe de sonar', () => {
    expect(pickVariant(['check'], 'check', 0.4)).toBe('check')
  })
})

describe('el canal de audio de iOS', () => {
  // Lo único de todo el fichero que se puede afirmar sin un iPhone delante, y
  // es justo lo que estaba roto: qué sesión se pide, cuándo, y si se devuelve.
  //
  // `navigator.audioSession` no existe en jsdom ni en Chromium — solo en
  // Safari — así que se pone uno de mentira. No es simular iOS: es comprobar
  // que este módulo pide lo que dice pedir. Que `playback` se salte el
  // interruptor de silencio es cosa del sistema y no se puede probar aquí.
  const session = () => (navigator as unknown as { audioSession: { type: string } }).audioSession

  beforeEach(() => {
    Object.defineProperty(navigator, 'audioSession', {
      value: { type: 'auto' },
      configurable: true,
      writable: true,
    })
  })

  it('no reclama nada hasta que la mesa puede hablar', () => {
    // Se reclamaba en el primer toque de la página, incluyera o no sonido esa
    // mesa: una página que interrumpe la música para no decir nada.
    unlockAudio()
    expect(session().type).toBe('auto')
  })

  it('pide el canal exclusivo cuando el sonido está encendido', () => {
    setAudioAudible(true, true)
    expect(session().type).toBe('playback')
  })

  it('se mezcla con la música cuando se lo piden', () => {
    // El interruptor de la hoja de ayuda, y lo único que decide.
    setAudioAudible(true, false)
    expect(session().type).toBe('ambient')
  })

  it('lo devuelve al silenciar la mesa', () => {
    // Quedárselo después de silenciar es haber cogido algo sin decir para qué.
    setAudioAudible(true, true)
    setAudioAudible(false)
    expect(session().type).toBe('auto')
  })
})
