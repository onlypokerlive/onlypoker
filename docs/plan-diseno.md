# Plan de la mesa — del prototipo al repo

Hermano de [`plan-implementacion.md`](plan-implementacion.md), que decide *qué features se construyen*.
Este decide **cómo entra en el repo la capa visual y de movimiento** que se diseñó en el prototipo, y qué
situaciones siguen sin pantalla.

No toca el plan de implementación: ese está a punto de mergearse. De aquí sale el plan de cambios.

**Origen.** Quince vueltas del prototipo de mesa
(`https://claude.ai/code/artifact/51cc9c63-ef5c-431c-9124-bcd260a4f050`) contra el código real de
`frontend/` y `backend/`, leído para escribir esto.

**Leyenda.** Impacto ⭐-⭐⭐⭐ · Esfuerzo **S** (un rato) / **M** (sesión) / **L** (varias) · 🚩 vigilar ·
🚩🚩 vigilar mucho.

---

## Estado

| Bloque | Qué es | Items |
|---|---|---|
| **0** | Correcciones al plan de implementación | 3 hallazgos |
| **V** | Tandas de implementación de la mesa | V1 · V2 · V3 · V4 · V5 |
| **X** | Lo que cruza los dos planes (toca backend) | X1 · X2 |
| **§3** | Sonidos | 8 nuevos + 2 mejoras de sistema |
| **P** | Pantallas sin diseño | P1 · P2 · P3 · P4 · P5 |
| **S** | Situaciones sin pantalla | S1 · S3 · S4 · S5 · S6 |
| **G** | Decisiones | **todas cerradas** — G1 ✅ · G2 ✅ · G3 ✅ |

**Camino crítico:** X1 (el campo que falta en la vista) bloquea la línea de acción **y** tres de los ocho
sonidos. Es lo primero que hay que decidir porque es lo único que toca backend y no está en ningún plan.

---

## 0 · Correcciones al plan de implementación

Leído el código, tres premisas están desactualizadas. Las tres cambian el trabajo.

### 0.1 · «`poker-table.tsx` posiciona con `left/top` en %» — solo a medias

El plan deja fuera las animaciones de §4.1–4.4 porque *"casi todas exigen que `poker-table.tsx` deje de
posicionar con `left/top` en % y pase a `transform`"*. La realidad:

| Pieza | Estado real |
|---|---|
| Anillo de asientos | Calculado en JS (`seatAngle`, `seatPosition`), servido en **% por `left/top`** |
| Apuestas | **Ya en píxeles medidos**, con `useLayoutEffect` + `ResizeObserver` |
| Evitar solapes | **Ya implementado**, y mejor que en el prototipo |

`betOffset()` ([`poker-table.tsx:145`](../frontend/components/poker-table.tsx:145)) hace una búsqueda con
**función de coste**: empuja hacia el centro, desliza en tangente y pondera el board 200× por encima de los
asientos, de modo que una mesa sin solución degrada en vez de romperse. Mi prototipo hacía *first-fit* — esto
es mejor. **No hay que reescribirlo: hay que extraerlo y ampliarlo.**

### 0.2 · «A3 sonido — ✅ hecho» — le falta el sonido más reconocible del póker

`lib/sound.ts` está bien resuelto —sintetizado con Web Audio, sin samples que descargar, con el desbloqueo de
iOS— y tiene ocho voces. **No tiene la de pasar.** Golpear la mesa con los nudillos es *el* sonido del póker
y hoy pasar es mudo. Tampoco distingue igualar de subir, ni tiene all-in. Ver §3 — y ojo, que se topa con X1.

### 0.3 · Lo que ya existe y no hay que rehacer

`player-seat.tsx` tiene SB/BB/STR/all-in/fold/out/ausente, **desconectado con icono**, reloj por asiento y
revelado de showdown incluido el «enseñé solo una». `playing-card.tsx` ya tiene la cara de tres bandas.
Existen `blind-clock.tsx`, `hole-cards.tsx`, `show-cards.tsx`, `rabbit-hunt.tsx`, `host-panel.tsx`,
`bet-sizing.ts` con tests, y **`use-runout.ts`, que es A4**.

**No falta lógica: falta materia y movimiento.** Las fichas hoy son un punto de 8px dentro de una píldora.

---

## X · Lo que cruza los dos planes

