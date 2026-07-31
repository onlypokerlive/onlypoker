# Plan de implementación — apuestas, sonido y ayudas

Deriva de [`investigacion-mecanicas-ux.md`](investigacion-mecanicas-ux.md). Ese documento decide *qué*
queremos; este decide *en qué orden*, *qué archivo se toca* y *dónde está el peligro*.

**Alcance de esta fase.** Configuración de apuestas, ayudas al jugador, sonido/háptica, reglas de la casa,
configuración de mesa y entrada/salida de jugadores. **Fuera por decisión explícita:** el split de pantalla
(§1.1), la geometría del pulgar (§5.1), tablet/desktop (§5.5) y —por dependencia— las animaciones de
§4.1-4.4, porque casi todas exigen que `poker-table.tsx` deje de posicionar con `left/top` en % y pase a
`transform` (§5.3). Ese refactor es la fase siguiente y arrastra las animaciones consigo.

> Excepción deliberada: **A4 (all-in carta a carta)** es una animación pero no depende de la geometría —
> es secuenciación de revelado, no movimiento en la mesa. Entra en esta fase.

**Leyenda.** Impacto ⭐-⭐⭐⭐ · Esfuerzo **S** (un rato) / **M** (sesión larga) / **L** (varias) / **XL**
(replantear) · 🚩 vigilar · 🚩🚩 vigilar mucho.

---

## Estado

| Tanda | Hecho | Pendiente |
|---|---|---|
| **0** defectos | 0.1 ✅ · 0.2 ✅ · 0.3 ✅ | — |
| **0.5** concurrencia | — | 0.5.a · 0.5.b · 0.5.c · 0.5.d |
| **A** frontend | A0-A7 ✅ (todo) | — |
| **B** mesa y jugadores | B1 ✅ · B2 ✅ · B6 ✅ | B3 · B4 · B5 · B7 |
| **C** reglas de la casa | C0 ✅ · C1 ✅ · C2 ✅ · C3 ✅ · C4 ✅ | C5 · C6 |
| **D** plataforma | — | todo (fuera del alcance acordado) |

**19 de 29 items hasta el final de C.** Lo que queda son casi todos **L**: la tanda 0.5 entera, las cuatro
features de mesa que cambian el torneo en marcha (B3, B4, B5, B7) y las dos caras de C (C5 pre-acciones,
C6 run it twice). Cinco de esas seis dependen de 0.5.c.

Cada item está en su propio commit, con sus tests, en `feat/plan-tandas-a-b-c`.

---

## Tanda 0 — defectos, antes que features

Tres cosas que ya están mal. Van primero porque dos de ellas son **prerrequisito** de features que quieres.

### 0.1 · Stack en vivo — ✅ HECHO

`_build_view` servía `p["chips"]`, la copia persistida, que solo se reescribe en `_settle_hand`. El stack vivo
está en `state.stacks[i]`. Efecto colateral que también desaparece: el distintivo **All-in** no se encendía
nunca a tiempo, porque el frontend lo deriva de `chips === 0`.

Tres tests nuevos; los dos primeros fallan sin el arreglo (comprobado revirtiéndolo). `57 passed` (antes 54).

### 0.2 · El botón no rota bien cuando cambia el número de jugadores  `⭐⭐⭐ · S-M · 🚩`

- **Toca:** `backend/main.py` → `_start_hand`.
- **El defecto:** el orden de asientos de cada mano sale de `k = room["handNumber"] % len(eligible)`
  ([`main.py:409`](../backend/main.py:409)). Con el campo estable rota correctamente; en cuanto cambia
  `len(eligible)`, `k` salta a un sitio arbitrario.

  **Caracterización correcta** (una versión anterior de este plan describía mal el síntoma a partir de un
  escenario suelto): en cada cambio de tamaño del campo, el asiento que abre la mano **da un salto arbitrario
  en vez de avanzar uno** — puede saltarse jugadores o retroceder. Después vuelve a rotar bien hasta el
  siguiente cambio. La consecuencia es que **el reparto de ciegas deja de ser equitativo**. Campo ABCDE, se va
  C:

  ```
  sin bajas                 : A B C D E A B C D E     ✅
  C se va antes de la mano 3: A B C E A B D E A B     ← D se salta una ciega
  C se va antes de la mano 6: A B C D E A D E A B     ← A abre en la 5 y en la 8: tres manos
                                                        de diferencia en un campo de cuatro
  ```

  Pasa hoy, en cada torneo, cada vez que alguien se elimina.
- **Arreglo:** guardar el botón en la sala (id de jugador, no índice) y avanzarlo al siguiente elegible tras
  cada mano — la regla de botón móvil de siempre. El índice se recalcula contra el campo de *esta* mano.
- **Trampa:** heads-up las posiciones se invierten (el botón es la ciega pequeña) — ya está contemplado en
  `poker.initial_positions`, y el arreglo no puede romperlo.
- **Check:** test que juega 12 manos eliminando gente y afirma que (a) el asiento que abre siempre avanza al
  siguiente elegible y nunca retrocede, y (b) tras N manos la diferencia de ciegas pagadas entre dos jugadores
  presentes todo el rato no pasa de 1.
- **Por qué va antes que B3/B4:** ambas cambian el tamaño del campo a mitad de torneo, así que **exponen** este
  defecto mucho más a menudo. No es un bloqueo de implementación —se pueden escribir en paralelo— pero sí una
  puerta de corrección: no publiques B3/B4 con la rotación rota o parecerá que las rompiste tú.

