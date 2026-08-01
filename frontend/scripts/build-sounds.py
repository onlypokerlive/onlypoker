#!/usr/bin/env python3
"""Corta los sonidos de la mesa a partir de las grabaciones originales.

Las grabaciones no se guardan en el repo: pesan 8 MB y lo que se usa de ellas
son siete segundos en total. Lo que sí se guarda es este fichero, que es la
receta — qué trozo de qué grabación es cada sonido y por qué ese trozo — para
que el corte se pueda repetir o discutir sin volver a escuchar 13 segundos de
fichas buscando dónde estaba el bueno.

    python3 scripts/build-sounds.py ~/Downloads

Lee las fuentes del directorio que se le pase y escribe en `public/sounds/`.

---------------------------------------------------------------------------
Por qué estos trozos y no otros
---------------------------------------------------------------------------

El material se eligió midiendo, no por el nombre del fichero. Lo que decide es
el reparto de energía por bandas, porque es lo que separa la arcilla del metal
y la carta del papel de lija:

  casino-chips.wav        5 % grave · 34 % cuerpo · 60 % aire   <- las fichas
  poker_chips5.wav        0 % grave ·  5 % cuerpo · 95 % aire   <- descartado
  allinpushchips2.mp3     2 % grave · 15 % cuerpo · 83 % aire   <- solo all-in
  cards-deck-hits.wav    17 % grave · 78 % cuerpo ·  5 % aire   <- las cartas
  knock-2.mp3            centroide 478 Hz, cae a −20 dB en 1 ms <- los nudillos

`poker_chips5` está fuera de la familia de fichas por eso: sin cuerpo entre 0,5
y 4 kHz no suena a disco de arcilla, suena a estática. Es exactamente el fallo
que el doc de sonidos avisa de no cometer, solo que por el otro lado — no son
monedas, son arena. `casino-chips` tiene el 34 % de cuerpo que sostiene el
golpe, así que **toda la familia de fichas sale de ese fichero**: es además lo
que hace que igualar, subir y un all-in suenen al mismo material en distinta
cantidad, que es lo que son en la mesa.

`thin-metal-card-deck-shuffle` no se usa. Es el barajado, que el doc deja
fuera, y encima tiene el centroide en 10 kHz — «thin metal» es literal.

---------------------------------------------------------------------------
Volumen
---------------------------------------------------------------------------

Todos los ficheros salen normalizados al mismo pico (−6 dBFS). La jerarquía de
volumen —fichas casi inaudibles, eliminación ocupando la sala— **no está aquí**:
está en la tabla `GAIN` de `lib/sound.ts`, en un sitio donde se lee de un
vistazo y se cambia sin volver a cortar nada. Hornearla en los ficheros la
habría dejado repartida en dieciocho sitios invisibles.
"""

from __future__ import annotations

import re
import shutil
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path

# Mono: son objetos que están en un sitio concreto de la pantalla, y el estéreo
# de la grabación los pone en otro. 44.1 kHz porque nada de esto tiene
# contenido útil por encima de 20 kHz.
RATE = 44100
PEAK_DBFS = -6.0

SOURCES = {
    "chips": "633997__reg7783__casino-chips.wav",
    "push": "freesound_community-allinpushchips2-39133.mp3",
    "cards": "mixkit-cards-deck-hits-1994.wav",
    "carddrop": "u_56l164mftx-carddrop-447013.mp3",
    "knock": "632329__audacitier__knock-2.mp3",
    "bell": "koiroylers-clear-bell-notification-sound-351709.mp3",
    "fanfare": "freesound_community-tada-fanfare-a-6313.mp3",
}