### X1 · La vista no dice qué acaba de hacer nadie  `⭐⭐⭐ · S (backend) · 🚩🚩`

**El hallazgo de esta revisión, y no está en ningún plan.**

`table-events.ts` recupera los momentos **diffeando vistas**, porque no hay bus de eventos. Funciona para casi
todo… menos para el caso que importa:

| Acción | ¿Deja rastro en la vista? |
|---|---|
| Apostar / igualar / subir | Sí — `players[].bet` crece |
| Retirarse | Sí — `players[].folded` cambia |
| **Pasar** | **No. Nada cambia salvo `actorId`** |

Y «`actorId` avanzó sin que cambie nada» es **indistinguible** de que la mano haya pasado de calle, de que
alguien se haya quedado sin tiempo, o de un reparto. Así que:

- **El sonido de pasar —el que pediste— es literalmente indetectable hoy.**
- La **línea de acción** («Santi sube a 900») tampoco se puede escribir: se puede inferir "subió" del cambio
  de `bet`, pero no "pasó", y una línea que se salta la mitad de las acciones es peor que ninguna.
- `message` **no sirve**: se calcula en cliente desde `lastResults`
  ([`poker-api.ts:284`](../frontend/lib/poker-api.ts:284)), es el resumen de la mano cerrada, no un feed.

**Lo que falta:** un `lastAction` en `GameView` —`{ playerId, kind: 'check'|'call'|'raise'|'fold'|'allIn',
amount, handNumber, seq }`— y `seq` para que el cliente sepa si ya lo tocó (con polling la misma acción llega
varias veces).

**Barato en backend, y desbloquea tres cosas de golpe:** el sonido de pasar, la línea de acción y la etiqueta
sobre el asiento. Si no se hace, V5 y §3 se quedan a medias las dos.

🚩🚩 Con polling a 1,2 s, **dos acciones rápidas se pierden**: si Ana pasa y Beto pasa entre dos sondeos, solo
llega la última. O se sirve una lista corta de las últimas N acciones de la mano, o se acepta explícitamente
la pérdida. Recomiendo la lista: cuesta lo mismo y también alimenta P5 (historial).

### X2 · Botes laterales en la vista  `⭐⭐⭐ · M · 🚩`

`_build_view` sirve un `pot` único. Con nueve y all-ins puede haber tres, y hoy **el jugador no puede saber
por cuánto está jugando**. Hay que servir la lista con su reparto y quién es elegible en cada uno.

Etiquetas: **Bote 1 / Bote 2**, y con uno solo ni se numera.

🚩 Es corrección, no adorno: hoy la vista miente por omisión.

---

## 1 · El refactor, planteado

### 1.1 · Qué es exactamente

Tres cosas, y solo la tercera es cara.

**(a) Los asientos, de % a píxeles medidos.** Las apuestas ya viven en píxeles porque tenían que esquivar
cajas reales; los asientos siguen en `left/top` en %. El anillo y lo que lo esquiva están en dos sistemas de
coordenadas distintos. Unificarlo es barato —la medición ya está montada— y es prerrequisito de (c).

**(b) La ranura de `transform` está ocupada.** Cada elemento posicionado lleva `-translate-x-1/2
-translate-y-1/2` de Tailwind, que **es** su `transform`. Para animar una ficha del asiento al bote habría que
reescribir esa transformación entera en cada fotograma, y además `left/top` provoca *layout* en cada frame
mientras que `transform` va al compositor.

La salida es el **partido ancla/contenido**, que es lo que hace el prototipo:

```tsx
// El ancla coloca. Coordenada de esquina, no de centro: la mitad ya la sabemos
// porque medimos la caja, así que el translate(-50%) deja de hacer falta.
<div className="absolute left-0 top-0" style={{ transform: `translate3d(${x}px, ${y}px, 0)` }}>
  {/* El contenido queda libre para animarse sin tocar la colocación. */}
  <div className="chip-content">…</div>
</div>
```

**(c) La geometría, fuera del componente.** `seatAngle`, `seatCentre`, `seatBox`, `betOffset` y las constantes
viven dentro de `poker-table.tsx` y **no se pueden probar sin renderizar**. Sacarlas a `lib/table-layout.ts`
como funciones puras es el trabajo de verdad y el que más devuelve.

### 1.2 · Por qué merece la pena — el argumento fuerte

**Porque convierte la invariante en un test.**

