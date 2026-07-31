# Investigación: mecánicas y UX/UI de apps de poker

Referencias analizadas: **Pokerrrr 2** (home games), **PokerStars** y **Winamax** (regulados, top en pulido),
**GGPoker**, **PokerBros / Upoker / PPPoker** (clubes privados), **The Lodge / Hustler** (reglas de la casa presenciales).

Objetivo: extraer lo reciclable para una app de mesa entre amigos, y dejar una lista cerrada de
configuraciones y de animaciones para decidir alcance.

---

## 0. TL;DR — las 8 ideas que más valen

1. **El split de pantalla de Pokerrrr 2** (mesa arriba ~55-60%, "tu zona" abajo ~40%) es la decisión
   estructural correcta en móvil. No es estética: separa *información compartida* de *información privada y
   acción*, y libera el pulgar.
2. **Los gestos de Pokerrrr 2 son buenos como acelerador, malos como único camino.** Todos deben tener
   equivalente en botón. El gesto es para quien ya juega; el botón es para la primera partida.
3. **Los presets de apuesta (1/3, 1/2, 3/4, pot, all-in) valen más que el slider.** En móvil el slider es
   impreciso; el 90% de las apuestas caen en 4-5 tamaños. PokerStars deja configurar 4 atajos preflop
   (múltiplos de BB) y 4 postflop (% de bote) — ese es el patrón a copiar.
4. **Las pre-acciones (check/fold, call any, check) son la mayor mejora de ritmo posible.** Es lo que
   convierte una partida de 40 min en una de 25 sin que nadie sienta prisa.
5. **Las reglas de la casa (72o, bomb pot, straddle) son el diferencial de "entre amigos".** Nadie va a
   elegir nuestra app por el motor de poker; la van a elegir porque pueden jugar *su* partida.
6. **La capa de cultura de grupo (stickers y motes configurables por la mesa) es el diferencial real.**
   No podemos escribir nosotros la broma; podemos darles las herramientas para que se la hagan entre ellos.
7. **El juice se reparte al revés de la frecuencia.** Lo que pasa 200 veces por noche (ganar un bote,
   apostar) va sobrio y rápido. Lo que pasa 2 veces (eliminar a alguien, bad beat brutal, ganar el torneo)
   se lleva todo el presupuesto de espectáculo. Ver §4.0.
8. **Sonido y háptica hacen más que cualquier animación** en móvil. Un tick de háptica al ser tu turno vale
   más que un glow.

> **Restricción transversal:** todo esto se diseña **mobile-first, vertical, sin scroll y con una mano.**
> Ver §5 para las reglas duras — condicionan qué animaciones son viables y dónde puede vivir cada control.

---

## 1. Pokerrrr 2 — la anatomía que te gusta

### 1.1 El split de pantalla

Mirando la captura que pasaste, el reparto real es:

| Zona | % pantalla | Contenido | Regla |
|---|---|---|---|
| **Barra superior** | ~7% | Ciegas (`1.00/0.50`), nº de mano (`#23`), menú (☰), baraja/histórico | Densa, pequeña, nunca reclama atención |
| **Mesa (óvalo)** | ~40% | Asientos, stacks, apuestas en el fieltro, bote, cartas comunitarias, botón dealer | Solo información *compartida* |
| **Zona muerta / fieltro** | ~10% | Espacio verde entre mesa y rail | Existe a propósito: es el "aire" que hace que la mesa se lea como objeto |
| **Rail + tus cartas** | ~35% | Tus dos cartas grandes en perspectiva, saliendo del rail dorado | Solo información *privada* |
| **Acciones** | superpuesto | El botón CALL verde vive *en la mesa*, junto a tu asiento | Ver 1.3 |

**La clave que hay que entender:** las cartas propias en Pokerrrr 2 son **enormes** — ocupan un tercio de la
pantalla. En PokerStars ocupan un 5%. Eso no es un error de escala: es la traducción de "mirar tus cartas" a
móvil. Tus cartas no son un dato, son *un momento*.

Además el rail dorado con el botón circular a la izquierda hace de **frontera física** entre lo público y lo
privado. Visualmente comunica "de aquí para abajo, esto es mío".

### 1.2 Los cuatro gestos

Confirmados por la documentación de la app:

| Gesto | Acción | Metáfora física |
|---|---|---|
| **Arrastrar el borde inferior de las cartas hacia arriba, y mantener** | Ver tus cartas | Levantar la esquina de la carta con el pulgar. Al soltar, las cartas caen de vuelta al fieltro |
| **Doble tap sobre las cartas** | Check | Golpear la mesa con los nudillos |
| **Presionar las cartas y arrastrar hacia arriba (hacia el centro de la mesa)** | Fold | Empujar las cartas al muck |
| **Flip del "Chip-Con" (el dial de fichas) hacia arriba** | Apostar | Empujar fichas al centro |

**Por qué funcionan:** cada gesto es la digitalización literal de un movimiento de mesa real. No hay que
aprenderlos, hay que *reconocerlos*. Es la razón por la que un jugador de poker en vivo entiende Pokerrrr 2
en 2 manos.

**Dónde fallan (y hay que corregir):**