@dataclass
class Part:
    """Un trozo de una grabación, ya colocado en el tiempo."""

    src: str
    start: float
    end: float
    filters: str
    delay: float = 0.0
    gain: float = 1.0
    # `asetrate` sube el tono y **acorta** el trozo en la misma proporción. Se
    # declara aquí en vez de leerse de la cadena de filtros porque la duración
    # real es lo que decide dónde va el fundido de salida, y adivinarla fue lo
    # que dejó a `fold` cortada a la mitad con un clic al final.
    speed: float = 1.0

    @property
    def length(self) -> float:
        """Cuánto dura ya filtrado, en ms."""
        return (self.end - self.start) / self.speed

    @property
    def ends_at(self) -> float:
        return self.delay + self.length


@dataclass
class Cut:
    """Un sonido: uno o varios trozos, y qué hacerles."""

    name: str
    parts: list[Part]
    why: str
    # Cola de silencio a recortar por detrás. `afade` la disimula; esto la quita.
    tail_ms: float = 0.0


def db(x: float) -> str:
    return f"{x:.2f}dB"


# --------------------------------------------------------------------------- #
# La lista
#
# Cada entrada dice de dónde sale, y el comentario dice por qué ese trozo. Los
# tiempos salieron de mirar la envolvente cada 5 ms; los impactos que se citan
# son los que se ven ahí.
# --------------------------------------------------------------------------- #

# Un filtro que aparece en casi todo: quitar el retumbe de la sala por debajo de
# 110 Hz (ningún objeto de esta lista tiene fundamental ahí abajo, así que solo
# es la habitación) y bajar cuatro decibelios el aire por encima de 6,5 kHz. Lo
# segundo es lo que mueve las fichas de «arena» a «arcilla»: la grabación tiene
# el 60 % de la energía por encima de 4 kHz, y en el altavoz de un móvil —que no
# reproduce los graves— ese desequilibrio se vuelve todo lo que se oye.
CLAY = "highpass=f=110,treble=g=-4:f=6500"
# Las cartas ya tienen el cuerpo en su sitio (78 % entre 0,5 y 4 kHz); solo se
# les quita el retumbe.
PAPER = "highpass=f=90"

# --------------------------------------------------------------------------- #
# El altavoz de un móvil
#
# Esto se juega en un móvil encima de la mesa, y un altavoz de móvil no es un
# altavoz: por debajo de 500 Hz no hay prácticamente nada, y lo que sale está
# entre 1 y 4 kHz. Medido con dos filtros de 500 Hz en cascada, `check` perdía
# 14 dB — el sonido que más define el póker, y el cuarto más frecuente de la
# app, llegaba al altavoz como silencio. La grabación del nudillo es un 95 %
# grave: se grabó muy cerca y todo lo que tiene está donde el móvil no llega.
#
# Realzar los medios solo no arregla nada, porque no hay energía ahí que subir:
# +20 dB en 1,4 kHz solo recuperaba 6 dB de los 14. Lo que lo arregla es lo
# contrario — **quitar el grave que el móvil no iba a reproducir de todos
# modos**. Como después todo se normaliza al mismo pico, quitar los graves deja
# subir el resto, y el golpe sale del altavoz 6 dB más alto. Se pierde algo de
# cuerpo con auriculares; se gana existir en un teléfono, que es donde se juega.
KNUCKLE = "highpass=f=220:poles=2,equalizer=f=1700:width_type=o:width=2.4:g=12"
TAP = (f"asetrate={RATE}*1.5,aresample={RATE},"
       "highpass=f=300:poles=2,equalizer=f=2400:width_type=o:width=2.2:g=9")