### 0.3 · La mano que cierra el torneo no dice con qué se ganó  `⭐⭐ · S`

- **Toca:** `frontend/components/room-client.tsx` (línea ~177), `hand-results.tsx`.
- **Estado real:** el backend **sí** calcula el nombre de la jugada (`poker.evaluate_hand` → `handName` +
  `handCards`) y `hand-results.tsx` **sí** lo pinta. Pero solo aparece con `phase === "handover"`, y cuando el
  torneo termina `room-client.tsx` renderiza `TournamentResults` **en lugar de** `HandResults`. La mano
  decisiva —la única que de verdad se comenta— salta directa al podio sin enseñar nada.
- **Segundo hueco:** una mano ganada por foldeo no nombra jugada (correcto: nadie enseñó), pero tampoco dice
  *por qué* no la nombra. Debe leerse "ganó sin mostrar" en vez de un hueco.
- **Arreglo:** en `finished`, enseñar el desenlace de la última mano antes (o encima) del podio, y etiquetar
  el caso "sin showdown".
- **Check:** test de que `lastResults` sobrevive al cierre del torneo + revisión visual de las dos rutas
  (showdown y foldeo).

---

## Tanda 0.5 — cuatro conceptos que faltan (y atraviesan medio plan)

Salieron de una revisión externa del plan y son, con diferencia, lo más importante que se le había escapado.
Ninguno es una feature: son piezas que **B3, B4, B5, B7, C5 y D1 dan por supuestas**, y que ahora mismo no
existen. Escribirlas una vez es barato; descubrirlas seis veces por separado es la forma habitual de que un
proyecto se atasque.

El plan anterior situaba el riesgo en pokerkit. Estaba mal: **el motor casi no da problemas; la concurrencia
sí.** El lock protege la escritura, pero no protege la vigencia ni la unicidad de la intención del jugador.

### 0.5.a · Versión de turno (`turnId`)  `🚩🚩`

`/action` valida el actor y el `handNumber` ([`main.py:969`](../backend/main.py:969)). Eso impide que una
orden vieja caiga en **otra** mano — que era el agujero que cerramos en la auditoría anterior. **No** impide
que caiga dos veces en la **misma** mano: si el turno vuelve al mismo jugador (alguien subió y hay que
responder), un request duplicado por un doble toque o un reintento de red vuelve a ser legal y se aplica.

`save_room` con fencing tampoco ayuda ([`main.py:169`](../backend/main.py:169)): protege contra escribir con
un lease caducado, no contra aplicar una orden repetida sobre un estado recién leído.

**Lo que falta:** un contador de turno (o revisión de estado) que el cliente devuelve con la acción, y que el
servidor exige que coincida. **C5 (pre-acciones) lo necesita sí o sí** — guardar "Call 100" no basta, hay que
guardar *en qué turno* se marcó.

### 0.5.b · Claves de idempotencia  `🚩🚩`

El lock serializa dos `join_room` simultáneos, pero **los dos crean jugador y asiento**
([`main.py:879`](../backend/main.py:879)). Un reintento tras perder la respuesta te duplica en la mesa. El
mismo agujero llegará con recompras (te cobra dos) y con el consumo manual del time bank.

**Lo que falta:** una clave de idempotencia por operación mutante. Y para B3/B4 hace falta además una
**identidad estable dentro de la sala** — no la identidad global de D4, pero sí algo que distinga "vuelve a
entrar Marcos" de "entra un jugador nuevo llamado Marcos". Esa decisión **no puede posponerse hasta la tanda
D**.

### 0.5.c · Un único planificador *lazy*  `🚩🚩`

