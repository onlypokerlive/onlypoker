# Los sonidos de la mesa

**Estado: hechos.** Los dieciocho ficheros están en `frontend/public/sounds/`,
cortados de siete grabaciones. Este documento era la lista de la compra y ahora
es la especificación: lo que dice cada entrada sobre qué tiene que sonar y por
qué sigue siendo la referencia contra la que se juzga el corte, y los «Buscar:»
que quedan son el rastro de lo que se buscó, no trabajo pendiente.

Lo que hay debajo de cada sonido —qué trozo de qué grabación, y por qué ese y no
otro— está en `frontend/scripts/build-sounds.py`, que además vuelve a
generarlos. Los créditos, en `frontend/public/sounds/CREDITS.md`.

**Antes de nada, tres reglas que deciden más que la elección de cada sonido.**

**La sonoridad es inversa a la frecuencia.** Las fichas suenan cien veces por
noche y tienen que estar casi por debajo del umbral; una eliminación suena dos
veces y puede permitirse ocupar la sala. Si un sonido que se repite está al
mismo volumen que uno raro, la gente silencia la app entera — y con ella pierde
los dos.

**Nada de melodía salvo donde se dice.** Una mesa de póker no toca notas: hace
ruido de arcilla, de cartón, de madera y de tela. Solo hay tres sitios en toda
la app donde una nota está justificada, y están marcados. En el resto, una nota
es lo que hace que suene a casino malo.

**Corto.** La cifra que hay al lado de cada entrada es la duración *después* de
recortar. Casi todo lo que hay en Freesound viene con medio segundo de silencio
delante y una cola de reverb detrás: ambas cosas sobran. El ataque es el sonido;
lo demás es la habitación donde se grabó, que no es la nuestra.

**Formato:** mono, 44.1 kHz, normalizado a −6 dBFS y exportado a `.webm`
(Opus) o `.m4a`. Mono no es un ahorro: son sonidos de objetos que están en un
sitio concreto de la mesa, y el estéreo de la grabación original los pone en un
sitio distinto del que ocupan en pantalla.

---

## Lo que suena todo el rato

Estos cuatro son el 95 % de lo que se oye en una noche. Si solo vas a buscar
cuatro, son estos.

### 1. `chips` — fichas empujadas al centro
**Cuándo:** cada vez que alguien apuesta, iguala o sube. Decenas de veces por
mano. · **Duración:** 100–150 ms · **Volumen:** el más bajo de toda la app.

Un puñado pequeño de fichas de arcilla empujadas hacia delante y chocando entre
sí. Cinco o seis impactos, **desiguales** — si están repartidos a intervalos
regulares suena a caja de ritmos y no hay manera de arreglarlo después.

- Buscar: `poker chips push`, `casino chips handful`, `clay chips small stack`
- **Que no sea:** monedas. Es el error más fácil de cometer y el más audible: el
  metal tiene un tono que se sostiene y la arcilla no. Si al oírlo piensas en
  una máquina tragaperras, es metal.
- **Que no sea:** una sola ficha. Una apuesta nunca es un impacto.

### 2. `raise` — una subida
**Cuándo:** cuando alguien sube. · **Duración:** 200–250 ms · **Volumen:** un
punto por encima de `chips`.

El mismo material y más cantidad, que es exactamente lo que es en la mesa: más
fichas y empujadas con más decisión. **Tiene que ser un fichero distinto**, no
el mismo más alto — igualar y subir sonando igual deja la mitad de la
información de la mesa en silencio.

- Buscar: `poker chips bet stack`, `casino chips toss`

### 3. `deal` — dos cartas a un jugador
**Cuándo:** al repartir, una vez por jugador. Nueve seguidas. · **Duración:**
80–100 ms cada una · **Volumen:** bajo.

Una carta lanzada deslizándose sobre el tapete. Fricción corta y seca, y al
final el golpecito de la esquina al pararse — ese golpecito es lo que separa
una carta de un soplido.

- Buscar: `card deal felt`, `playing card slide`, `card flick table`
- **Ojo:** que sea sobre tela, no sobre madera ni sobre una mesa de cristal.
- **Ideal:** dos o tres variantes. Nueve repartos idénticos son una
  ametralladora; el oído nota la igualdad mucho antes que el tono. Si consigues
  variantes las alterno yo.