- **Fold por arrastre es peligroso.** El gesto es corto y va en la dirección natural del scroll. Necesita
  (a) umbral de distancia alto (>25% de la altura de la carta), (b) *point of no return* visible —las cartas
  se ponen grises/se inclinan al pasar el umbral—, y (c) rebote elástico si sueltas antes.
- **Doble tap para check compite con el peek.** Si el peek es "press-and-hold" y el check es "double tap", un
  tap rápido queda ambiguo. Hay que decidir: o el peek es *drag* (no tap), o el check se mueve a otro sitio.
- **Ningún gesto es descubrible.** Necesita un onboarding de 3 pantallas o coach marks en la primera mano.

### 1.3 El botón de acción flotante

Detalle a copiar: en la captura, el botón **CALL** verde no está en una barra inferior — está **pegado al
asiento del jugador que ha actuado**, sobre la mesa. Es una etiqueta de estado ("este jugador ha pagado"),
no un botón.

Y el jugador en turno (Dreu Dale Johnson) tiene:
- Borde cian brillante alrededor del asiento
- Marcador rojo de aviso (`❗`) sobre el asiento
- Contador de tiempo visible en otro asiento (`Meia — 02:52`) → time bank en marcha

**Sistema de estados de asiento que usan:** normal / en turno (glow + timer) / sit out (texto "Sit out") /
ha actuado (etiqueta de acción) / all-in / dealer (botón D rojo).

### 1.4 Otras mecánicas de Pokerrrr 2

- **Modos:** Texas Hold'em, Omaha, Short Deck, OFC (Chinese), Blackjack.
- **Formatos:** Ring (cash), SNG "Ultrasonic", MTT, "Lucky Dip Tournament".
- **Big Screen Party Mode:** iPad en el centro de la mesa física haciendo de tablero compartido, cada
  jugador con su móvil como "mano". → **Esto es enorme para una app entre amigos presenciales.** Un modo
  "TV / tablet central" convierte la app en un juego de mesa real.
- **Opciones de mesa avanzadas:** Run It Twice, Rabbit Hunt, Double Board, 7-2 Game, Straddle, Time Bank.
- **Clubes:** espacios persistentes con miembros, administradores de mesa, historial de manos guardado
  automáticamente.

---

## 2. Qué robar de PokerStars / Winamax / GGPoker

### 2.1 Ayudas de apuesta (lo más reciclable)

| Patrón | Quién lo hace | Cómo | Reciclable |
|---|---|---|---|
| **Atajos configurables** | PokerStars | 4 botones preflop (en múltiplos de BB: 2x, 2.5x, 3x, 4x) + 4 postflop (en % de bote: 33%, 50%, 75%, 100%). Configurables en Ajustes → Gameplay → Bet Slider | ⭐⭐⭐ Sí, pero **sin** configuración: elegir 4 buenos por defecto |
| **Slider vertical con snap** | Winamax / GG | Slider que se "engancha" a los presets, con número editable | ⭐⭐⭐ Sí — snap magnético a los presets es lo que arregla la imprecisión del móvil |
| **Input numérico directo** | Todos | Tap sobre la cifra → teclado numérico | ⭐⭐ Sí, para el jugador que quiere un número raro |
| **+/- por incrementos de BB** | GG | Botones de paso fino | ⭐⭐ Útil en pantallas pequeñas |
| **Mostrar el tamaño en BBs además de fichas** | GG, Winamax | "Raise to 1.200 (12 BB)" | ⭐⭐⭐ Barato y muy apreciado |

**Recomendación concreta para nuestra ActionBar:** fila de chips-preset encima de los tres botones grandes.
Preflop: `2x · 2.5x · 3x · All-in`. Postflop: `1/3 · 1/2 · 3/4 · Pot`. El slider se queda debajo, con snap.

### 2.2 Pre-acciones (fuera de turno)

Todas las salas grandes lo tienen. Es lo que más acelera la partida.

- Cuando **no hay apuesta pendiente**: `Check` / `Check o Fold`
- Cuando **sí la hay**: `Fold` / `Call {cantidad}` / `Call Any`
- Se muestran como *checkboxes*, no botones — visualmente distintos de los botones de acción para que nadie
  los confunda.
- Se **cancelan automáticamente** si la situación cambia (alguien sube después de que marcaste "Call 100").
  Esta es la parte que hay que implementar con cuidado.

### 2.3 Automatismos de comodidad

| Ajuste | Qué hace | Nota |
|---|---|---|
| **Auto-muck** | Descarta tu mano perdedora en showdown sin enseñarla | Debe ser opcional: hay quien quiere enseñar el farol |
| **Show winning hand** | Enseña automáticamente cuando ganas sin showdown | En mesa de amigos, *lo contrario* también mola: botón "Show 1 / Show 2 / Show both" |
| **Auto rebuy / auto top-up** | Recompra al llegar a X fichas | Clave en cash game |
| **Sit out next hand / Sit out next BB** | Salir sin abandonar el asiento | Imprescindible: en casa la gente se levanta |
| **Auto post blind** | No preguntar cada mano | Sí, por defecto |

### 2.4 Reloj: shot clock vs time bank

- **Shot clock**: X segundos por decisión (lo que ya tenemos).
- **Time bank**: un depósito adicional (ej. 30s) que se consume solo cuando se agota el shot clock, y se
  recarga lentamente o por nivel. En la captura de Pokerrrr 2 se ve un jugador con `02:52` → banco grande.