CUTS: list[Cut] = [
    # ---------------------------------------------------------------- fichas
    # Lo que más suena. Tres variantes porque cien apuestas idénticas por noche
    # las oye el oído como una máquina mucho antes de notar el tono.
    Cut("chips-1", [Part("chips", 6318, 6472, CLAY)],
        "dos discos y el que se asienta detrás: una apuesta pequeña"),
    Cut("chips-2", [Part("chips", 6455, 6620, CLAY)],
        "otro puñado del mismo gesto, impactos en otro sitio"),
    Cut("chips-3", [Part("chips", 6066, 6178, CLAY)],
        "el más corto de los tres: dos impactos y ya"),
    # Mismo material, más cantidad — que es lo que es una subida en la mesa.
    # Fichero aparte y no el mismo más alto: igualar y subir sonando igual deja
    # la mitad de la información de la mesa en silencio.
    Cut("raise", [Part("chips", 6318, 6640, CLAY)],
        "el puñado entero, seis impactos en 320 ms"),
    # El trozo más brillante de toda la grabación: 64 % de la energía por encima
    # de 4 kHz con el filtro normal, que en un altavoz pequeño deja de sonar a
    # arcilla y empieza a sonar a arena. Se corrige aquí en vez de buscar otra
    # ventana porque las que miden mejor se solapan con `pot-won` y con
    # `elimination`, y dos momentos distintos de la misma mano sonando igual
    # cuesta más que un ecualizador.
    Cut("pot-collect", [Part("chips", 6795, 7025, "highpass=f=110,treble=g=-12:f=4200")],
        "tres discos asentándose: las apuestas cerrando la calle"),
    Cut("pot-won", [Part("chips", 8640, 9250, CLAY)],
        "diez impactos: la pila cayendo delante de alguien", tail_ms=30),
    Cut("elimination", [Part("chips", 3070, 3945, CLAY)],
        "trece impactos, largo: sus fichas barridas de la mesa"),
    # El único que no sale de casino-chips, y a propósito: es una grabación de
    # un empujón de verdad, un solo gesto de principio a fin. Tiene más aire de
    # la cuenta (83 %), así que se le baja más.
    Cut("all-in", [Part("push", 200, 800, "highpass=f=110,treble=g=-6:f=6000")],
        "una pila entera empujada al centro, de una vez"),
    # Cascada primero y acorde encima, en ese orden: primero la mesa, y solo
    # después lo único de toda la app que puede permitirse ser una melodía.
    Cut("tournament-end",
        [Part("chips", 11360, 12095, CLAY),
         Part("fanfare", 60, 1330, "highpass=f=120", delay=260, gain=0.62)],
        "quince impactos juntándose, y encima la fanfarria"),
    # ---------------------------------------------------------------- cartas
    # Tres repartos distintos del mismo mazo. Nueve repartos seguidos con un
    # solo fichero son una ametralladora.
    Cut("deal-1", [Part("cards", 8, 118, PAPER)], "primer golpe del mazo", tail_ms=8),
    Cut("deal-2", [Part("cards", 230, 340, PAPER)], "segundo golpe", tail_ms=8),
    Cut("deal-3", [Part("cards", 450, 560, PAPER)], "tercero, algo más apagado", tail_ms=8),
    # Puesta con intención, no lanzada: la caída de carta es más rotunda y algo
    # más lenta que cualquiera de los golpes del mazo.
    Cut("street", [Part("carddrop", 636, 800, PAPER)],
        "una carta puesta sobre el tapete", tail_ms=20),
    # Muy corto a propósito: en un showdown suenan seis seguidos y a poco que
    # tenga cola se convierten en un redoble.
    Cut("flip", [Part("cards", 672, 726, "highpass=f=200")], "el chasquido al voltear"),
    # Dos cartas empujadas juntas hacia el descarte: los dos golpes solapados y
    # muy filtrados, porque se van *alejando* y el tapete se come el brillo. Es
    # el único de la lista que no existe tal cual en ninguna grabación.
    Cut("fold",
        [Part("cards", 452, 600, "highpass=f=90,lowpass=f=2100"),
         Part("cards", 672, 810, "highpass=f=90,lowpass=f=1700", delay=38, gain=0.72)],
        "se van juntas, y se van apagándose"),
    # ---------------------------------------------------------------- madera
    # El sonido del póker. Dos golpes a 92 ms, que es como cae una mano de
    # verdad — uno solo es una puerta. El segundo más flojo: la mano rebota.
    Cut("check",
        [Part("knock", 22, 104, KNUCKLE),
         Part("knock", 22, 104, KNUCKLE, delay=92, gain=0.66)],
        "nudillos sobre la madera, dos veces"),
    # El crupier dando dos golpecitos en el canto junto a tu sitio: el mismo
    # nudillo subido una quinta y adelgazado, para que no se confunda nunca con
    # alguien pasando. Es la única diferencia que importa de toda la lista: si
    # `yourTurn` y `check` se parecen, la mesa deja de decir de quién es el turno.
    Cut("your-turn",
        [Part("knock", 22, 100, TAP, speed=1.5),
         Part("knock", 22, 100, TAP, delay=118, gain=0.80, speed=1.5)],
        "el golpecito del crupier en el canto: más claro y más agudo"),
    # ---------------------------------------------------------------- la nota
    # Una campana, una sola. Las salas de verdad tocan una, y es el único
    # momento en que una nota dice algo que ningún objeto de la mesa podría.
    Cut("level-up", [Part("bell", 44, 1250, "highpass=f=200")],
        "suben las ciegas", tail_ms=40),
]