He comprobado a mano, en el navegador, **diez veces**, que nada se pisa: tres tamaños de móvil × tres estados
del board × 6 y 9 asientos, más con los turnos corriendo. Eso hoy **no se puede afirmar en CI**. Con la
geometría en funciones puras:

```ts
// lib/table-layout.test.ts
for (const width of [320, 375, 390, 430])
  for (const board of [0, 3, 4, 5])
    for (const seats of [2, 6, 9])
      expect(solapes(layoutTable({ width, board, seats }))).toEqual([])
```

Milisegundos, y cubre lo único que se ha roto una y otra vez. **Ese es el motivo del refactor**, no la
elegancia.

### 1.3 · Qué añade `table-layout.ts` sobre lo que ya hay

- `seatCentre` / `seatBox` / `betOffset` — extraídos tal cual.
- **`stackOffset` — nuevo.** La pila del jugador, con la regla que costó tres vueltas: **nunca por encima de
  la placa**, porque encima viven el avatar y las cartas. La dirección sobrevive en *qué costado* (la
  izquierda del jugador, que para el de arriba es la derecha de la pantalla); si ese costado no cabe se prueba
  el otro, y si tampoco, debajo. **Arriba, nunca.**
- **Orden de medición explícito:** asientos → apuestas → pilas. Cada capa necesita las cajas de la anterior, y
  hacerlo al revés es exactamente el fallo que tuve.
- **Recolocación**, que se me olvidó dos veces: hay que rehacer el reparto cuando **crece el board** (de tres
  a cinco cartas), cambia el número de asientos o cambia el viewport.
- **Heads-up (S3)** se resuelve aquí, una vez.

### 1.4 · Trampas

- 🚩 **`useLayoutEffect` con tres pasadas** sin provocar un bucle de renders. Ya hay un `measured` que lo
  gestiona con dos; ampliarlo con cuidado.
- 🚩 **`ResizeObserver` sobre elementos que el propio efecto crea.** Ya pasa con las apuestas; con las pilas
  serán tres familias. Observar el contenedor donde se pueda.
- 🚩 **`translate3d` fuerza capa de compositor.** Nueve asientos × varias capas es mucha memoria de GPU en un
  móvil viejo. `translate3d` solo en lo que se anima; `translate` normal para lo estático.
- 🚩 **El breakpoint `sm:` existe y el plan lo da por fuera de alcance.** `poker-table.tsx` tiene
  `sm:aspect-[3/2] sm:max-w-3xl`: hay una mesa de escritorio hoy, aunque §5.5 la excluya. El refactor **tiene
  que decidir explícitamente** si `table-layout.ts` recibe el ancho real (y sirve a los dos) o si se congela
  el `sm:` como está. Descubrirlo a mitad es rehacerlo.

### 1.5 · Comprobación

1. Test de la matriz de solapes (§1.2). **Es el entregable, no un extra.**
2. Test de que la recolocación dispara con board 3→5, asientos 9→6 y cambio de viewport.
3. Revisión visual en 320 / 375 / 390 / 430 a 2, 6 y 9 asientos.

**Esfuerzo: M-L.** Menos de lo que temía el plan, porque la mitad ya está escrita.

### 1.6 · Lo que la maqueta ya decide  *(añadido tras afilar el prototipo, v19)*

El prototipo se repasó buscando lo que, copiado tal cual, se convertiría en deuda. Salieron decisiones que
§1.3–§1.5 dan por hechas pero no concretan. Aquí quedan cerradas, para que el port sea copiar y no traducir.

**(a) El orden es borrar → medir → calcular → escribir.** §1.3 pide un «orden de medición explícito»; falta
decir que las tres fases no se pueden intercalar. En la maqueta se medía y se colocaba asiento por asiento, y
cada inserción invalidaba el layout para la medida del siguiente. Separarlo bajó las medidas de layout de
**97 a 40** al apostar y de **99 a 42** al cambiar de móvil, sin tocar el resultado visual.

En React esto es literal: el `useLayoutEffect` **lee todo primero, en un solo bloque, y escribe después**. Si
alguna escritura se cuela entre dos lecturas, vuelve el problema y no se nota hasta que hay nueve asientos.

**(b) Las dos funciones puras, con su firma.** No leen del DOM ni escriben en él:

```ts
chipSpot(sr, pr, angle, stack, estorbos, baize, chipW): { dx, dy }
betSpot (sr, br, angle, blocks):                        { x, y }
```