- **Time bank cards** (GGPoker): fichas de tiempo consumibles. Controvertido porque GG las vende. En una app
  de amigos, darlas gratis (ej. 3 por sesión) es un buen sistema: presiona sin castigar.

**Recomendación:** shot clock corto (15-20s) + time bank de 30-60s por sesión. Mucho mejor que un shot clock
largo, porque acelera las decisiones fáciles sin ahogar las difíciles.

### 2.5 Personalidad — lo que hace Winamax bien

Winamax es el referente europeo en *carácter* más que en funcionalidad: paleta roja agresiva, tipografía con
peso, avatares con personalidad, y una identidad de marca que no parece un casino genérico. La lección para
nosotros no es copiar su UI sino su principio: **una mesa de poker digital puede tener una voz**, y la
mayoría (PokerStars incluida) tienen la de un banco.

De GGPoker lo reciclable es lo social: **emotes/animaciones lanzables a otros jugadores**, avatares animados,
y la posibilidad de reaccionar a una mano. En una mesa de amigos eso es *el producto*, no un extra.

---

## 3. Catálogo de configuraciones

Marcadas con prioridad para una mesa entre amigos: ⭐⭐⭐ imprescindible · ⭐⭐ diferencial · ⭐ nicho.

### A. Formato y economía

| Ajuste | Qué hace | Por qué importa en casa | Prio |
|---|---|---|---|
| **Cash game vs Torneo** | Fichas = dinero constante, entras/sales cuando quieres · vs · estructura con eliminación | Decisión estructural nº1. Lo que tenemos ahora es un híbrido (stack fijo + ciegas subiendo) | ⭐⭐⭐ |
| **Buy-in mín/máx** | Rango de compra en cash (ej. 50-200 BB) | Evita que uno se siente con 10 BB y juegue a la ruleta | ⭐⭐⭐ |
| **Recompra (rebuy)** | Volver a comprar tras perder. Configurable: ilimitada / N veces / hasta el nivel X | **Lo pediste explícitamente.** En casa casi siempre es ilimitada durante la primera hora | ⭐⭐⭐ |
| **Add-on** | Compra extra única, normalmente al final del periodo de rebuy, a mejor precio | Clásico de torneo casero | ⭐⭐ |
| **Auto top-up** | Recomprar automáticamente hasta el buy-in inicial | Quita fricción en cash | ⭐⭐ |
| **Periodo de rebuy** | "Rebuy permitido hasta el nivel 4 / los primeros 60 min" | Sin esto el torneo no termina nunca | ⭐⭐⭐ |
| **Bounty / KO** | Parte del buy-in va como recompensa por eliminar a alguien | Muy divertido en grupo | ⭐⭐ |
| **Progressive KO** | La recompensa crece al acumular eliminaciones | Variante del anterior | ⭐ |
| **Rake** | Comisión de la casa | **Cero.** En mesa de amigos el rake es antifeature | — |

### B. Estructura de ciegas y tiempo

| Ajuste | Qué hace | Prio |
|---|---|---|
| **SB / BB iniciales** | Ya lo tenemos | ⭐⭐⭐ |
| **Duración de nivel** | Minutos por nivel. Ya lo tenemos | ⭐⭐⭐ |
| **Estructura de ciegas** | Plantillas: Turbo (5 min) / Normal (15) / Lenta (25) / Personalizada con tabla editable | ⭐⭐⭐ |
| **Ante** | Todos pagan cada mano. Aumenta el bote muerto | ⭐⭐ |
| **Big Blind Ante** | Solo la ciega grande paga el ante de toda la mesa. Estándar moderno, mucho más rápido | ⭐⭐⭐ |
| **Button Ante** | Igual pero lo paga el botón | ⭐ |
| **Shot clock** | Segundos por decisión. Ya lo tenemos | ⭐⭐⭐ |
| **Time bank** | Depósito extra de tiempo, ver 2.4 | ⭐⭐ |
| **Pausa** | Break automático cada N niveles + pausa manual del host | ⭐⭐⭐ En casa se pide pizza |
| **Nivel de parada / "última mano"** | El host anuncia "jugamos hasta las 12" y la app avisa | ⭐⭐ |

### C. Reglas de acción en mesa

| Ajuste | Qué hace | Prio |
|---|---|---|
| **Straddle** | La UTG pone 2x BB a ciegas y actúa la última preflop. Variantes: opcional / obligatorio / Mississippi (desde el botón) | ⭐⭐⭐ |
| **Doble straddle / re-straddle** | Encadenar straddles | ⭐ |
| **Límite de apuesta** | No Limit / Pot Limit / Fixed Limit | ⭐⭐ (PLO necesita Pot Limit) |
| **Sit out permitido** | Si puedes pasar manos sentado | ⭐⭐⭐ |
| **All-in solo con showdown** | Si al ir all-in con calls, las cartas se giran ya | ⭐⭐⭐ Estándar |
| **Cartas a la vista al foldear** | Permitir enseñar tras retirarse ("Show one") | ⭐⭐ Es puro sabor de casa |
| **Chat en mesa / Emotes** | | ⭐⭐⭐ |

### D. Reglas de la casa y gamificación

Este es el bloque diferencial. Es lo que hace que la partida sea *vuestra*.