Aquí había un error de modelo mío. Escribí que con 6 jugadores hay ~5 lecturas por segundo *que hacen
avanzar la sala*. **Falso:** `GET /state` solo entra al lock si caduca el heartbeat (5 s), vence el shot clock
o toca auto-deal ([`main.py:900`](../backend/main.py:900)). Consecuencia directa: **una pre-acción guardada
podría tardar hasta 5 segundos en ejecutarse**, que es justo lo contrario de lo que persigue C5 ("la mayor
mejora de ritmo posible").

Y hay una segunda capa: el predicado exterior de `GET /state` decide *si* se coge el lock, y `_apply_timeouts`
decide *qué* se hace dentro. **Pausa (B5), time bank (B7), pre-acciones (C5) y salida diferida (B3) tienen que
tocar las dos.** Si solo se toca la de dentro y `actionDeadline` queda vencido mientras el banco sigue
corriendo, cada cliente intentará coger el lock **en cada poll** — de 5 lecturas por minuto a 5 por segundo, y
la sala se congestiona sola.

**Lo que falta:** un solo punto que responda "¿qué toca hacer ahora en esta sala?" (timeout, pre-acción,
salida pendiente, banco de tiempo, auto-deal), con su predicado exterior a juego. Cuatro features colgando de
cuatro ramas ad-hoc es la receta para que la quinta rompa las otras cuatro.

### 0.5.d · Atomicidad al sacar datos del blob  `🚩` → afina D1

D1 acertaba en el diagnóstico (los datos que crecen tienen que salir del blob de la sala) y se quedaba corto
en la solución: **"fuera del lock" no basta.** Guardar la sala y añadir la mano al historial en dos
operaciones separadas permite manos fantasma (historial sin sala) o historial perdido (sala sin mano) si falla
la mitad. Hace falta un *outbox* o aceptar explícitamente la pérdida y decirlo.

### Corrección de una trampa que había escrito mal

En B3 dije que al jugador que se va "se le foldea, que el shot clock ya sabe hacerlo". **No es verdad:**
`_apply_timeouts` hace *check* cuando checkear es gratis y solo foldea de cara a una apuesta
([`main.py:546`](../backend/main.py:546)) — que es el comportamiento correcto para un ausente, pero significa
que quien se va se quedaría pasando manos en vez de saliendo. La salida diferida necesita su propio auto-fold.

---

## Tanda A — frontend puro, no toca el motor

| # | Feature | §doc | Impacto | Esfuerzo | 🚩 |
|---|---|---|---|---|---|
| **A0** | Harness de test de frontend (Vitest + Testing Library) | — | habilitador | S | |
| **A1** | Presets de apuesta + **botones +/−** + importe en BBs + snap | 2.1 | ⭐⭐⭐ | S-M | |
| **A2** | "Le toca a **{nombre}**" en vez de "Waiting for other players" | — | ⭐⭐ | S | |
| **A3** | Sonido + háptica, con interruptor visible en la mesa | 4.6 | ⭐⭐⭐ | S-M | 🚩 |
| **A4** | **All-in: las cartas salen una a una** | 4.4 | ⭐⭐⭐ | M | 🚩 |
| **A5** | Rabbit hunt | 3.D | ⭐⭐⭐ | S-M | |
| **A6** | Enseñar cartas al ganar sin showdown (Show 1 / Show 2 / ambas) | 2.3 | ⭐⭐ | S-M | |
| **A7** | Botón de ayuda `?` permanente | 7 | ⭐⭐ | S | |

#### A0 · Harness de test de frontend  `habilitador · S`
- **Toca:** `frontend/package.json`, `vitest.config.ts` nuevo.
- **Por qué primero:** el backend tiene 57 tests; el frontend tiene **cero** — solo `tsc` y `next build`. Y los
  dos items siguientes son frontend puro, con el sizing de apuestas siendo aritmética que tiene que ser
  exacta: un preset "1/2 bote" mal calculado manda fichas de más al centro. El playbook del AI-OS pone
  verificación por delante de features; aquí no es dogma, es que A1 no se puede firmar sin esto.
- **Alcance mínimo:** Vitest + Testing Library + `pnpm test` cableado. Nada de e2e todavía.

#### A1 · Presets de apuesta, +/− y BBs  `⭐⭐⭐ · S-M`
- **Toca:** `frontend/components/action-bar.tsx`. Sin backend: todo viaja ya en la vista.
- **Qué:** fila de presets sobre los tres botones grandes. Preflop `2x · 2.5x · 3x · All-in` (múltiplos de BB),
  postflop `1/3 · 1/2 · 3/4 · Pot`. **Botones `+` / `−`** con paso de 1 BB (y pulsación mantenida para ir
  rápido). El importe se muestra en fichas **y** en BBs (`Raise to 1.200 · 12 BB`). El slider se queda debajo
  con snap magnético a los presets.
- **El único cálculo con miga:**
  ```
  boteSiPago = view.pot + Σ(players[].bet) + legal.callAmount
  ```
  `view.pot` **excluye a propósito** las apuestas que aún están en el fieltro (ver `poker.pot_total`), así que
  sumarlas es obligatorio o todos los presets postflop salen cortos.
- **Trampa:** clamp al rango legal antes de enviar — `action-bar.tsx` ya tiene ese `clamp`, hay que reusarlo,
  no escribir otro. Un preset que cae fuera de `[minRaise, maxRaise]` se **oculta**, no se muestra apagado.
- **Check:** tests unitarios de la función de sizing. Casos jugosos: short-stack (el preset excede el stack →
  se convierte en all-in), bote 0 preflop, y `maxRaise <= minRaise` (solo all-in posible, que hoy ya tiene su
  rama).

#### A2 · "Le toca a {nombre}"  `⭐⭐ · S`
- **Toca:** `frontend/components/action-bar.tsx` línea ~35.
- **Qué:** hoy dice `"Waiting for other players..."`. Con `view.actorId` y `view.players` se resuelve el
  nombre: *"Le toca a Marcos"*. Con el shot clock activo, añadir los segundos que le quedan.
- **Trampa:** `actorId` es `null` en `handover` y entre calles — ahí el texto tiene que ser otro
  ("Repartiendo…"), no "Le toca a undefined".
- **Check:** test de render con `actorId` puesto, `null`, y apuntando a ti mismo.

#### A3 · Sonido y háptica  `⭐⭐⭐ · S-M · 🚩`
- **Toca:** `frontend/lib/use-table-events.ts` (nuevo), `room-client.tsx`, `poker-table.tsx`.
- **La decisión de diseño:** **no hay bus de eventos** — el transporte es polling de un snapshot. El cliente
  tiene que **derivar los eventos diffeando vistas consecutivas**: `handNumber` cambió → reparto;
  `board.length` creció → calle nueva; `actorId` pasó a ser yo → mi turno; `pot` creció → fichas.
- **Cuatro trampas, todas conocidas de antemano:**
  1. **iOS exige un gesto de usuario** para desbloquear el `AudioContext`. Desbloquearlo en el primer tap
     (entrar a la sala sirve) o no suena nada y parece que el interruptor está roto.
  2. **`navigator.vibrate` no existe en Safari iOS.** Degradar en silencio, nunca romper.
  3. **El primer render no debe sonar.** Entrar a mitad de mano dispararía todos los sonidos a la vez: la
     primera vista fija la línea base y no emite.
  4. **El interruptor va visible en la mesa**, no enterrado en ajustes (§4.6: se juega en el sofá con gente
     delante).
- **Check:** tests del hook con pares de vistas sintéticas — incluido el caso "primera vista no emite nada".

#### A4 · All-in: las cartas salen una a una  `⭐⭐⭐ · M · 🚩`
- **Toca:** `frontend/components/room-client.tsx`, `poker-table.tsx`, `hand-results.tsx`.
- **Cómo se comporta hoy:** cuando todos están all-in, pokerkit reparte el resto del board **de golpe** y
  liquida. Un solo request devuelve `phase: handover`, board de 5 cartas y resultados. El jugador ve el
  desenlace entero en un fotograma: es exactamente el momento con más tensión de la noche y ahora mismo no
  existe.
- **Enfoque recomendado — revelado por pasos en cliente:** detectar "el board saltó ≥2 cartas y la mano
  terminó" y revelar calle por calle con temporizador. **Servidor sin tocar**, que es lo que lo hace barato.
- **Trampa 🚩 (la importante):** hay que **retener `HandResults`** hasta que acabe el revelado, o el panel de
  resultados canta el ganador mientras el turn todavía no ha salido. Y el auto-deal sigue corriendo en el
  servidor (`autoDealAt`, 8 s por defecto): si el revelado dura más, la mano siguiente se reparte encima. O el
  revelado cabe dentro de `autoDealSeconds`, o hay que ampliar la ventana cuando hubo run-out.
- **Trampa menor:** quien entra a mitad del revelado lo ve entero de golpe. Aceptable — no vale complicar el
  servidor por esto.
- **Check:** test del hook de revelado (board 0→5 en un paso produce la secuencia flop/turn/river con sus
  tiempos) + afirmación de que los resultados no se publican antes del último paso.

#### A5 · Rabbit hunt  `⭐⭐⭐ · S-M`
- **Toca:** `backend/main.py` (endpoint de solo lectura), `backend/poker.py`, `hand-results.tsx`.
- **Más barato de lo que parece:** la baraja restante viaja en el estado que ya serializamos. Comprobado —
  tras una mano cerrada en preflop quedan 46 cartas accesibles y en orden en `state.deck_cards`.
- **El detalle que hay que acertar:** pokerkit **quema una carta antes de cada calle** (`CARD_BURNING` está
  automatizado). El flop "que habría salido" no son las tres primeras de `deck_cards`, son las tres siguientes
  a la quema. Si no se replica, el rabbit hunt enseña un flop falso — y esta feature solo vale si es fiel.
- **Trampa:** es lectura pura. No debe tocar `stateB64`, ni el resultado, ni el settle.
- **Check:** test que juega una mano hasta el flop, la cierra por foldeo, y afirma que las cartas del rabbit
  hunt coinciden con las que habría repartido el motor si la mano hubiera seguido.

#### A6 · Enseñar cartas al ganar sin showdown  `⭐⭐ · S-M`
- **Toca:** `backend/main.py` (`_settle_hand`, endpoint nuevo), `hand-results.tsx`.
- **Qué:** botones "Show 1 / Show 2 / ambas" durante el `handover` para quien ganó sin llegar a showdown.
- **Trampa:** solo el ganador, solo su propia mano, y solo hasta que se reparta la siguiente. Enseñar cartas
  es irreversible: una vez públicas se quedan en `lastResults`.
- **Dependencia:** **es prerrequisito de C1 (72o)**, porque §7 decidió que el 72o cuenta *también ganando por
  fold* — y cobrarlo obliga a poder enseñar el 7-2. Por eso un item de puro sabor está en la tanda A.

#### A7 · Botón de ayuda `?`  `⭐⭐ · S`
- **Toca:** `room-client.tsx` (cabecera).
- §7 ya decidió: **sin onboarding**, un `?` fijo que abre la chuleta. Cero fricción en la primera partida.

---

## Tanda B — mesa y jugadores (backend acotado)

| # | Feature | §doc | Impacto | Esfuerzo | 🚩 |
|---|---|---|---|---|---|
| **B1** | Plantillas de estructura de ciegas (Turbo / Normal / Lenta) | 3.B | ⭐⭐⭐ | S | |
| **B2** | **Modo espectador** | 3.E | ⭐⭐⭐ | S-M | |
| **B3** | **Entrar y salir del torneo empezado** (lo configura el host) | 3.E | ⭐⭐⭐ | L | 🚩🚩 |
| **B4** | **Recompras + add-on + ventana de recompra** | 3.A | ⭐⭐⭐ | L | 🚩🚩 |
| **B5** | Pausa del host, break cada N niveles, "última mano" | 3.B | ⭐⭐⭐ | L | 🚩 |
| **B6** | Expulsar jugador (kick) + panel de host | 3.E | ⭐⭐⭐ | S-M | |
| **B7** | Time bank | 2.4 | ⭐⭐ | L | 🚩 |

#### B1 · Plantillas de ciegas  `⭐⭐⭐ · S`
- **Toca:** `backend/main.py` (`build_blind_schedule`, `CreateRoomBody`), `create-room-form.tsx`.
- Hoy `BLIND_MULTIPLIERS` es una escalera fija multiplicada por las ciegas iniciales. Una plantilla es elegir
  minutos por nivel + opcionalmente otra escalera. Barato. El **editor de estructura personalizada** (tabla
  editable) es otra cosa: déjalo para después.

#### B2 · Modo espectador  `⭐⭐⭐ · S-M`
- **Toca:** `backend/main.py` (endpoint `watch` nuevo), `frontend/app/join/[roomId]/page.tsx`, `room-client.tsx`.
- **Sale barato porque la redacción ya es correcta por defecto.** `_build_view` revela cartas con
  `reveal = (pid == viewer_id) or (showdown y no foldeó)`: un id que no se sienta en ningún asiento no coincide
  con nadie y **no ve ninguna carta privada**. Y `you` ya es `None` cuando el espectador no está en la sala,
  que es el caso que el frontend ya maneja con optional chaining en todas partes.
- **Qué falta:** un `POST /rooms/{id}/watch` que valide la contraseña (la mesa sigue siendo privada) y
  devuelva una sesión con id de espectador **sin** añadirlo a `room["players"]` ni a `room["order"]`.
- **Trampas:** (a) `_tick_under_lock` ya comprueba `playerId in room["players"]` antes de latir
  ([`main.py:924`](../backend/main.py:924)), así que un espectador no rompe el heartbeat; (b) el espectador
  **sí** hace avanzar los relojes con su polling, que es gratis y deseable; (c) no cuenta para `MAX_SEATS`;
  (d) ve las cartas **públicas** de un showdown, que es lo correcto — pero conviene decirlo en voz alta antes
  de que alguien lo descubra por su cuenta.
- **Trampa de UI encontrada en revisión 🚩:** el frontend no está tan preparado como parecía.
  [`room-client.tsx:253`](../frontend/components/room-client.tsx:253) usa `!you?.sittingOut`, que con
  `you = null` evalúa a **true** — el espectador vería el botón "Sit out next hand". Hay que auditar **todas**
  las condiciones con `you?.` bajo el supuesto `you === null`, no solo esa: el optional chaining evita el
  crash pero no da la respuesta correcta.
- **Bonus:** es el 80% del "modo TV / tablet central" del §3.E.

#### B3 · Entrar y salir del torneo empezado  `⭐⭐⭐ · L · 🚩🚩`
- **Toca:** `backend/main.py` (`join_room`, `_start_hand`, `_finish_tournament`), `create-room-form.tsx`,
  `CreateRoomBody`, test `test_table_locks_once_the_tournament_starts` (cambia de significado).
- **Es configuración del host, no una regla nuestra.** §7 ya fijó el principio —*todo lo que sea regla de la
  casa lo decide el host al crear la mesa, de antemano*— así que esto no se pregunta a mitad de partida ni
  trae un valor impuesto. Ajustes a añadir a la pantalla de creación:

  | Ajuste | Opciones | Defecto propuesto |
  |---|---|---|
  | Entrada tardía | No / Hasta el nivel N / Hasta el minuto M / Siempre | Hasta el nivel 4 |
  | Fichas del que entra | Stack inicial / Stack medio de la mesa | Stack inicial |
  | Salir del torneo | No / Sí, retirando su stack de la mesa | Sí |

  La pantalla de creación deja de ser un formulario y pasa a ser una pieza central del producto — el §7 ya lo
  anticipaba, esto lo confirma. Merece su propio diseño en cuanto acumule 3-4 bloques de ajustes.
- **Entrar — hoy:** `join_room` rechaza con 400 si `phase != "lobby"`. La parte mecánica es fácil: el jugador
  se añade a `room["order"]` y `_eligible_player_ids` lo recoge solo en el siguiente reparto. **No** se le
  puede meter en una mano en curso.
- **Salir — la parte que hay que pensar:** ¿qué pasa con sus fichas?
  - *Retirarlas de la mesa* (lo natural entre amigos: se va y su stack se va con él). Simple, pero si se va el
    líder el torneo se descompensa de golpe.
  - *Dejarlas y que las coman las ciegas* (lo que hacen las salas online). Más justo, pero deja un asiento
    fantasma pagando ciegas, que en una mesa de 4 amigos se nota mucho.

  Recomiendo la primera, con el jugador registrado en `bustOrder` en su posición actual — así aparece en el
  podio final en el puesto que le tocaba y no se convierte en un no-lugar. Es la que menos código toca y la
  que menos sorprende.
- **Trampas 🚩:** (a) rompe la invariante "fichas en juego = stack inicial × jugadores", que es lo que hace
  cuadrable el torneo — hay que sustituirla por una explícita y testeada; (b) cambia el tamaño del campo a
  mitad de torneo → **depende de 0.2**; (c) un jugador que entra con `phase == "finished"` no debe resucitar el
  torneo; (d) el que se va **estando en una mano** no puede desaparecer a media mano: se marca la salida como
  pendiente y se retira al cerrar. **Ojo, aquí me equivoqué antes:** el shot clock **no** sirve para sacarlo,
  porque `_apply_timeouts` hace *check* cuando checkear es gratis y solo foldea de cara a una apuesta
  ([`main.py:546`](../backend/main.py:546)) — el que se va se quedaría pasando manos. La salida diferida
  necesita su propio auto-fold, dentro del planificador de 0.5.c.
- **Depende de:** 0.5.b (idempotencia + identidad de sala) y 0.5.c (planificador). Sin lo primero, un reintento
  de red te sienta dos veces.
- **Check:** tests de (a) entra en el siguiente reparto y no en la mano en curso, (b) el total de fichas cuadra
  con la invariante nueva tras entradas y salidas, (c) fuera de la ventana se rechaza con mensaje legible,
  (d) salir a media mano no rompe la mano, (e) salir el penúltimo cierra el torneo correctamente.

#### B4 · Recompras + add-on  `⭐⭐⭐ · L · 🚩🚩`
- **Toca:** `backend/main.py` (`_record_busts`, `_finish_tournament`, `_eligible_player_ids`, endpoint nuevo).
- Sumar fichas es la parte fácil. El torneo tiene hoy un ciclo de vida **cerrado** y una recompra lo abre:
  - `_record_busts` acumula `bustOrder` **en cuanto** alguien llega a 0, y ese orden produce los puestos
    finales. Quien recompra tiene que salir de esa lista.
  - `_finish_tournament` cierra la sala en cuanto queda menos de un jugador con fichas. Durante la ventana de
    recompra **no puede cerrarse**, o el torneo termina con gente que aún podía volver.
  - Caso borde real: dos jugadores se quedan a 0 en la misma mano, uno recompra y el otro no — el orden entre
    ellos ya se había fijado.
- **También lo configura el host** (§7 ya lo decidió): permitidas sí/no, cuántas por jugador, y hasta qué
  nivel. Va en el mismo bloque de la pantalla de creación que B3.
- **Comparte máquina de estados con B3.** Diséñalos juntos: ambos añaden y quitan fichas y jugadores de un
  torneo en marcha. Implementarlos por separado es escribir dos veces la misma invariante y que solo una esté
  testeada.
- **Check:** (a) recomprar borra el bust, (b) el torneo no se cierra con recompras abiertas, (c) cerrar la
  ventana con alguien a 0 lo elimina en ese momento, (d) el total de fichas cuadra.

#### B5 · Pausa, break y "última mano"  `⭐⭐⭐ · L · 🚩`
- **Toca:** `backend/main.py` (`_projected_level`, `_apply_level`, `_arm_auto_deal`).
- **La trampa está en que los relojes son *lazy*:** no hay worker en serverless, el nivel se **proyecta** desde
  `levelStartedAt` en cada request. **Pausar no es parar un contador**: es guardar el tiempo consumido y
  desplazar `levelStartedAt` al reanudar. Hecho mal, la pausa de la pizza sube tres niveles de golpe al volver.
- El host ya puede pausar el auto-deal (`autoDealPaused`); lo que falta es congelar **el reloj de ciegas**.
- **Check:** test que pausa 30 min de reloj falso y afirma que el nivel no se movió, y que al reanudar queda
  exactamente el tiempo que quedaba.

#### B6 · Kick + panel de host  `⭐⭐⭐ · S-M`
- Backend sencillo; el cuidado es social: confirmación, stack devuelto, y §4.3 ya decidió que va **sin juice**
  — un toast neutro, nunca un espectáculo.

#### B7 · Time bank  `⭐⭐ · L · 🚩`
- Misma trampa que B5: no se descuenta con un tick, se **calcula** al comprobar el vencimiento. Y
  `TIMEOUT_GRACE` ya existe: hay que decidir si el banco se apila encima o lo sustituye.

---

## Tanda C — reglas de la casa (tocan el motor)

| # | Feature | §doc | Impacto | Esfuerzo | 🚩 |
|---|---|---|---|---|---|
| **C0** | Posiciones explícitas en vez de deducidas | — | habilitador | S-M | 🚩 |
| **C1** | **72o** | 3.D | ⭐⭐⭐ | M | 🚩 |
| **C2** | **Bomb Pot** | 3.D | ⭐⭐⭐ | M | 🚩 |
| **C3** | **Straddle** | 3.C | ⭐⭐⭐ | M | 🚩 |
| **C4** | Ante / Big Blind Ante | 3.B | ⭐⭐ | S-M | 🚩 |
| **C5** | **Pre-acciones** (check/fold, call any) | 2.2 | ⭐⭐⭐ | L | 🚩🚩 |
| **C6** | Run It Twice | 3.D | ⭐⭐⭐ | L | 🚩 |

#### C0 · Posiciones explícitas  `habilitador · S-M · 🚩`
- **Toca:** `backend/poker.py` (`initial_positions`), `backend/main.py` (`_start_hand`, `_build_view`).
- `poker.initial_positions()` **deduce** SB / BB / botón ordenando las apuestas ya posteadas: "la apuesta más
  grande es la ciega grande". Con straddle esa premisa es falsa. Sondeo real con `(5, 10, 20)` a cuatro manos:

  ```
  initial_positions() -> {'sb': 0, 'bb': 2, 'button': 3}   # bb debería ser el asiento 1
  ```

  Llama ciega grande al straddler, y esas posiciones alimentan los distintivos SB/BB/D de todos los asientos:
  el error sale por pantalla en toda la mesa. Con bomb pot (todas las apuestas iguales) la deducción tampoco
  significa nada.
- **Arreglo:** dejar de deducir. `_start_hand` ya construye el orden de asientos y sabe quién es la SB por
  definición; las posiciones deben pasarse explícitas. Encaja con el arreglo de 0.2.
- **Riesgo:** toca algo que **hoy funciona en todas las manos**. Va con sus propios tests antes de colgarle
  C2 y C3 encima.

#### C1 · 72o  `⭐⭐⭐ · M · 🚩`
- Detectarlo es trivial (ya guardamos `handHoleCards`). El peligro está en la liquidación:
  - Es una **transferencia entre jugadores después** de que el motor reparta el bote. Puede dejar a alguien a
    0 → tiene que pasar por `_record_busts`, o queda alguien "vivo con 0 fichas".
  - ¿Y si un pagador no tiene las 2 BB? Hay que decidir la regla (paga lo que tiene) y escribirla.
- **Depende de A6**, por lo del cobro ganando por fold.

#### C2 · Bomb Pot — sale mucho más barato de lo que aparenta  `⭐⭐⭐ · M · 🚩`
El doc lo trata como la mecánica cara porque pokerkit no tiene "empezar en el flop". Hay una construcción
directa que funciona con el motor tal cual, **ya comprobada a cuatro manos**:

1. Crear la mano con **la misma "ciega" para todos** (`raw_blinds_or_straddles=(bomb,)*n`), que es exactamente
   el ante del bomb pot.
2. Como todas las apuestas quedan igualadas, nadie afronta nada: se pasa el preflop entero server-side dentro
   de `_start_hand`, **antes del primer `save_room`**.
3. El motor reparte el flop solo y la acción arranca ahí.

Resultado del sondeo: `pot 200`, board de 3 cartas, actor en el asiento 0. Ningún cliente llega a ver la ronda
preflop fantasma. **Baja de XL a M.** Depende de C0.

#### C3 · Straddle  `⭐⭐⭐ · M · 🚩`
Nativo en pokerkit (`raw_blinds_or_straddles=(sb, bb, straddle)`; comprobado que el actor arranca en el asiento
correcto). Todo el coste es C0.

#### C4 · Ante / BB Ante — el culpable es `ante_trimming_status`  `⭐⭐ · S-M · 🚩`
- **Toca:** `backend/poker.py` (`create_hand`), `CreateRoomBody`, `create-room-form.tsx`.
- **Corrección respecto a una versión anterior de este plan:** dije que `poker.pot_total()` se rompía con
  antes. **Es falso** y la revisión externa tenía razón. `pot_total` cuenta bien cualquier ficha salida del
  stack que no esté en el fieltro:

  ```
  ante uniforme 10 ×4, trimming=True  -> stacks [985,980,990,990]  pot_total 40   ✅
  BB-ante {1:10},      trimming=True  -> stacks [995,990,1000,1000] pot_total  0   ← el ante nunca se posteó
  BB-ante {1:10},      trimming=False -> stacks [995,980,1000,1000] pot_total 10   ✅
  ```

  El cero venía de que `create_hand` pasa **`ante_trimming_status=True`**
  ([`poker.py:41`](../backend/poker.py:41)), y con eso pokerkit **recorta a cero un ante unilateral** antes de
  postearlo. El ante nunca entró en juego; el bote estaba bien calculado.
- **Qué hacer entonces:** el Big Blind Ante necesita `ante_trimming_status=False`. Eso es un cambio de una
  línea, y por eso el item baja de M a S-M.
- **La trampa 🚩 que sí queda:** `ante_trimming_status` es **global de la mano**, no por jugador. Cambiarlo
  también altera qué pasa cuando un stack corto no cubre el ante entero — exactamente el caso que aparece al
  final de un torneo, que es cuando los antes importan. Antes de tocarlo: un test que cuadre el total de
  fichas con un jugador que no llega al ante.

#### C5 · Pre-acciones — el coste está en la concurrencia  `⭐⭐⭐ · L · 🚩🚩`
El doc las llama "la mayor mejora de ritmo posible" y tiene razón. Los checkboxes son media hora. Lo caro:
- Una pre-acción se ejecuta **en el poll de otra persona**, igual que hace hoy el shot clock. Ese patrón ya
  existe (`_apply_timeouts`): reusarlo, no inventar otro.
- Hay que guardar **bajo qué situación** se marcó ("Call 100") e invalidarla si cambia (alguien sube a 300).
  Sin esa invalidación, la pre-acción paga una cantidad que el jugador nunca aceptó. **Es el único sitio del
  sistema donde un bug le cuesta fichas reales a alguien.**
- `_apply_timeouts` hace deliberadamente **una sola** auto-acción por request. Con pre-acciones encadenadas
  (tres jugadores con "check") hay que decidir lo mismo y documentarlo, o un request se convierte en media mano
  y el lock se queda corto.
- Orden respecto al shot clock: si tengo pre-acción y se me acaba el tiempo, manda la pre-acción.

#### C6 · Run It Twice  `⭐⭐⭐ · L · 🚩`
El motor lo regala: existen `Automation.RUNOUT_COUNT_SELECTION`, `can_select_runout_count`,
`select_runout_count` y `starting_board_count` (que además da el doble board del §3.D). Lo caro es el resto:
- **Pedir el acuerdo** de los all-in dentro de una arquitectura de polling con lock — es un estado nuevo de la
  mano ("esperando acuerdo") con su propio reloj, o alguien se va al baño y bloquea la mesa.
- La vista y `hand-results.tsx` tienen que saber mostrar **dos boards y medio bote cada uno**.
- **Interactúa con A4:** el revelado carta a carta se vuelve dos revelados.

---

## Tanda D — plataforma (desbloquea lo social y lo post-partida)

| # | Feature | §doc | Impacto | Esfuerzo | 🚩 |
|---|---|---|---|---|---|
| **D1** | Sacar los datos acumulativos del blob de la sala | — | habilitador | M | 🚩🚩 |
| **D2** | Historial de manos + compartir mano | 3.F | ⭐⭐⭐ | M (tras D1) | |
| **D3** | PWA + notificación push "es tu turno" | 5.3/5.4 | ⭐⭐⭐ | L | 🚩 |
| **D4** | Identidad de grupo + ranking persistente | 3.F | ⭐⭐⭐ | L | 🚩 |
| **D5** | Chat / emotes / stickers de grupo | 4.5 | ⭐⭐⭐ | L-XL | 🚩 |
| **D6** | Polling → SSE | 5.3 | ⭐⭐ | XL | 🚩🚩 |

#### D1 · El blob de la sala es un límite de arquitectura  `🚩🚩`
Hoy **toda** la sala es un único JSON: cada request hace `load_room` (lee entero), muta y `save_room`
(reescribe entero, fenced contra el lock). Con 6 jugadores haciendo polling cada 1,2 s son ~5 lecturas por
segundo del documento completo — y el modo espectador (B2) **añade más lectores**.

Historial, chat, stickers y ranking son datos que **crecen sin techo**. Meterlos en ese blob hace que cada poll
de cada jugador arrastre toda la historia de la noche, y acaba chocando con el límite de tamaño de Upstash.
**La decisión hay que tomarla antes de escribir la primera feature de la sección F:** claves separadas y
append-only (`holdem:hands:{sala}:{n}`), fuera del lock de la sala. Barato ahora, caro migrarlo después.

**Matiz importante (ver 0.5.d): "fuera del lock" no basta.** Guardar la sala y añadir la mano al historial en
dos operaciones separadas permite manos fantasma o historial perdido si falla la mitad. Hace falta un outbox,
o aceptar la pérdida explícitamente y escribirlo.

> Nota sobre los límites concretos de Upstash y Vercel: **no los he comprobado**. El argumento es
> arquitectónico (un documento que crece sin techo leído N veces por segundo), no una cifra. Si alguien va a
> apostar una decisión a un número exacto, que lo mire antes.

#### D4 · Identidad de grupo  `🚩`
Hoy el `playerId` es por sala y vive en `localStorage`; no existe el concepto de persona entre sesiones. El
ranking persistente exige un modelo de "grupo/club" con identidad estable — es el item más grande del §3.F, y
del que cuelgan los stickers persistentes de la mesa.

---

## Dependencias

Dependencias **duras** (no se puede escribir lo de la derecha sin lo de la izquierda):

```
A0 harness ───────────────> A1, A2, A3, A4
A6 enseñar cartas ────────> C1 72o
A4 revelado ──────────────> C6 run it twice (son dos revelados)
C0 posiciones explícitas ─> C2 bomb pot, C3 straddle
0.5.a turnId ─────────────> C5 pre-acciones
0.5.b idempotencia ───────> B3 entrar/salir, B4 recompras, B7 time bank
0.5.c planificador lazy ──> B3 (salida diferida), B5 pausa, B7 time bank, C5 pre-acciones
0.5.d atomicidad ─────────> D1, y por tanto D2 historial, D4 ranking, D5 stickers
D4 identidad global ──────> D5 stickers persistentes
```

Dependencias **blandas** (puerta de calidad, no de compilación):

```
0.2 botón ───> B3, B4    exponen el defecto mucho más; arréglalo antes de publicarlas
0.2 botón ───> C0        diseña los dos juntos o migrarás la representación del botón dos veces
```

**Corrección respecto a la versión anterior:** decía que **B2 (espectadores) dependía de 0.2**. No es cierto —
un espectador no toca `players`, ni `order`, ni `eligible`, así que no roza la rotación. B2 se puede hacer
cuando se quiera.

## Orden de arranque recomendado

1. **0.2** (botón) y **0.3** (jugada ganadora al cerrar el torneo). Defectos con síntoma visible en cada
   partida, ambos pequeños.
2. **A0 → A1 → A2** — el harness y lo que más se nota en la mesa el viernes, con checks ejecutables detrás.
3. **A3, A4** — sonido y el all-in carta a carta: el mayor salto de sensación por esfuerzo invertido.
4. **B2** (espectadores) — barato e independiente, y descubre de paso si el modelo de "viewer sin asiento"
   aguanta en la UI (ya sabemos que hay al menos un `you?.` que responde mal).
5. **0.5 entera, antes de tocar B3/B4/B5/B7/C5.** Es la que más ahorra: cuatro features la dan por supuesta.
   Si hay que elegir una sola, es **0.5.c (el planificador)**, porque sin ella C5 no cumple lo que promete y
   además puede congestionar la sala.
6. **B3 + B4 juntas** (entrar/salir y recompras) — misma invariante, un solo diseño, y un solo bloque nuevo en
   la pantalla de creación de mesa, que es donde el host decide todo esto.
7. **C0** y a partir de ahí las reglas de la casa.

**D1 no espera su turno:** en cuanto aparezca la primera feature que acumule datos (historial, chat,
stickers), hay que hacerla antes — con la atomicidad de 0.5.d resuelta, no solo "fuera del lock". No es una
feature de la tanda D, es el permiso para escribirlas.