`sr` es la caja del asiento y `pr` la de la **placa** — la pila se cuelga de la placa, no del asiento, porque
la placa es el jugador y el resto es aire. `betSpot` se llama en cadena, y cada apuesta esquiva a las
anteriores **en su hueco nuevo**, llevado en memoria. Leerlo del DOM a mitad del recorrido hace que el
resultado dependa del orden de iteración y de posiciones que están a punto de dejar de ser ciertas.

**(c) El desempate es un coste, no una escalera de `if`.** Cuando ninguna posición candidata cumple, hay que
elegir la menos mala — y *pisar algo* tiene que pesar más que *rozar el canto de la madera*:

```
coste = (pisa ? 100 : 0) + max(0, felt − 0.94) × 40
```

Es la misma forma que `betOffset()` ya usa con su `BOARD_WEIGHT`, así que las dos colocaciones acaban
hablando el mismo idioma. Sin esto, en un SE con cinco cartas las pilas de los costados caen sobre el board.

**(d) `stackOffset` esquiva tres cosas, no una.** §1.3 dice «nunca por encima de la placa» y eso sigue siendo
la regla dura, pero no basta: la pila tiene que librar **las apuestas, el centro de la mesa (botes + board +
montón) y el contenido de los asientos vecinos (placa y cartas)**. Las dos últimas faltaban y se notaba justo
donde más duele: pantalla corta con el board completo, y manos enseñadas.

**(e) La recolocación tiene un disparador más.** §1.3 lista board 3→5, número de asientos y viewport. Falta
el que más se olvida: **cuando un asiento cambia de tamaño**. Al enseñarse una mano, las cartas pasan de 14 a
22 píxeles y el asiento crece — y todo lo que se colocó midiéndolo queda contra una caja que ya no existe.
Conviene una sola función (`relayout()` en la maqueta) que rehaga apuestas **y** pilas, y llamarla siempre a
la vez: hacerlo a medias es lo que dejaba apuestas debajo de manos enseñadas.

**(f) Las constantes, en un sitio.** Elipse de asientos `RX 41 / RY 40 / CY 53` (% de la zona de mesa), umbral
de paño `0.94`, holguras `2` (pila–placa) y `5` (apuesta–asiento), deslizamiento tangencial
`[0, ±20, ±38, ±56, ±74]` y acercamiento al dueño `[0, 10, 20, 30]`. Sueltas por el código son inencontrables;
juntas son la mitad de `table-layout.ts`.

**(g) El SE tiene un techo, y es una cesión consciente.** Con nueve asientos en 375 px, una mano enseñada a
20×28 **choca con la placa del vecino** — los asientos están a menos de treinta píxeles. En el prototipo
crece solo a 17×24. Es el único punto donde la pantalla obliga a ceder legibilidad; queda escrito para que no
se redescubra a mitad de implementación.

**(h) Refinamientos al test de §1.2**, que es el entregable:

- La matriz tiene que incluir el estado **«mano enseñada»**, no solo board × asientos × ancho. Es el que
  rompe, porque cambia el tamaño de las cajas.
- El detector debe **ignorar lo invisible**. Un elemento con `opacity: 0` no tapa nada; contarlo da falsos
  positivos y erosiona la confianza en el test. En el prototipo, los únicos solapes que quedan son 300 ms en
  los que la mano perdedora, ya desvaneciéndose, cruza al vecino camino del muck — eso es la animación.
- Conviene medir **durante** las transiciones, no solo en reposo. Muestreando cada 150 ms durante el showdown
  entero salieron dos fallos que en reposo no aparecen.

**(i) Tres reglas de estado que el port no puede perder:**

- **El dibujo no es el estado.** Nunca parsear un número ya formateado para recuperarlo (sacar «1.800» del DOM
  para deducir `1800`): se rompe con solo cambiar el separador de miles, y es la familia de bug que ya costó
  una ronda entera.
- **Una acción se aplica en un solo sitio, y el render no es ese sitio.** Cuando pintar y aplicar se mezclan,
  o se cobra dos veces o no se cobra ninguna.
- **Una calle a la vez.** Repartir tiene que rechazar reentradas mientras está en curso, y el control que la
  dispara tiene que respetar ese rechazo. Sin la guarda, tres toques en «Flop» dejan doce cartas en la mesa.