| Regla | Cómo funciona | Prio |
|---|---|---|
| **7-2 Game (72o)** | Quien gane un bote con **7-2 offsuit** cobra un bonus de cada jugador (ej. 2 BB cada uno). Sub-decisiones: ¿solo si va a showdown, o también ganando por fold? La versión estándar y más divertida es **también por fold** (premia el farol). Requiere que la app pida enseñar las cartas | ⭐⭐⭐ Lo pediste |
| **Bomb Pot** | Cada N manos (o cuando lo lanza el host): nadie recibe acción preflop, todos ponen un ante fijo (ej. 5 BB) y **se reparte el flop directamente**. La acción empieza en el flop | ⭐⭐⭐ Es la mecánica de moda |
| **Double Board Bomb Pot** | El bomb pot se juega con **dos flops/turns/rivers**. Ganas medio bote por tablero; scoop si ganas los dos | ⭐⭐ Muy vistoso, gran animación |
| **Run It Twice** | En all-in, las cartas restantes se reparten dos veces; cada mitad se lleva medio bote. Reduce varianza | ⭐⭐⭐ |
| **Run It Three Times** | Igual con tres | ⭐ |
| **Rabbit Hunt** | Tras el fin de la mano, enseñar las cartas que *habrían* salido. Puro placebo emocional y muy adictivo | ⭐⭐⭐ Barato de implementar, alto retorno |
| **Insurance** | Comprar seguro contra un bad beat estando all-in | ⭐ Complejo, poco valor en casa |
| **Jackpot / Bad Beat** | Bote acumulado para manos monstruosas perdedoras | ⭐ |
| **"Splash the pot"** | El host mete fichas extra al bote aleatoriamente | ⭐ Divertido, trivial |
| **Mano obligatoria / "Dealer's choice"** | El dealer elige la variante de la mano | ⭐ |
| **Chop / Reparto** | Acuerdo de reparto del premio al final del torneo (ICM o proporcional) | ⭐⭐ Toda mesa casera termina con "vamos a repartir" |

### E. Social, moderación y sesión

| Ajuste | Qué hace | Prio |
|---|---|---|
| **Sala con password / link de invitación** | Ya lo tenemos | ⭐⭐⭐ |
| **Host / admin** | Quién puede pausar, expulsar, ajustar stacks, forzar bomb pot | ⭐⭐⭐ |
| **Expulsar jugador (kick)** | Con confirmación y stack devuelto | ⭐⭐⭐ **Pediste animación para esto** |
| **Lista de espera** | Cola cuando la mesa está llena | ⭐⭐ |
| **Reserva de asiento / elegir sitio** | Elegir dónde te sientas | ⭐⭐ En casa mola sentarse al lado de alguien |
| **Auto-kick por inactividad** | Tras N manos en sit out | ⭐⭐ |
| **Reconexión** | Guardar sesión si se cierra el navegador. Mano se juega sola (check/fold) | ⭐⭐⭐ Crítico en móvil |
| **Espectadores** | Ver sin jugar | ⭐ |
| **Vista TV / tablet central** | Modo "Big Screen Party" de Pokerrrr 2 | ⭐⭐ Alto potencial si jugáis presencialmente |

### F. Post-partida (lo que nadie hace bien)

| Feature | Qué hace | Prio |
|---|---|---|
| **Historial de manos** | Revisar manos jugadas, con las cartas de todos reveladas al terminar la sesión | ⭐⭐⭐ |
| **Compartir mano** | Exportar una mano como imagen/link para el grupo de WhatsApp | ⭐⭐⭐ Es marketing gratis |
| **Premios de sesión** | "Mayor bote", "Más faroles", "Bad beat de la noche", "Rey del 72". Enganchan con los stickers del grupo (§4.5) | ⭐⭐⭐ Es lo que se comenta al día siguiente |
| **Estadísticas de sesión** | VPIP, manos ganadas, mayor bote, mayor farol descubierto | ⭐⭐ |
| **Ranking persistente del grupo** | Acumulado de puestos entre sesiones. Sin dinero, este ES el marcador que importa | ⭐⭐⭐ |
| ~~Ledger / cuadre de cuentas~~ | ~~Quién le debe cuánto a quién en euros~~ | ❌ **Descartado:** solo fichas, sin dinero real |

---

## 4. Animaciones y efectos — catálogo con timings

Principio: **la animación existe para explicar un cambio de estado, no para decorar.** Si dura más de lo que
tarda el ojo en entender qué cambió, molesta a partir de la mano 20.

### 4.0 La curva de juice — regla de reparto

**El presupuesto de espectáculo es inversamente proporcional a la frecuencia del evento.** Esta es la regla
que decide todo lo demás:

| Frecuencia | Ejemplos | Presupuesto | Duración máxima |
|---|---|---|---|
| **Cada mano, varias veces** | Apostar, foldear, pasar turno | Casi nulo — solo lo justo para que se lea el cambio | 150-250ms |
| **Cada mano, una vez** | Reparto, recoger bote, ganar un bote normal | Bajo. Fluido pero invisible: no debe pedir atención | 250-400ms |
| **Cada 10-20 manos** | All-in, showdown reñido, subida de ciegas, bomb pot | Medio. Aquí sí se pausa el ritmo un instante | 600-900ms |
| **1-3 veces por noche** | Eliminación, bad beat brutal, ganar el torneo, ganar con 72o | **Todo el presupuesto.** Es donde se busca el "wow" | 1,5-3s, interrumpible |