def run(cmd: list[str]) -> subprocess.CompletedProcess[bytes]:
    p = subprocess.run(cmd, capture_output=True)
    if p.returncode != 0:
        sys.exit(f"ffmpeg falló:\n{' '.join(cmd)}\n{p.stderr.decode()[-2000:]}")
    return p


def peak_dbfs(path: Path) -> float:
    out = subprocess.run(
        ["ffmpeg", "-v", "info", "-i", str(path), "-af", "volumedetect", "-f", "null", "-"],
        capture_output=True,
    ).stderr.decode()
    m = re.search(r"max_volume:\s*(-?[\d.]+) dB", out)
    return float(m.group(1)) if m else 0.0


def build(cut: Cut, src_dir: Path, tmp: Path) -> Path:
    """Monta un sonido en WAV float, con los trozos ya mezclados y a nivel."""
    inputs: list[str] = []
    chains: list[str] = []
    labels: list[str] = []

    for i, part in enumerate(cut.parts):
        src = src_dir / SOURCES[part.src]
        if not src.exists():
            sys.exit(f"falta la grabación: {src}")
        inputs += ["-ss", f"{part.start / 1000:.4f}", "-to", f"{part.end / 1000:.4f}",
                   "-i", str(src)]
        # −6 dB antes de bajar a mono: casino-chips pica a +2,9 dBFS al sumar los
        # dos canales, y sin esto el recorte ocurre antes de que nadie lo mida.
        chain = (f"[{i}:a]volume=-6dB,aformat=channel_layouts=mono,"
                 f"aresample={RATE},{part.filters}")
        # 2 ms de entrada porque un corte a mitad de onda es un clic, y en el
        # altavoz de un móvil el clic es más fuerte que el sonido. El de salida
        # se pone al final del *trozo ya filtrado*, que no es lo mismo que al
        # final del recorte cuando `asetrate` lo ha encogido.
        chain += ",afade=t=in:st=0:d=0.002"
        chain += f",afade=t=out:st={max(0.0, part.length - 18) / 1000:.4f}:d=0.018"
        if part.gain != 1.0:
            chain += f",volume={part.gain:.3f}"
        if part.delay:
            chain += f",adelay={int(part.delay)}"
        chains.append(f"{chain}[p{i}]")
        labels.append(f"[p{i}]")

    graph = ";".join(chains)
    if len(labels) > 1:
        # `normalize=0` porque amix por defecto divide entre el número de
        # entradas, que convierte una capa añadida en una bajada de volumen del
        # conjunto. Aquí las capas se suman y el nivel se arregla al final.
        graph += (f";{''.join(labels)}"
                  f"amix=inputs={len(labels)}:normalize=0:dropout_transition=0[mix]")
        out_label = "[mix]"
    else:
        out_label = labels[0]

    raw = tmp / f"{cut.name}.raw.wav"
    run(["ffmpeg", "-y", "-v", "error", *inputs, "-filter_complex", graph,
         "-map", out_label, "-c:a", "pcm_f32le", str(raw)])

    # Segunda pasada: llevar el pico a −6 dBFS. Todos al mismo sitio, para que
    # la jerarquía de volumen viva entera en la tabla GAIN de sound.ts.
    post = f"volume={db(PEAK_DBFS - peak_dbfs(raw))}"
    if cut.tail_ms:
        # Medido sobre el trozo que acaba más tarde, no sobre el primero: con
        # dos cartas solapadas el primero acaba antes que el sonido, y recortar
        # por ahí dejaba la segunda carta cortada a media caída — un clic donde
        # tenía que haber tapete.
        span = max(p.ends_at for p in cut.parts)
        post += f",atrim=end={(span - cut.tail_ms) / 1000:.4f}"
        # Recortar es hacer un corte nuevo, así que se vuelve a fundir.
        post += f",afade=t=out:st={(span - cut.tail_ms - 12) / 1000:.4f}:d=0.012"
    run(["ffmpeg", "-y", "-v", "error", "-i", str(raw), "-af", post,
         "-c:a", "pcm_f32le", str(levelled := tmp / f"{cut.name}.wav")])
    return levelled