### 4. `check` — pasar
**Cuándo:** cada vez que alguien pasa. · **Duración:** 150 ms (los dos golpes)
· **Volumen:** medio-bajo.

Nudillos sobre la madera del canto. **Dos golpes**, separados unos 90 ms, que es
como cae una mano de verdad — uno solo es una puerta. Grave y apagado, muerto de
inmediato: si tiene cola, es un tambor.

- Buscar: `knuckle knock wood table`, `knock on wood dry`
- **Que no sea:** llamar a una puerta. Es más hueco y más lento.

---

## Lo que suena una vez por mano

### 5. `street` — flop, turn o river
**Cuándo:** al abrir cada calle. Tres veces por mano. · **Duración:** 120 ms

Una carta puesta sobre el tapete con intención, no lanzada. Más rotunda que
`deal` y algo más lenta.

- Buscar: `card place felt`, `single card down table`

### 6. `potCollect` — se cierra la calle y las apuestas van al centro
**Cuándo:** al final de cada calle. Tres o cuatro veces por mano. · **Duración:**
300–400 ms

Dos cosas en orden, y el orden importa porque es lo que lo hace *dirección*
en vez de ruido: primero el arrastre sobre la tela, después las fichas
asentándose. Si encuentras las dos por separado mejor, las monto yo.

- Buscar: `chips sweep felt`, `casino chips gather`, `chips rake`

### 7. `fold` — retirarse
**Cuándo:** muchas veces por mano. · **Duración:** 200 ms · **Volumen:** bajo.

Dos cartas empujadas juntas hacia el descarte. Más oscuro y más largo que
repartir, y uno solo: se van juntas.

- Buscar: `cards muck felt`, `cards push away`

### 8. `potWon` — alguien se lleva el bote
**Cuándo:** una vez por mano. · **Duración:** 500 ms

El bote arrastrado hacia un jugador y las fichas cayendo delante de él.
**Fichas, no fanfarria.** Una fanfarria cada mano es lo que hace que la gente
silencie una app, y los dos momentos que sí se la merecen están más abajo.

- Buscar: `chips pull pot`, `chips drop pile`

### 9. `yourTurn` — te toca
**Cuándo:** una vez por mano, y solo a ti. · **Duración:** 200 ms

En una sala lo que te avisa es el crupier dando dos golpecitos en el canto junto
a tu sitio. Más claro y más agudo que el nudillo de un jugador, para que no se
confunda nunca con alguien pasando.

- Buscar: `dealer tap rail`, `light knock wood high`
- **Que no sea:** una notificación. Nada de dos notas subiendo.

### 10. `flip` — una mano se pone boca arriba
**Cuándo:** por cada mano en el showdown; hasta seis seguidas. · **Duración:**
50 ms · **Volumen:** bajo.

El chasquido de una carta al voltearse. Muy seco y muy corto, o seis seguidas se
convierten en un redoble.

- Buscar: `card flip snap`, `card turn over`

---

## Lo que suena una vez en la noche

Aquí es donde hay presupuesto. Estos tres pueden ocupar la sala.

### 11. `allIn`
**Duración:** 700 ms

Una pila entera empujada al centro: un traqueteo largo de fichas. Debajo,
opcionalmente, una nota grave que *se abre* en vez de golpear — un golpe solo es
más fuerte; lo que suena un all-in de verdad es a la sala callándose.

- Buscar: `chips all in push`, `large chip stack slide`

### 12. `elimination` — alguien se va
**Duración:** 800 ms

Sus fichas barridas de la mesa. Arrastre largo sobre tela con las fichas
recogiéndose.

- Buscar: `chips sweep away`, `casino chips clear table`

### 13. `tournamentEnd`
**Duración:** 1,5 s · **Nota permitida.**

Una cascada: una pila muy grande juntándose. Encima, y solo aquí, puede sonar un
acorde.

- Buscar: `chips cascade`, `large chips pile`

### 14. `levelUp` — suben las ciegas
**Duración:** 800 ms · **Nota permitida.**

Una campana suave, una sola. Las salas de verdad tocan una, y es el único
momento en que una nota dice algo que ningún objeto de la mesa podría decir.