Corolarios que hay que respetar sin excepción:

- **Ganar un bote normal es un evento frecuente**, no un momento. Fichas al stack, número que sube, y ya.
  Nada de confeti por ganar 300 fichas en el flop — eso es exactamente lo que hace que la gente desactive
  las animaciones en la mano 15.
- **Todo lo del tramo alto tiene que ser saltable con un tap.** El wow deja de serlo la tercera vez que
  bloquea la partida.
- **Cuanto más raro el evento, más se permite romper las reglas**: pausar el juego, ocupar toda la pantalla,
  sonido fuerte. Solo porque es raro.

### 4.1 Las cuatro críticas

| Momento | Animación | Duración | Notas |
|---|---|---|---|
| **Reparto de cartas** | Cartas salen del centro/dealer hacia cada asiento, con stagger de ~60ms entre jugadores | 400-600ms total | Debe poder saltarse con un tap. Ease-out |
| **Apostar** | Ficha(s) vuelan del stack del jugador a su posición en el fieltro. Contador del stack baja animado | 250ms | El número bajando (`tabular-nums` + interpolación) hace la mitad del trabajo |
| **Recoger el bote** | Todas las apuestas del fieltro convergen al centro al cerrar la calle | 300ms | Momento clave: es lo que da sensación de "mesa real" |
| **Ganar el bote** | Fichas del bote vuelan al ganador + su stack sube animado + halo breve en el asiento | 350ms | ⚠️ Pasa cada mano: va **sobrio**. Sin confeti, sin pausa, sin sonido épico. El mimo aquí está en la fluidez, no en el volumen |

### 4.2 Tramo frecuente y medio — sobrio por obligación

Todo esto se ve decenas de veces por noche. La regla es que se entienda de reojo y no pida atención.

| Momento | Efecto | Duración |
|---|---|---|
| **Es tu turno** | Anillo de progreso decreciente alrededor de tu avatar + **háptica corta**. En segundo plano: notificación push | — |
| **Últimos 5 segundos** | El anillo pasa a rojo, pulso, háptica más marcada, texto "Foldeas en 3s" | — |
| **Flop** | Las tres cartas con flip 3D, stagger de 80ms | 350ms |
| **Turn / River** | Flip individual algo más lento: son las cartas que deciden, merecen medio latido más | 350ms |
| **Fold** | Las cartas se deslizan al centro y se desvanecen. El asiento baja a 40% de opacidad | 200ms |
| **Showdown** | Todas las manos giran a la vez y **después** se resalta la ganadora: las 5 cartas de la jugada se elevan y el resto se atenúa. Etiqueta con el nombre ("Color de corazones") | 700ms |
| **Subida de ciegas** | Banner que baja desde arriba, con sonido propio | 1,5s |

### 4.3 Eliminación / expulsión

Tres eventos distintos que la gente confunde. Solo el primero se lleva juice.

**1. Eliminado del torneo (0 fichas)** — evento raro (1-3 por noche): **presupuesto máximo.**

Es el momento más emocional de la noche y el que más se comenta después. Secuencia propuesta:

| t | Qué pasa |
|---|---|
| 0ms | La mano termina normal. Sin interrupciones todavía |
| +400ms | El stack del eliminado llega a 0 con la animación normal de fichas |
| +600ms | Su asiento se congela: color desaturado, cartas cayendo |
| +800ms | **Overlay de eliminación** ocupando el tercio central: nombre, puesto en grande (`5º`), y el sticker |
| +2.500ms | Se disuelve solo. Tap para saltar en cualquier momento |
| después | El asiento queda vacío. En el histórico, su puesto |

**El contenido del overlay lo pone el grupo, no nosotros.** Ver §4.5 — esta es la decisión de producto que
tomamos: por defecto, humor con mala leche; personalizable por mesa.

Si hay bounty activo, la recompensa vuela del eliminado al que le eliminó en el mismo overlay.

**2. Expulsado por el host (kick)** — **sin juice, deliberadamente.** Confirmación al host → el jugador ve
una pantalla clara con el motivo; para el resto, un toast neutro. Aquí una animación divertida convertiría
una acción social delicada en un espectáculo público, y en un grupo de amigos eso hace daño de verdad.

**3. Se va por su cuenta / sit out** — asiento en gris con etiqueta "Sit out" (como en Pokerrrr 2), sin drama.

### 4.4 Momentos raros que sí merecen espectáculo

El resto del presupuesto alto va aquí. Todos con la misma regla: **saltables con un tap**.

| Momento | Frecuencia | Efecto |
|---|---|---|
| **Ganar con 72o** | Rarísimo | El mayor de todos. Las cartas 7-2 en grande, contador de lo que cobra de cada uno volando a su stack, sticker del grupo. Es la mano que se cuenta al día siguiente |
| **Bad beat / suck-out en el river** | 1-2 por noche | Shake de mesa + destello + el % de equity que tenía antes del river ("ibas 91%"). El dato duele más que cualquier animación |
| **Bomb Pot** | Configurable | Intro propia: barrido de pantalla, `💣 BOMB POT`, antes de todos volando al centro a la vez, flop directo |
| **Ganar el torneo** | 1 por noche | Lo único que puede ocupar la pantalla entera. Pódium con los 3 primeros, stats de la noche, botón de compartir |
| **All-in** | Cada 10-20 manos | Tramo medio: texto `ALL IN` con peso, fichas al centro de golpe, y las equities de cada jugador si hay call |
| **Run It Twice** | Cuando aplica | Los dos boards se dibujan uno sobre otro, con el bote partiéndose visualmente en dos mitades |
| **Rabbit Hunt** | A petición | Cartas fantasma semitransparentes sobre el board, con tinte distinto. Sobrio: es información, no celebración |