**(j) Semántica ya decidida, para no inventarla en el componente.** El deslizador de apuesta es
`role="slider"` con `aria-valuemin/max/now` y un `aria-valuetext` legible («3.650 fichas · 36,5 ciegas
grandes»), foco visible, y teclado: flechas ±1 ciega grande, Página ±10, Inicio/Fin a los topes. La línea de
acción es `role="status" aria-live="polite"` — es el único sitio donde se dice lo que pasó mientras mirabas
tus cartas, y sin eso no se dice a quien no la ve.

Y los **nombres los escribe el jugador**: van escapados o dentro de un nodo de texto. En el repo eso es la
diferencia entre un `<span>{name}</span>` y un agujero.

---

## 2 · Las tandas

Cada una deja la app funcionando y visiblemente mejor; lo arriesgado va cuando ya hay red.

### V1 · Materia  `⭐⭐⭐ · M` — sin lógica, sin riesgo

- **Tapete y canto**: paño con grano, madera, filete de oro, viñeta. Hoy es un `radial-gradient` plano.
- **Cuatro tapetes y cuatro barajas**, elegibles por el host. Toca `create-room-form.tsx` y dos campos en
  `CreateRoomBody`.
- **El naipe**: esquina con figura y palo, filete blanco, canto oscuro, grano de papel. `playing-card.tsx` ya
  tiene la estructura de tres bandas; falta el material y que a tamaño `xs` use **esquina** en vez de centrar
  (a 12px la esquina se lee y el centrado no).
- **Fichas de verdad**: `components/chip-stack.tsx` nuevo, con denominaciones mezcladas —nunca una torre de un
  solo color, que no pasa en una mesa real— y sombra elíptica que las posa en el paño.
- **Tacto de los botones**: hundido al pulsar y destello desde el punto tocado, en `action-bar.tsx`. Veinte
  líneas, y es lo que evita que una acción irreversible se pulse dos veces.

**Cómo aterriza técnicamente** (decidirlo aquí o se decidirá mal): los tokens de tapete y baraja son
**variables CSS en `globals.css`** bajo selectores `[data-mesa]` / `[data-baraja]`; los componentes siguen en
Tailwind y solo consumen `var(--…)`. Nada de reescribir a CSS plano.

🚩 Los tokens tienen que colgar de `[data-baraja]` y no del contenedor de la mesa, o las miniaturas del
selector en la pantalla de creación no se pueden pintar.

🚩 **`playing-card.tsx` tiene `aria-label` por carta** («Ace of spades») y el dorso también. El marcado nuevo
**tiene que conservarlos**: es la regresión más fácil de colar y la más difícil de ver.

### V2 · El refactor  `⭐⭐⭐ · M-L · 🚩` — §1 entero

Va después de V1 a propósito: cuando llegue, las pilas ya existen y hay algo real que colocar.

### V3 · Gestos  `⭐⭐⭐ · L · 🚩🚩` — la parte delicada

- **Peek por oclusión**: las cartas viven metidas bajo el labio del tapete y salen al tirar de ellas. Cinco
  intentos costó dar con ello: **la revelación es la oclusión, no un fundido**. La comba de catorce tramos es
  sabor, no mecanismo.
- **Doble toque en todo el verde** para pasar, con aviso visible.
- **Arrastre al descarte** con la caja **por encima** de la línea de separación y el recorrido calculado para
  que el canto caiga dentro en los tres móviles.
- **Al retirarte, las cartas se van y no vuelven** hasta la mano siguiente; la banda se apaga, el doble toque
  deja de pasar, y el verde que queda lo ocupa la única decisión que resta: **qué enseñas** (G1 ✅).

🚩🚩 Trampas ya pagadas en el prototipo, que hay que llevarse escritas:
- `filter` y `overflow` son **propiedades de agrupación**: fuerzan `transform-style: flat` y parten el 3D
  anidado. Nada de `drop-shadow` sobre las cartas dobladas.
- `setPointerCapture` **lanza** con pointerIds sintéticos → try/catch.
- La altura de tramo tiene que ser **múltiplo exacto** o salen *hairlines*; además hacen falta 0,6px de
  solape, y las sombras **solo interiores** (una exterior sangra sobre el tramo vecino).
- **Colisiones de nombre de clase**: `.win` era a la vez «ventana de tramo» y «carta ganadora», y las cartas
  del board heredaban un `position:absolute`. Costó una hora encontrarlo.