- Buscar: `small bell single`, `service bell soft`
- **Que no sea:** un gong ni una alarma.

---

## Los dos que **no** son la mesa

Estos dos los hace la *app*, no la mesa, y por eso pueden y deben sonar
sintéticos. Los tengo ya sintetizados y no hace falta buscarlos, salvo que no te
gusten.

- **`timeWarning`** — se te acaba el tiempo. Tiene que atravesar una habitación
  de gente hablando encima. Solo suena por tu propio reloj: nueve cuentas atrás
  a la vez no son un aviso, son una sala en la que no se puede estar.
- **`error`** — algo que pediste fue rechazado. Corto y hacia abajo.

---

## Y uno que sobra

- **`shuffle`** — el barajado al empezar la mano. **Fuera.** Once ráfagas de
  ruido seguidas de un golpe: suena a alguien rasgando papel de lija, que es
  justo lo que dijiste. Empezar una mano no necesita anunciarse — el reparto
  ya lo anuncia, nueve veces seguidas, y es el sonido correcto para ello. Si
  algún día quieres el barajado, tendrá que ser una grabación real (`card
  riffle shuffle`) y muy baja: sintetizarlo no funciona porque un riffle son
  cincuenta impactos en 400 ms y a esa densidad el ruido blanco deja de sonar a
  cartas y empieza a sonar a estática.

---

## Qué se hizo al final

Siete grabaciones dieron los dieciocho ficheros. La familia de fichas —igualar,
subir, recoger, ganar el bote, eliminar y el final del torneo— sale entera de
una sola grabación, y eso es a propósito: en la mesa todo eso es el mismo
material en distinta cantidad, y si cada uno viene de una grabación distinta
dejan de sonar a la misma mesa.

De las nueve grabaciones descargadas, dos no se usan. `poker_chips5` se
descartó por medida y no por gusto: el 95 % de su energía está por encima de
4 kHz y no le queda cuerpo entre 0,5 y 4 kHz, así que suena a arena en vez de a
arcilla — el mismo error que avisa la entrada de `chips`, pero por el lado
contrario al de las monedas. Y el barajado se queda fuera, como ya decía la
última sección.

**Tres cosas que solo aparecieron al medir**, y que no estaban en este plan:

- El altavoz de un móvil no reproduce nada por debajo de 500 Hz, y la grabación
  del nudillo es un 95 % grave. `check` —el cuarto sonido más frecuente de la
  app— llegaba al altavoz 14 dB más bajo que el resto: en un teléfono,
  silencio. No se arregla subiendo los medios, porque ahí no hay energía que
  subir; se arregla **quitando el grave**, porque al normalizar todos al mismo
  pico eso deja subir lo demás. Sale 6 dB más alto y ya está a la altura de las
  fichas.
- El trozo de `pot-collect` era el más brillante de toda la grabación (64 % por
  encima de 4 kHz). Se corrigió con ecualización en vez de buscar otra ventana,
  porque las ventanas que medían mejor se solapaban con `pot-won` y con
  `elimination`, y dos momentos de la misma mano sonando igual cuesta más caro
  que un filtro.
- `deal` no es un fichero sino dos, elegidos de tres y nunca el mismo dos veces
  seguidas. Con uno solo, repartir a nueve es dieciocho sonidos idénticos, que
  es lo que este documento llamaba una ametralladora.

## La síntesis sigue ahí

No como respaldo teórico: como lo que suena de verdad durante el primer segundo.
Las grabaciones se descargan después del primer toque —que es cuando iOS deja
crear el contexto de audio— y hasta que llegan responde el sintetizador, así que
no hay ni silencio ni pantalla de carga. Un fichero que falle al descargar o al
decodificar deja ese momento sintetizado para siempre y no rompe nada más.

Los ochenta kilobytes van en dos formatos, WebM/Opus y M4A/AAC, y el navegador
elige. Uno solo y equivocarse es un iPhone repartiendo cartas en silencio.

El volumen de cada momento **no está en los ficheros**: todos están normalizados
al mismo pico y la jerarquía entera vive en la tabla `GAIN` de
`frontend/lib/sound.ts`. Ajustar la mezcla es editar catorce números; no hay que
volver a cortar nada.