### 4.5 Stickers y reacciones — la capa de cultura de grupo

**Esta es la decisión de producto más importante de la sección.** El razonamiento: nosotros no podemos
escribir la broma buena, porque la broma buena depende de que Marcos siempre paga con J-4 y de que a Ana la
llaman "la roca". Lo que sí podemos hacer es **darle al grupo el sitio donde poner su propia broma.**

Consecuencia de diseño: cada momento con juice tiene **un hueco de contenido reemplazable**, y de fábrica
trae un set con humor de mala leche que funciona sin configurar nada.

**Sistema propuesto:**

| Capa | Qué es | Quién lo pone |
|---|---|---|
| **Set por defecto** | ~12 stickers/frases con mala leche que funcionan para cualquiera. Es lo que ve una mesa nueva sin tocar nada | Nosotros |
| **Set de la mesa** | El host sube imágenes (caras de sus amigos, memes internos) y edita las frases. Persistente entre sesiones del mismo grupo | El host |
| **Motes** | Cada jugador tiene un alias que la mesa puede editar. Aparece en los mensajes de eliminación y en los premios | La mesa |
| **Reacciones en vivo** | Lanzar un sticker a otro jugador durante la mano (como los emotes de GGPoker). Con límite anti-spam | Cualquiera |

**Dónde se enganchan los stickers:**

- Overlay de eliminación (el principal)
- Ganar con 72o
- Bad beat
- Podio final del torneo
- Premios de fin de sesión ("mayor farol", "más manos foldeadas")
- Reacciones libres durante la mano

**Reglas para que no se vuelva tóxico:** límite de reacciones por mano, opción de silenciar a un jugador
concreto, y el host puede borrar un sticker del set. En un grupo de amigos la mala leche es el chiste, pero
la app no debe convertirse en el sitio donde se pasa de la raya sin freno.

### 4.6 Háptica y sonido

Es lo más infravalorado, y en móvil rinde más que cualquier animación. Propuesta de mapa háptico
(Web Vibration API / `navigator.vibrate` — ojo: **iOS Safari no lo soporta**, ahí hay que tirar de un truco
con un `<input type="checkbox" switch>` oculto o simplemente asumir solo-Android).

| Evento | Patrón |
|---|---|
| Es tu turno | Doble tick corto |
| Últimos 5s | Tick por segundo, creciente |
| Apuesta confirmada | Tick único seco |
| Ganas el bote | Un pulso, no tres. Es un evento frecuente (§4.0) |
| Eliminación / 72o / bad beat | Patrón largo y distinto. Aquí sí |
| Acción inválida | Buzz de error |

Sonido: siempre con un interruptor global **visible en la propia mesa**, no enterrado en ajustes, porque la
gente juega en el sofá con otros delante. Set mínimo: carta repartida, ficha, bote recogido, tu turno,
victoria. Y un set de sonidos "gordos" reservado a los eventos raros.

---

## 5. Mobile-first: reglas duras

Todo lo anterior se subordina a esto. La app es **móvil en vertical** y el resto son casos derivados.

### 5.1 Geometría y zonas del pulgar

- **Nada interactivo por encima del 55% de la pantalla.** La mesa es para mirar, no para tocar. Toda acción
  vive en el tercio inferior, que es donde llega el pulgar de una mano.
- **Objetivo táctil mínimo 44×44 pt** (48dp en Android). Los tres botones de acción deben ser de 56px de alto
  como mínimo — es el elemento que más se pulsa de la app y con prisa.
- **Separación entre Fold y el resto.** Fold debe estar visualmente aislado (gap mayor, o en el extremo
  opuesto a Raise). Un fold accidental arruina la partida y la confianza en la app.
- **Safe areas obligatorias:** `env(safe-area-inset-bottom)` en la barra de acción — si no, el botón queda
  bajo la barra de gestos del iPhone. Igual arriba con el notch/Dynamic Island.
- **`100dvh`, nunca `100vh`.** La barra de direcciones de Safari/Chrome móvil colapsa al hacer scroll y
  `100vh` deja la barra de acción fuera de pantalla. La app debe caber **sin scroll**.

### 5.2 Gestos vs. el navegador

Esto es lo que rompe una app de poker en móvil web:

| Problema | Solución |
|---|---|
| El swipe hacia abajo dispara **pull-to-refresh** y recarga la partida | `overscroll-behavior: none` en `html, body` |
| El swipe desde el borde izquierdo hace **back de navegación** | Evitar gestos que empiecen a <20px del borde |
| El drag de fold hace **scroll de página** | `touch-action: none` en las zonas de gesto (ya está en `hole-cards.tsx`) |
| **Doble tap hace zoom** → mata el "check por doble tap" | `touch-action: manipulation` + `user-scalable=no` en el viewport |
| **Long-press** abre el menú de iOS / selecciona texto | `-webkit-touch-callout: none` + `user-select: none` (ya está) |
| El teclado numérico **empuja el layout** al escribir una apuesta | Usar un teclado propio en pantalla, no `<input>` nativo |