### V4 · Movimiento  `⭐⭐⭐ · L`

Y aquí hay un regalo: **el transporte ya existe**. `table-events.ts` ya deriva `deal`, `street`, `chips`,
`potWon`, `levelUp`, `elimination` diffeando vistas. Hoy solo disparan sonido; ahora disparan también
movimiento.

- Fichas volando **en arco** (dos capas: recorrido recto fuera, salto dentro).
- Recogida al cerrar la calle → montón del bote; bote al ganador con **recuento de la pila**.
- Reparto desde el botón del dealer.
- **Flop carta a carta**: llega de dorso, se pone de canto, cambia de cara y se abre. 290ms entre una y otra.
- **Showdown en seis tiempos**: se completa la mesa → se giran las manos **una a una** en orden de acción →
  suben tus cartas solas → se apaga el resto y se encienden las cinco de la jugada **en secuencia** → la
  jugada se dice en la placa del ganador → el bote se va en arco.
- La mano enseñada **crece** al girarse: a 12px no se lee, y el showdown es cuando hay que leerla.

🚩 `requestAnimationFrame` **no dispara con la pestaña detrás** y la ficha se queda clavada a medio vuelo.
Reflow forzado (`void el.offsetWidth`). Ya me pasó.
🚩 El giro de carta **no** con `preserve-3d` + `backface-visibility` anidados: Safari se deja cartas sin
pintar. Una sola cara que se pone de canto y cambia de contenido a mitad.
🚩 Quien entra a mitad lo ve en el estado final, sin animación — misma regla que ya sigue `use-runout`.
🚩 **`prefers-reduced-motion`.** Una tanda entera de movimiento necesita su rama: nada de vuelos ni volteos,
todo al estado final, **pero conservando los tiempos** — si el showdown se resuelve de golpe, quien lo tenga
activado no se entera de quién ganó. Es accesibilidad, no un extra.

### V5 · Turno, relojes y la voz de la mesa  `⭐⭐⭐ · M` — depende de X1

- **Foco viajando** de asiento en asiento con anillo que se vacía de verdad.
- **Aviso por tres canales** a falta de N segundos: color, número y latido. Tres porque la háptica en iOS no
  se puede dar por hecha y el sonido puede estar quitado.
- **El canto de tu zona como reloj** cuando te toca: no hay que mirar arriba para saber que se acaba.
- **Fuera de tu turno la banda se apaga** — y ese hueco es donde luego viven las pre-acciones (P1).
- **Reloj de ciega** en la barra superior con la cuenta y el canto vaciándose; cartel al subir.
- **Línea de acción** («Santi sube a 900») — **bloqueada por X1**.

---

## 3 · Los sonidos, revisados

`sound.ts` está bien planteado, así que esto es **ampliarlo**, no rehacerlo. La regla que ya sigue y se
mantiene: **el volumen es inverso a la frecuencia**.

### 3.1 · Lo que falta

| # | Sonido | Cuándo | Por qué | Síntesis |
|---|---|---|---|---|
| 1 | **`check` — el toque de nudillos** | al pasar | **El sonido del póker.** Todo el mundo lo reconoce y hoy pasar es mudo | Ráfaga de ruido paso-bajo + seno resonante grave (~150 Hz) de caída muy rápida. **Dos golpes, ~90 ms** |
| 2 | `fold` | al retirarse | Cartas deslizando sobre paño | `swish` más largo y oscuro que `deal`, uno solo |
| 3 | `raise` | al subir | Hoy subir y pagar suenan igual, y no son lo mismo | Como `chips` con más cuerpo y dos golpes |
| 4 | `allIn` | all-in | La mesa se para: se merece el suyo | Nota grave sostenida que se abre, sin percusión |
| 5 | `flip` | cada mano girada en el showdown | En secuencia construye la tensión | Chasquido seco y corto |
| 6 | `timeWarning` | últimos segundos, **solo el tuyo** | Es el aviso que no puede fallar | Tic corto, repetido, acelerando |
| 7 | `potCollect` | al cerrar la calle | Fichas barridas al centro | Roce de arcilla, distinto de `potWon` |
| 8 | `error` | acción rechazada | Con pre-acciones va a pasar | Tic negativo, muy corto |