def encode(wav: Path, out_dir: Path, name: str) -> dict[str, int]:
    """Dos formatos, porque no hay uno que toquen todos los navegadores.

    Opus en WebM es la mitad de tamaño y lo tocan Chrome, Firefox y Safari
    moderno. AAC en M4A es el que sostiene Safari viejo, que en un juego que se
    juega en el móvil con los amigos no es un caso raro sino la mitad de la
    mesa. Los dos son pequeños; elegir uno solo y equivocarse es un iPhone que
    reparte cartas en silencio.
    """
    sizes = {}
    webm = out_dir / f"{name}.webm"
    run(["ffmpeg", "-y", "-v", "error", "-i", str(wav), "-c:a", "libopus",
         "-b:a", "64k", "-vbr", "on", "-application", "audio", str(webm)])
    sizes["webm"] = webm.stat().st_size
    m4a = out_dir / f"{name}.m4a"
    run(["ffmpeg", "-y", "-v", "error", "-i", str(wav), "-c:a", "aac",
         "-b:a", "96k", "-movflags", "+faststart", str(m4a)])
    sizes["m4a"] = m4a.stat().st_size
    return sizes


def main() -> None:
    src_dir = Path(sys.argv[1] if len(sys.argv) > 1 else "~/Downloads").expanduser()
    out_dir = Path(__file__).resolve().parent.parent / "public" / "sounds"
    out_dir.mkdir(parents=True, exist_ok=True)
    tmp = out_dir.parent / ".sounds-tmp"
    tmp.mkdir(exist_ok=True)

    total = {"webm": 0, "m4a": 0}
    try:
        for cut in CUTS:
            wav = build(cut, src_dir, tmp)
            sizes = encode(wav, out_dir, cut.name)
            for k, v in sizes.items():
                total[k] += v
            dur = float(
                subprocess.run(
                    ["ffprobe", "-v", "error", "-show_entries", "format=duration",
                     "-of", "csv=p=0", str(wav)], capture_output=True
                ).stdout.decode().strip()
            )
            print(f"  {cut.name:<16} {dur * 1000:6.0f} ms  "
                  f"{sizes['webm'] / 1024:5.1f} KB webm  {sizes['m4a'] / 1024:5.1f} KB m4a"
                  f"   {cut.why}")
    finally:
        shutil.rmtree(tmp, ignore_errors=True)

    print(f"\n  {len(CUTS)} sonidos · {total['webm'] / 1024:.0f} KB (webm) · "
          f"{total['m4a'] / 1024:.0f} KB (m4a) → {out_dir}")


if __name__ == "__main__":
    main()