### 5.3 Rendimiento

- **Animar solo `transform` y `opacity`.** Nada de animar `width`, `top`, `left` o `box-shadow`: fuerzan
  layout/paint y en un móvil de gama media se ven a 20fps. Ojo: `poker-table.tsx` posiciona los asientos con
  `left`/`top` en % — para animar fichas hay que pasar a `transform: translate()`.
- **Presupuesto: 60fps con 9 asientos animando a la vez.** Las fichas al bote son 9 elementos moviéndose
  simultáneamente; conviene animarlas como un solo grupo o usar `will-change` con cuidado.
- **Nada de librerías pesadas de animación** si se puede hacer con CSS transitions + Web Animations API.
- **Polling → WebSocket.** El `poker-api.ts` actual con polling gasta batería y añade latencia percibida.
  En móvil, la batería es una feature.
- **Precargar las 52 cartas** como sprite/SVG inline. Un flash de carta sin cargar en el river es fatal.

### 5.4 Contexto de uso real

- **Se juega con la pantalla al 30% de brillo, de noche, en un sofá.** Modo oscuro por defecto y contraste
  alto en las cifras (stacks, bote) — son lo único que se lee de reojo.
- **Se juega con interrupciones.** Cambiar de app y volver no puede perder el estado ni tu turno; la
  reconexión y la notificación push de "es tu turno" son features móviles, no extras.
- **Se juega con una mano.** El menú, el chat y los ajustes también deben ser alcanzables con el pulgar.
- **Orientación:** bloquear a vertical. Un óvalo de 9 asientos en horizontal en un móvil no aporta nada y
  duplica el trabajo de layout.
- **PWA / "Añadir a pantalla de inicio":** vale la pena. Elimina la barra del navegador (más pantalla útil),
  permite pantalla completa real y da acceso a notificaciones.

### 5.5 Tablet y desktop

No son el objetivo, pero no deben romperse. Estrategia barata: la misma composición vertical, **centrada y
con ancho máximo** (como una franja de móvil), en vez de rediseñar. La excepción que sí merece diseño propio
es el **modo TV/tablet central** de 3.x — pero ese es un producto distinto, no un breakpoint.

---

## 6. Gap analysis vs. lo que ya tenemos

| Área | Estado actual | Gap |
|---|---|---|
| **Layout** | `poker-table.tsx` — óvalo centrado, aspect 3/4 en móvil. Cartas propias en `hole-cards.tsx` como barra de 96px | El split de Pokerrrr 2 requiere: mesa arriba con más protagonismo, tus cartas **grandes** abajo (no una barra), y el rail como frontera |
| **Peek** | ✅ `hole-cards.tsx` ya hace press-and-hold + tap con auto-hide a 3s. Buena base | Falta el **arrastre progresivo** (las cartas se levantan proporcionalmente al dedo, no en dos estados) y el tamaño |
| **Check por doble tap** | ❌ | Colisiona con el tap-to-peek actual. Hay que decidir |
| **Fold por arrastre** | ❌ | |
| **Presets de apuesta** | ❌ Solo slider `min…max` | El gap más rentable de arreglar |
| **Apuesta en BBs** | ❌ Solo fichas | Trivial |
| **Pre-acciones** | ❌ | |
| **Shot clock** | ✅ Barra + "Checking in 3s" en `action-bar.tsx`. Bien resuelto | Falta anillo en el avatar y háptica |
| **Time bank** | ❌ | |
| **Animaciones** | ❌ Ninguna: `poker-table.tsx` pinta estado, no transiciones | Las 4 críticas de 4.1 son el trabajo grueso |
| **Configuración de sala** | Nombre, SB/BB, stack, minutos por nivel, segundos por acción, password | Falta todo el bloque C, D, E y F |
| **Modelo de juego** | Híbrido: stack fijo + ciegas subiendo = torneo sin recompras | Cash game y recompras requieren decisión de arquitectura en `backend/poker.py` |
| **Ledger** | ❌ | |
| **Historial de manos** | Parcial (`handHoleCards` en el estado) | No hay UI de revisión |
| **Reconexión** | Sesión guardada en cliente | Falta jugar la mano sola si te caes |

---

## 7. Decisiones tomadas

| Decisión | Elección | Qué implica |
|---|---|---|
| **Formato** | **Torneo** (lo que ya hay) | Se consolida el motor actual. Entran: recompras con periodo límite, add-on, puestos, podio, chop. **No** hay cash game de momento |
| **Contexto** | **Mixto** (presencial y remoto) | El peek se diseña como si fuera presencial (máxima privacidad), y se añade la capa social para el remoto. El modo tablet central queda como opción futura |
| **Gestos** | **Protagonistas** | La mesa manda; los botones aparecen solo cuando hacen falta. **Obliga a un onboarding real** — sin él, esta decisión se cae |
| **Estilo** | **Híbrido**: mesa realista, UI moderna | Óvalo, fieltro y cartas con acabado creíble; botones, tipografía y overlays de app moderna |
| **Reglas de la casa** | **72o, Bomb Pot, Run It Twice, Rabbit Hunt** | Las cuatro. Configurables por el host al crear la mesa |
| **Dinero** | **Solo fichas** | Sin ledger ni contabilidad. El marcador que importa pasa a ser el **ranking persistente del grupo** |
| **Eliminación** | **Humor con mala leche por defecto, stickers configurables por la mesa** | Ver §4.5. No escribimos la broma: damos el hueco donde el grupo pone la suya |
| **Curva de juice** | **Inversa a la frecuencia** | Ganar un bote = sobrio. Eliminar a alguien / 72o / bad beat = espectáculo. Ver §4.0 |