🚩🚩 **Los tres primeros dependen de X1.** `check` es indetectable sin él; `fold` y `raise` se pueden inferir
del diff, pero mal —un fold por tiempo agotado suena igual que uno decidido, y no lo son. Si X1 no entra, §3
se queda en los cinco de abajo.

### 3.2 · Lo que **no** debe sonar

Tan importante como la lista:

- **Mirar tus cartas.** Gesto privado y continuo; un sonido le diría a la mesa que estás mirando.
- El deslizador y los botones de tamaño — el destello visual ya lo dice.
- **El reloj de los demás.** Con nueve jugadores sería ruido constante. El tic es solo tuyo.
- Cambios de pila, etiquetas, y entrar/salir **a mitad de mano** (sí en el lobby).

### 3.3 · Dos mejoras de sistema

**Variación.** Un reparto a nueve son dieciocho sonidos de carta; la misma muestra dieciocho veces suena a
ametralladora. Con síntesis sale gratis: variar el corte del filtro ±8 % y la ganancia ±10 %. **Sin esto, el
reparto carta a carta de V4 sonará peor que el de golpe de ahora.**

**El interruptor, de dos estados a tres:** **todo / solo mi turno / nada**. La situación real es «estoy en el
sofá con gente delante y solo quiero enterarme de cuándo me toca». Va visible en la mesa, no en ajustes
(§4.6). Más barato de lo que parece y mejor producto que un mute.

---

## 4 · Pantallas y situaciones sin diseño

| # | Pantalla | Cubre | Impacto | Esf. |
|---|---|---|---|---|
| **P1** | **Pre-acciones.** El hueco ya está: la banda apagada fuera de turno. Casillas *Paso / Me retiro*, *Igualo*, *Igualo lo que sea* | C5 | ⭐⭐⭐ | M 🚩 |
| **P2** | **Recompra y entrada tardía.** Trae un **segundo reloj** que compite con el de la ciega por la misma barra: decidir jerarquía **antes** de escribir B3/B4 | B3, B4 | ⭐⭐⭐ | M 🚩 |
| **P3** | **El eliminado.** Para quien cae pronto es **media noche** y hoy no hay nada. Mesa sin banda, su puesto, stickers | B2 | ⭐⭐⭐ | M |
| **P4** | Pausa, descanso y **«última mano antes del break»** — que es información táctica | B5 | ⭐⭐ | S-M |
| **P5** | **Historial de mano.** Lo que más se discute en una mesa de amigos. El botón ☰ ya está y no lleva a ningún sitio. **Se alimenta de X1** | D2 | ⭐⭐⭐ | M |

🚩 **P1, el punto delicado:** hay que dibujar la **invalidación**. Alguien sube y tu «Igualo 100» deja de
valer. Es el único sitio del producto donde un fallo le cuesta fichas a alguien, y la marca no puede
desaparecer en silencio.

| # | Situación | Impacto | Esf. |
|---|---|---|---|
| **S1** | **Volver a entrar a mitad de mano.** ¿Ves el estado actual (sí) o te reproducen lo perdido (no)? Si te tocaba, ¿cuánto queda? | ⭐⭐⭐ | S |
| **S3** | **Heads-up.** El anillo de nueve con dos personas es absurdo y las posiciones se invierten. Es el final de **todos** los torneos. Se resuelve en `table-layout.ts` | ⭐⭐⭐ | S-M 🚩 |
| **S4** | La mesa esperando gente antes de la primera mano | ⭐⭐ | S |
| **S5** | **Errores**: acción rechazada, sala llena, contraseña mal, conexión caída. Con pre-acciones el primero se vuelve frecuente | ⭐⭐ | S |
| **S6** | Rotación: bloquear en vertical o cartel de «gira el móvil» | ⭐ | S |

> **S2 (sin conexión) sale de la lista: ya existe.** `player-seat.tsx` pinta icono `WifiOff` y borde
> discontinuo. Solo queda decidir si merece más peso visual.

---

## 5 · Tests que hay que tocar

El repo tiene harness de frontend (A0 ✅) y estos tests van a notar el trabajo:

| Test | Qué le pasa |
|---|---|
| `action-bar.test.tsx` | V1 le mete un `<span class="lbl">` dentro del botón y el estado «confirmado» cambia el texto un instante. Las queries por texto se rompen |
| `table-events.test.ts` | X1 añade eventos nuevos al diff. Los casos existentes deben seguir pasando **sin tocarlos** — si hay que editarlos, es que X1 cambió semántica que no debía |
| `use-runout.test.ts` | V4 mete el revelado del showdown en la misma zona. Comprobar que no se pisan |
| `help-sheet.test.tsx` | V3 cambia el texto del gesto de pasar («en cualquier punto del tapete») |
| **`table-layout.test.ts`** | **Nuevo, y es el entregable de V2** |

---

## 6 · Decisiones abiertas

### G1 · Enseñar las cartas al retirarse — **SÍ** ✅

Cualquiera puede enseñar al foldear, no solo el ganador sin showdown. Entre amigos el farol contado es medio
juego.

**Consecuencias que hay que escribir:** amplía A6, cuyo check decía *«solo el ganador, solo su propia mano»*;
ahora es *cualquiera que haya foldeado, solo su propia mano, y solo hasta que se reparta la siguiente*.
Enseñar es **irreversible**: una vez públicas quedan en `lastResults`. La pantalla ya está diseñada (V3).

### G2 · Barajado — **gesto corto** ✅

**Decidido.** Ni nada ni un riffle realista: **la baraja se cuadra y da un golpe seco en la mesa, 340 ms**,
en el sitio del botón del dealer, justo antes del reparto.

Un riffle realista tarda 1–2 s y se ve treinta veces por noche: a la tercera estorba. Esto cuesta casi lo
mismo que nada y da el **latido de «mano nueva»** — el momento en que levantas la vista y sabes que empieza
otra.

**Ya implementado en el prototipo** (v16). Tres dorsos desalineados que se juntan (170 ms) y un golpe
(160 ms), y de ahí arranca el reparto.

**Nota para §3:** el golpe de la baraja y el toque de nudillos del `check` son **la misma familia de sonido**
—madera y carta, ataque seco, caída muy rápida—. Producir uno da el otro casi gratis; conviene hacerlos
juntos y diferenciarlos solo en el cuerpo grave.

### G3 · Zurdos — **aparcado** ✅

**Decidido: no hace falta ahora.**

Para el registro, por si vuelve: en el diseño actual **las cartas están centradas y la banda ocupa el ancho
completo**, así que no hay asimetría estructural que intercambiar. Solo quedarían dos detalles cosméticos —el
rótulo de la jugada anclado a la derecha y la inclinación de −11° al levantar las cartas, pensada para un
pulgar derecho—. **No bloquea el refactor.**

*(El orden de los botones —retirarse a la izquierda, subir a la derecha— **no** es cosa de manos: es la
convención de poner lo destructivo lejos de lo positivo. Ese no se toca.)*

---

## 7 · Orden recomendado

1. **X1.** Es lo único que toca backend, es barato, y desbloquea la línea de acción, tres sonidos y P5.
   Decidirlo antes que nada. *(Las tres decisiones de producto ya están cerradas.)*
2. **V1 (materia).** Máximo cambio de sensación, riesgo cero, y deja algo real que colocar en V2.
3. **V2 (el refactor)**, con su test de matriz de solapes, que es el entregable.
4. **X2 (botes laterales)** en paralelo: es backend, no compite por los mismos archivos, y es corrección.
5. **V3 (gestos)** y **§3 (sonidos)** en paralelo: uno es la mesa, el otro está aislado en `sound.ts`.
6. **V4 (movimiento)** y **V5 (turno y relojes)**.
7. **S3 (heads-up)** y **S1 (volver a entrar)**: salen en todas las partidas y cuestan poco.
8. **P1 (pre-acciones)**, y con ella C5 deja de estar bloqueada por no saber qué dibuja.
9. **P2** antes de escribir B3/B4. Después **P3**, **P5** y el resto de S.

---

## 8 · Resumen para el plan de cambios

Cuatro cosas, cuando toque escribirlo:

1. **Falta un item de `lastAction` en la vista (X1).** Bloquea la línea de acción y tres sonidos, incluido el
   de pasar. No está en ningún plan.
2. **Falta un item de botes laterales (X2).** No es cosmético: la vista sirve un bote único cuando puede haber
   tres.
3. **El refactor de §5.3 no es «la fase siguiente»: es la puerta** — pero cuesta menos de lo que decía, porque
   la medición y la evitación de solapes **ya están escritas** y son buenas. Es extraer y ampliar.
4. **A3 (sonido) no está terminado** aunque figure ✅.