### Segunda tanda de decisiones

| Decisión | Elección | Qué implica |
|---|---|---|
| **Onboarding** | **Ninguno.** Botón de ayuda permanente | La mayoría ya conoce estos gestos. Un `?` fijo arriba a la derecha abre la chuleta de los cuatro gestos. Cero fricción en la primera partida |
| **Peek vs. doble tap** | **Doble tap manda.** Se elimina el "tap suelto revela 3s" | Mirar exige **arrastrar o mantener**; pasar exige **dos toques secos**; un toque suelto **no hace nada**. Esa es la desambiguación. Requiere tocar `hole-cards.tsx` |
| **72o** | **También ganando por fold** | Premia el farol, que es lo divertido. Obliga a que la app pida (o fuerce) enseñar las cartas al cobrar |
| **Bomb pot** | **Configurable por el host** | El host fija cada cuántas manos salta, al crear la mesa |
| **Recompras** | **Configurables por el host** | Igual que todo lo demás |

**Principio de configuración que se deduce:** *todo lo que sea una regla de la casa lo decide el host al
crear la mesa, de antemano.* Nada de ajustes a mitad de partida ni valores impuestos por nosotros. Esto
convierte la pantalla de creación de sala en una pieza central del producto, no en un formulario.

### Lo que sigue abierto

1. **Set de stickers por defecto:** hay que escribir esas ~12 piezas de mala leche. Es trabajo de copy y
   de ilustración, no de ingeniería.
2. **Formato del sticker de mesa:** ¿solo imagen, o también vídeo corto / GIF? Afecta a almacenamiento.
3. **Ergonomía del dial:** está a la derecha. Para zurdos queda incómodo — ¿configurable o centrado?
4. **Igualar sigue siendo un botón** mientras todo lo demás es gesto. ¿Debería ser también un gesto?
5. **Nueve asientos aprietan** en el óvalo a 42% de alto. Con mesa llena hay que reducir el asiento o
   quitar las cartas de los rivales.

---

## Fuentes

- [Real poker gestures — Pokerrrr 2 (GamingOnPhone)](https://gamingonphone.com/news/from-real-poker-gestures-to-big-screen-parties-reasons-why-pokerrrr-2-is-your-go-to-feature-loaded-poker-experience-on-mobile/)
- [Why Pokerrrr Is The Best Poker App (opciones de mesa: Run It Twice, Rabbit Hunt, Double Board, 72 Game)](https://www.pokerrrrapp.com/single-post/2017/12/18/why-pokerrrr-is-the-best-poker-app)
- [Pokerrrr 2 FAQ](https://www.pokerrrrapp.com/faq)
- [Pokerrrr 2 App Review — Professional RakeBack](https://professionalrakeback.com/pokerrrr-2-app-review)
- [Bet slider shortcut buttons — CardsChat](https://www.cardschat.com/forum/online-poker-73/bet-slider-shortcut-buttons-463818/)
- [Using PokerStars Tools To Your Advantage — PokerNews](https://www.pokernews.com/strategy/using-pokerstars-tools-to-your-advantage-26485.htm)
- [What is a Double Board PLO Bomb Pot? — The Lodge](https://thelodgepokerclub.com/what-is-a-double-board-plo-bomb-pot/)
- [Bomb Pots Are the New Straddle — PokerBros](https://playpokerbros.com/bomb-pots/)
- [Bomb Pot Poker: What is it and How to Play?](https://worldpokerdeals.com/blog/pppoker-bomb-pot)
- [How to introduce Bomb pots into home game — Poker Chip Forum](https://www.pokerchipforum.com/threads/how-to-introduce-bomb-pots-into-home-game.107162/)
- [Running It Twice in Cash Games — 888poker](https://www.888poker.com/magazine/poker-running-it-twice-cash-games)
- [Best Poker Variants for Home Games — PokerNews](https://www.pokernews.com/poker-home-games/best-poker-variants.htm)
- [Time Bank Definition — PokerNews](https://www.pokernews.com/pokerterms/time-bank.htm)
- [GGPoker Time Bank Cards — poker.pro](https://www.poker.pro/poker-news/ggpoker-implements-new-controversial-feature-paid-time-bank-card/)
- [Upoker: Double Board and other novelties](https://worldpokerdeals.com/blog/upoker-double-board-and-other-novelties)
- [Crear un club en PPPoker, PokerBros o Upoker — Somuchpoker](https://somuchpoker.com/how-to-create-your-own-online-poker-club-on-pppoker-pokerbros-or-upoker/)
- [App Review: PPPoker, Upoker, PokerBros — Cardplayer Lifestyle](https://cardplayerlifestyle.com/poker/app-review-pppoker-upoker-and-pokerbros/)
