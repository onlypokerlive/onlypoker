# Investigación: distribución y foco de producto

Dos preguntas: **(A) cómo se distribuye una PWA de poker entre amigos con 0 € de publicidad**, y
**(B) qué la convierte en un juego de mesa en vez de en una app de casino.**

Están más conectadas de lo que parece: casi todo lo que hace que esto se sienta como un juego de mesa
es, además, el mecanismo de distribución. Esa es la tesis del documento.

Complementa a `docs/investigacion-mecanicas-ux.md` (mecánicas y UX). Aquí no se repiten decisiones ya
cerradas — se dan por hechas.

---

## 0. TL;DR — las 10 conclusiones

1. **Nadie busca esto en Google.** "Poker con amigos" no es un producto que se busca, es un producto que
   se *convoca*: alguien del grupo dice "¿echamos una timba?" y pega un link. Tu canal de adquisición no
   es el buscador, es el grupo de WhatsApp de otro. Ver §1.
2. **La unidad de crecimiento no es el usuario, es la mesa.** Un host arrastra 5-8 personas en un solo
   gesto. Tu única métrica de verdad es **qué % de invitados acaba creando su propia mesa** (host
   conversion). Todo lo demás es vanidad. Ver §1.2 y §7.
3. **El link de invitación y el resumen de la noche SON el marketing.** Es la lección de Wordle (la
   cuadrícula de emojis) y de Partiful (la portada del evento): el activo que se comparte es el anuncio.
   Es lo más barato y lo más rentable que puedes construir. Ver §2.1.
4. **Discord Activity es tu segundo canal real** y te cuesta un fin de semana porque ya tienes una web app
   en una URL estable. Cada servidor que la adopta es un nodo permanente de 20-100 personas. Ojo: no hay
   catálogo global donde te descubran. Ver §2.2.
5. **El único SEO que funciona es el de las herramientas del anfitrión**: temporizador de ciegas,
   estructura de ciegas, reparto de premios. Ahí sí hay demanda probada (hay una decena de sitios viviendo
   de ello) y los incumbentes son feos y de un solo uso. Ver §2.3.
6. **"Gratis con anuncios" es el plan más frágil de los tres.** Google clasifica el poker simulado como
   *social casino* — categoría restringida, con certificación y con baneos "egregious". Construir el
   modelo sobre AdSense es apostar la casa a una política que no controlas. Ver §5.
7. **Cobra al anfitrión, no al jugador.** En un producto de grupo, el host tiene la disposición a pagar y
   el crédito social. "Mesa Pro" (esta noche todos juegan con lo bueno) convierte muchísimo mejor que 5
   €/mes por cabeza. Ver §5.3.
8. **Las cosméticas son de mesa, no de jugador.** Un skin de mesa lo ven 8 personas a la vez; un avatar lo
   ve nadie. Es más barato de producir y más potente socialmente. Ver §4.2.
9. **El rail de eliminados es la mejor idea de producto de este documento.** En las apps de poker, quedar
   eliminado te expulsa: el peor momento del producto. En un juego de mesa, el que pierde sigue en la
   mesa. Convertir la eliminación en un rol (ver cartas de todos, tirar stickers, comentar) salva la
   segunda mitad de la noche. Ver §4.3.
10. **El diseño anti-ludopatía es marketing, no disclaimer.** Formato torneo = tiene última mano. Sin
    recargas, sin ruleta diaria, sin desconocidos. Dilo en la home. "La app de poker que se acaba." Ver §4.7.

---

# PARTE A — DISTRIBUCIÓN

## 1. El diagnóstico correcto antes de elegir canales

### 1.1 Esto no es un producto de búsqueda

El error por defecto sería montar SEO para "poker online gratis". Ese SERP está ocupado por afiliados de
PokerStars, 888, Winamax y PartyPoker, que se dejan millones al año y monetizan cada clic a decenas de
euros. No hay ángulo. Y aunque lo hubiera, atraería exactamente al usuario que no quieres: el que busca
jugar por dinero con desconocidos.

El comportamiento real de tu usuario es otro:

> *Jueves, 21:40, grupo de WhatsApp. "¿Timba?" — "Va". — Alguien pega un link.*

Nadie ha buscado nada. El descubrimiento ocurre **dentro de un grupo cerrado**, por recomendación de un
par, en el momento exacto de la intención. Ese canal no se compra: se diseña.

### 1.2 La unidad de crecimiento es la mesa

Consecuencia práctica: tu embudo tiene una forma rarísima y muy favorable.

| Paso | Qué pasa | Coste para ti |
|---|---|---|
| 1. Un host te encuentra | El único paso "caro". 1 de cada 6-8 personas. | Aquí sí hay trabajo de canal |
| 2. Comparte un link | Un gesto, 2 segundos | 0 |
| 3. Entran 5-8 personas | Sin registro, sin descarga | 0 |
| 4. Alguno de esos 8 monta *su* timba | **Aquí vive todo el crecimiento** | 0 |

El paso 4 es tu k-factor. Si de cada 8 invitados 1,2 se convierten en host en 30 días, creces
exponencialmente sin gastar un euro. Si es 0,8, decreces por mucho tráfico que metas por arriba.

**Por tanto: casi todo tu esfuerzo de "marketing" debe ir a hacer que un invitado se convierta en
anfitrión**, no a traer invitados. Cosas concretas que mueven ese número:

- Que crear mesa sea *más* fácil que unirse (un botón, cero configuración obligatoria, presets).
- Que al terminar la noche, el CTA principal para todos sea "monta tú la próxima" y no "vuelve a jugar".
- Que la mesa tenga nombre y persista: *"La Timba del Jueves"* existe entre partidas y se puede reconvocar
  con un botón. Reconvocar es el gesto de host más barato posible.
- Que el resumen de la noche llegue a los 8 con tu marca encima (§2.1).

### 1.3 Lo que ya existe (y el hueco)

| Producto | Qué es | Posicionamiento |
|---|---|---|
| **PokerStars / Winamax / 888 Home Games** | Mesas privadas dentro de una sala regulada | Requiere cuenta en una casa de apuestas. Fricción brutal y contexto equivocado |
| **Poker Now** (pokernow.club) | Navegador, sin registro, gratis | El competidor más parecido. Funcional, estético de 2015, sin capa social |
| **Pokerrrr 2 / PokerBros / ClubGG** | Apps de clubes privados | Requieren descarga y club; en la práctica sirven de infraestructura para juego por dinero. Se organizan en Discord y Telegram |
| **EasyPoker** | App móvil para jugar con amigos | Mobile-first, requiere instalación |
| **Timers sueltos** (pokertimer.net, freepokerclock.com, Travis, Ultimate Holdem Timer…) | Reloj de ciegas para timba presencial | Herramientas de un solo uso, feas, gratis, con tráfico orgánico real |

Ninguno se posiciona como **juego de mesa para un grupo de amigos**. Todos se posicionan como *poker*.
Ese es literalmente el hueco: el mismo motor, envuelto en "noche de juegos" en vez de en "sala de poker".

> Nota: los datos públicos de tráfico de Poker Now que devuelve Similarweb (~17K visitas/trimestre) parecen
> una muestra parcial y no me fiaría de la cifra. Lo que sí es fiable de ahí es la composición: su
> tráfico es **directo y de marca** ("poker now", "pokernow"), prácticamente nada de descubrimiento
> genérico. Confirma §1.1: incluso el líder del nicho vive del boca a boca, no del buscador.

---

## 2. Canales, por orden de retorno

### Nivel A — los tres que sí importan

#### 2.1 El artefacto compartible (máxima prioridad, coste casi cero)

Es la lección más repetida y peor aplicada del crecimiento orgánico:

- **Wordle** pasó de 90 a ~3 millones de jugadores en dos meses sin gastar nada. El motor no fue el juego:
  fue la cuadrícula de emojis, que además **ni siquiera la inventaron ellos** — una jugadora empezó a
  compartir resultados así y Wardle lo convirtió en un botón. Funcionaba porque presumías sin hacer spoiler
  y porque el formato era reconocible a un vistazo.
- **Partiful** creció porque cada invitación es un anuncio: llega la portada, y quien no lo tiene ve para
  qué sirve sin que nadie se lo explique. 500K MAU y +400% interanual, con la marca convertida en verbo.

Tú tienes **dos** artefactos, y ahora mismo probablemente ninguno está diseñado:

**(a) El link de invitación.** No es una URL, es una tarjeta. Cuando se pega en WhatsApp/Discord/Telegram,
la preview (OG image, generada dinámicamente por mesa) debe decir en un vistazo:

```
  LA TIMBA DEL JUEVES
  Pablo te ha sentado en la mesa
  6 de 8 sillas ocupadas · empieza a las 22:00
  [ caras/avatares de los que ya están dentro ]
```

Los avatares de quien ya ha entrado son el detalle importante: es el efecto bola de nieve de la lista de
invitados de Partiful. Ver que ya están 4 colegas dentro es lo que convence al indeciso, no el copy.

**(b) El cartel de fin de noche.** Al terminar el torneo, generar **una imagen vertical, bonita, con la
marca discreta abajo**, con podio + premios/motes + un dato absurdo. Un botón: *Compartir*. Vía Web Share
API va directo al grupo. Esto es tu cuadrícula de Wordle.

Reglas para que funcione (aprendidas de Wordle y de los "Wrapped"):
- **Debe ser presumible sin ser insufrible.** El que gana lo comparte por ego; el que pierde lo comparte
  porque la broma es sobre él y tiene gracia. Diseña para los dos.
- **Reconocible a un vistazo.** Que a la tercera vez que alguien lo ve en un grupo, ya sepa qué es.
- **Imagen estática**, no vídeo ni link: se reenvía sola y funciona en cualquier plataforma.
- La marca va pequeña, pero va. Y con dominio corto y legible.

Coste: días. Retorno: es el canal. Si solo haces una cosa de este documento, haz esta.

#### 2.2 Discord Activity

Discord abrió las Activities a todos los desarrolladores con el Embedded App SDK, y en GDC 2026 amplió con
Social SDK y Game Shop. Ya lo usa >25% de sus MAU. Encaja casi sospechosamente bien contigo:

- **Los juegos que mejor funcionan ahí son exactamente el tuyo**: party games de 4-8 personas en un canal
  de voz, sesiones de 5-15 minutos, trivia, social asíncrono.
- **Requisitos reales**: build web en URL estable (ya lo tienes en Vercel), una Discord Application con
  Client ID, scopes `identify` + `applications.commands`, ~20 líneas de bootstrap del SDK, soporte táctil y
  aspect ratios flexibles. Alguien con soltura en HTML5 lo saca "en un fin de semana".
- **El contexto es perfecto**: gente ya reunida, ya en voz, con el momento muerto de "¿y ahora qué
  hacemos?". Es el equivalente digital de sacar la baraja.

Advertencias honestas:
- **No hay superficie global de "explorar Activities".** El descubrimiento pasa por servidores en los que
  ya estás, links en chat y partnerships. Si no hay comunidad, la Activity no te la crea.
- Escala modesta: las Activities de éxito hablan de miles a decenas de miles de partidas, no de cientos de
  miles.
- Discord se lleva ~30% de lo que se venda dentro, y puede cambiar las reglas cuando quiera.

Para ti eso no es un problema: no buscas escala, buscas nodos. Cada servidor de 50 personas que lo adopta
es un grupo de amigos entero. Y existe ya un ecosistema poker en Discord (bots como Poker Now Bot,
PokerNights, ERTH Poker; servidores etiquetados poker en Disboard) al que puedes ir directamente.

#### 2.3 SEO de herramientas de anfitrión (el único SEO con sentido)

Nadie busca "poker con amigos". Pero **el que organiza la timba presencial sí busca**, y busca cosas muy
concretas:

- "temporizador de ciegas poker" / "poker blind timer" / "reloj de torneo"
- "estructura de ciegas para 8 jugadores"
- "cuántas fichas por jugador poker"
- "reparto de premios torneo poker 9 jugadores"
- "valor de las fichas de poker por color"

Que exista una decena de sitios dedicados solo a esto (pokertimer.net, freepokerclock.com, Travis Poker
Timer, Ultimate Holdem Timer, PokerLog, y hasta 888 y Governor of Poker con su propia versión) demuestra
dos cosas: **hay demanda real y recurrente**, y **el listón está bajísimo** — son páginas de un solo uso,
sin diseño, de hace diez años.

La jugada:

1. Construye esas herramientas **dentro de tu PWA**, gratis, sin registro, y mejores que todas: móvil de
   verdad, bonitas, con háptica y sonido, con el móvil de un jugador como mando a distancia.
2. Cada una en su propia URL indexable, con contenido útil alrededor (no relleno SEO: la tabla de
   estructura de verdad, explicada).
3. Y al final de cada una, el puente: *"¿Y si no tienes fichas? Monta la mesa entera aquí"*.
4. **Programático**: `/estructura-de-ciegas/{N}-jugadores-{H}-horas` con una calculadora real detrás genera
   cientos de páginas legítimas (no basura) porque cada combinación da una respuesta distinta y correcta.

Por qué es estratégicamente mejor de lo que parece: te trae **anfitriones presenciales** — gente con un
juego de fichas y un grupo fijo. Es literalmente tu perfil de host ideal, y llega gratis y con intención.

#### 2.4 Sembrar donde ya están los anfitriones

Manual, lento, alta tasa de acierto. No es escalable y no importa: solo necesitas hosts.

- Reddit: r/poker (hilos de home games), r/homepoker, r/webgames, r/discordapps, y los subs de
  juegos de mesa y de "qué hacer en una quedada".
- Discord: servidores de poker, servidores de universidad, servidores de amigos donde ya estáis.
- Foros y comunidades de poker en español; grupos de Erasmus/colegios mayores (grupo cerrado con
  necesidad recurrente de plan y sin dinero: encaje perfecto).
- Comunidades de juegos de mesa — **no** comunidades de gambling. El posicionamiento importa desde el
  primer post.

Regla: participa como persona, no como cuenta de marca. Y **nunca automatices el posteo** — es la forma
más rápida de que te baneen y de quemar la única reputación que te va a mover.

### Nivel B — si os divierte

#### 2.5 Vídeo corto, pero que lo genere el producto

La realidad de 2026: el engagement orgánico de cuentas de gaming está en 4-8%, y lo que funciona no son
tráilers sino momentos auténticos — fallos, glitches, clips satisfactorios de 10 segundos. La recomendación
estándar (7-14 clips a la semana) es incompatible con "proyecto de tiempo libre".

La versión que sí te sirve: **que la app fabrique el clip**. Un bad beat brutal, un all-in a ciegas, la
eliminación del favorito → la app genera un **replay vertical de 10-15 s** con tus animaciones y lo deja a
un botón de compartir. No haces contenido: tus usuarios juegan y el contenido sale solo. Cientos de mesas
generando clips es un motor de UGC que ninguna cuenta de marca iguala.

Y encaja con la curva de juice ya decidida: los eventos raros son justo los que merecen espectáculo **y**
los que merecen clip. Mismo presupuesto de animación, dos usos.

#### 2.6 Google Play vía TWA (no para descubrimiento, para legitimidad)

Empaquetar la PWA con PWABuilder/Bubblewrap: cuenta de dev 25 $, Lighthouse ≥ 80, `assetlinks.json` en
`.well-known/`, y firmas el `.aab`. Coste: una tarde.

No vas a rankear en Play Store y no debes intentarlo. Sirve para otra cosa: matar la objeción *"¿pero
esto es una app de verdad?"*. Tener ficha en Play da una legitimidad desproporcionada a su coste.

**La App Store, ni la intentes.** No hay equivalente a TWA, Apple no implementa `beforeinstallprompt`, y
las guidelines son hostiles con cualquier cosa con forma de poker. En iOS tu historia es la PWA:

- Desde **iOS 16.4**, las PWAs añadidas a pantalla de inicio pueden mandar **push** (y desde Safari 18.4
  hay Declarative Web Push, sin service worker). Push es tu herramienta de reconvocatoria: *"Marcos ha
  abierto la timba del jueves"*.
- Desde **iOS 26**, cualquier sitio añadido a la pantalla de inicio se abre como web app por defecto.
- Pero el instalador es manual: **tu UX de "añadir a inicio" sustituye al prompt que Apple no da**, y la
  push solo existe si el usuario instaló. Merece una pantalla decente, mostrada en el momento correcto
  (al terminar la primera partida, no al entrar).

#### 2.7 Un lanzamiento, una vez

Product Hunt, Show HN, Xataka/Genbeta, r/webgames. Un día de tráfico y unos backlinks. Hazlo cuando el
producto ya tenga el loop de §2.1 funcionando — antes, es tráfico desperdiciado. No construyas estrategia
sobre esto.

### Nivel C — no lo hagas

- **Publicidad de pago.** Obvio, pero además: el CPC en cualquier keyword cercana a poker está inflado por
  las casas de apuestas. Es el peor mercado publicitario posible para entrar sin presupuesto.
- **Portales tipo Poki / CrazyGames.** Quieren juegos instantáneos y de sesión corta que enganchen en 10
  segundos; el tuyo es de 6-8 personas convocadas. Y los juegos con forma de casino son un campo de minas
  de políticas. No encaja.
- **Perseguir head terms** ("poker online", "texas holdem gratis"). Imposible y contraproducente.

---

## 3. Dónde entra la IA de verdad

No "que la IA escriba los tweets". Lo que de verdad se automatiza en este proyecto:

| Uso | Qué hace | Por qué importa |
|---|---|---|
| **Fábrica de páginas de herramientas** | Genera y revisa las cientos de páginas programáticas de §2.3, con datos reales detrás | Convierte una semana de trabajo en una tarde. Es el único SEO viable |
| **Crónica de la timba** | Un LLM escribe el relato de la noche con los motes del grupo y las manos reales | Ver §4.5. Es feature *y* es el activo que se comparte |
| **Stickers del grupo** | 5 fotos de tus amigos → pack de stickers de la mesa | Personalización a coste marginal cero. Ver §4.6 |
| **Motes y premios** | Nombra automáticamente al "Suicida" de la noche a partir de estadísticas reales | Ver §4.5 |
| **Localización** | Mismo producto en 10 idiomas | Multiplicador barato: el producto no tiene texto crítico |
| **Escucha de comunidades** | Detecta hilos donde alguien pregunta "app para timba en casa" | Detecta automático, **responde a mano** |

Un apunte sobre la crónica: tú mismo dijiste que no debemos escribir las bromas porque no las vamos a
clavar. Tienes razón para las bromas genéricas — un catálogo de chistes de eliminación escrito por
nosotros envejece en tres partidas. Pero una crónica generada sobre **manos reales, con motes reales, de
gente real**, es la única clase de broma que una máquina sí puede colar, porque el material es verdadero y
solo hace falta narrarlo. La gracia la ponen ellos; nosotros ponemos el narrador. Además es rejugable
infinito: cada noche es material nuevo.

---

# PARTE B — FOCO DE PRODUCTO

## 4. Cómo se convierte en juego de mesa y no en casino

### 4.0 El eje que lo decide todo

> Una app de casino optimiza **manos por hora**.
> Un juego de mesa optimiza **historias por noche**.

Todas las decisiones siguientes salen de ahí. Cuando dudes en una feature, pregunta: *¿esto genera más
manos o más historias?* Si la respuesta es "más manos", probablemente es una feature de casino.

Hay viento de cola cultural: la Gen Z está volviendo a los juegos de mesa y a las quedadas analógicas
(dos tercios preferirían una noche de juegos a salir de fiesta, según encuestas de 2025-2026), y la noche
de poker en casa está resurgiendo entre veinteañeros justamente como **quedada social, no como juego de
dinero** — con formato híbrido: empieza online y acaba presencial. Ese es exactamente tu producto. No
estás nadando contracorriente; estás en la ola.

### 4.1 El modelo Jackbox: lo que hay que robar

Jackbox construyó un imperio con dos ideas y las dos te aplican:

1. **El móvil como mando.** "Queríamos quitar la barrera del mando. Tu teléfono es el mejor mando que
   podrías querer." Fricción mínima: un código, ocho jugadores en segundos, sin cuentas.
2. **El público.** Muchos de sus juegos permiten espectadores ilimitados que votan. La gente que no juega
   sigue participando.

Y sobre todo su principio rector: **ganar es secundario; el objetivo real es que el grupo se ría.** Ese es
el norte de tu producto y es exactamente lo que te separa de PokerStars.

### 4.2 Cosméticas: la mesa, no el jugador

El instinto es copiar Fortnite: skins de avatar, emotes de pago. **Es el modelo equivocado para ti**, por
dos razones: en tu producto el avatar se ve minúsculo, y el valor social de una cosmética viene de cuánta
gente la ve.

**La cosmética correcta es de mesa, elegida por el anfitrión, vista por los 8 a la vez:**

| Capa | Qué es | Notas |
|---|---|---|
| **Identidad de la mesa** | Nombre, escudo/logo, color | Es "la caja del juego". Persiste entre noches |
| **Tapete** | Textura y color del fieltro | Lo más visible de la pantalla. Alto impacto, coste bajo |
| **Baraja** | Dorso y estilo de las cartas | El dorso es la carta más vista de la partida |
| **Fichas** | Set de fichas, colores, sonido | Ligado al sonido: media identidad de una timba es el ruido de las fichas |
| **Pack de sonido** | Barajado, fichas, timer, gong de nivel | Muy infravalorado. En móvil el sonido y la háptica hacen más que cualquier animación |
| **Pack de stickers** | Ver §4.6 | La capa de cultura de grupo |

Ventajas: son 6 assets que ven 8 personas, en vez de 8 assets que ve 1. Refuerzan el "esta es *nuestra*
mesa". Y encajan con cobrar al anfitrión (§5.3): el host compra, la mesa entera disfruta. Eso es
socialmente muy distinto a "yo me he comprado un skin".

### 4.3 El rail: arreglar el peor momento del producto

En cualquier app de poker con formato torneo, quedar eliminado te echa. Si eres el segundo en caer, te
quedan 40 minutos de nada y te vas del grupo. **Es el fallo estructural del formato y nadie lo ha
arreglado bien.** En una timba presencial no pasa: el eliminado se queda, abre una cerveza, y se convierte
en el más ruidoso de la habitación.

**El rail** = los eliminados siguen en la mesa con un rol distinto:

- **Ven las cartas de todos** (modo retransmisión de TV, con equity en pantalla). De golpe, quedar
  eliminado te da información que los jugadores no tienen. Es un ascenso, no un castigo.
- **Pueden tirar stickers** — pero solo ellos, o con más presupuesto que los jugadores. El eliminado se
  convierte en el gracioso.
- **Comentan.** Chat o voz del rail, separado del de la mesa, para que puedan destriparlo todo sin
  filtrar información.
- **Votan.** "¿Bomb pot en la siguiente mano?" decidido por los eliminados es una idea rara y buena:
  les da poder sobre la partida que les echó.
- **Apuestan** (con fichas de fantasía, sin valor) sobre quién cae siguiente.

Es la feature del "público" de Jackbox aplicada a poker, y en tu caso es más importante que en el suyo,
porque tu formato ya está decidido como torneo. **Sin rail, un torneo entre amigos es una app que expulsa
progresivamente a tus usuarios de su propia quedada.**

### 4.4 Persistencia: la liga, no la partida

Ya está decidido que el marcador es el ranking persistente del grupo. Lo que lo convierte en juego de mesa
de verdad:

- **Temporadas** con principio y fin (ej. trimestrales). Un ranking eterno no motiva; uno que se reinicia
  en enero sí. Además da un momento natural de "campeón de la temporada".
- **El trofeo se queda en casa del ganador.** Equivalente digital: el campeón vigente lleva una corona/marco
  visible en la mesa hasta que lo destronen. Se ve en cada partida. Es la mejor recompensa posible y no
  cuesta nada.
- **Rivalidades automáticas.** *"Marcos te ha eliminado 7 veces esta temporada"* al sentaros en la misma
  mesa. La estadística no es un panel: es material narrativo servido en el momento justo.
- **Historial de la mesa**: cada noche jugada, con su cartel (§2.1). El álbum del grupo.
- **Reconvocar en un botón.** La acción más valiosa de la app: "misma mesa, mismo formato, jueves".

### 4.5 El sistema de premios: el motor de bromas que sí podemos construir

Aquí resuelvo la tensión de "no escribáis vosotros las bromas". Correcto: **no escribimos los chistes,
escribimos las categorías.** La broma la pone la realidad.

Premios al final de cada noche, con nombre y con dato:

| Premio | Criterio | Por qué funciona |
|---|---|---|
| **El Suicida** | Más all-ins perdidos | Se lo lleva alguien real, con número real |
| **La Roca** | Menor % de manos jugadas | Acusa de aburrido con datos |
| **El Cajero** | Más fichas transferidas a un único rival | Nombra a la víctima *y* al verdugo |
| **El Milagro** | Ganó el bote con menos equity | Legitima la suerte descarada |
| **Mano de Piedra** | Peor mano con la que ganó un bote grande | |
| **El 72o** | Ejecutó la regla de la casa | Ya está en el diseño; hazlo premio |
| **El Fantasma** | Más tiempo en time bank / más veces que se le acabó el reloj | El que estaba mirando el móvil |
| **Primer Caído** | Primer eliminado | El clásico |

Tres propiedades que los hacen valiosos: son **baratos** (salen de estadísticas que ya calculas), son
**infinitamente rejugables** (cada noche cambia la víctima) y son **configurables por la mesa** — el grupo
puede renombrarlos con su propia jerga, que es donde vive el chiste que nosotros no podemos escribir.

Los premios son, además, el contenido del cartel compartible de §2.1. Product y growth son la misma cosa.

### 4.6 Stickers: el detalle que lo convierte en vuestro

Ya está decidido que los stickers configurables por la mesa son la capa de cultura de grupo. Tres cosas
que suben mucho el techo:

1. **Stickers a partir de las fotos del grupo.** El host sube 5 fotos, la IA genera el pack. Las caras de
   tus colegas volando sobre el tapete es, sin comparación, lo más "juego de mesa" que puede tener esto.
   Es también un motivo enorme para que alguien monte *su* mesa en vez de jugar en la ajena.
2. **La escasez es lo que los hace graciosos.** Sticker ilimitado = spam = ruido = se apaga. Un presupuesto
   por mano (2-3), o recargable al ganar botes, convierte tirar un sticker en una decisión. El eliminado
   en el rail tiene más presupuesto (§4.3).
3. **Exportables a WhatsApp.** Los stickers son 512×512 WebP, <100 KB, packs de 3-30; con Web Share API
   desde el móvil van al selector nativo. El pack de la mesa vive en el grupo de WhatsApp **entre
   partidas**, con tu marca dentro. Es el único canal de retención pasiva gratis que vas a tener.

### 4.7 El diseño anti-ludopatía, en la portada

Tu diferenciación no es el motor de poker. Es lo que **no** haces. Y hay que decirlo en voz alta porque es
también el mejor mensaje de marketing que tienes:

**Lo que no habrá, y se dice:**
- Sin dinero real, sin ledger, sin cajero. (Ya decidido — mantenlo, es también lo que te mantiene fuera del
  radar regulatorio; ver §6.)
- Sin recarga diaria de fichas, sin ruleta de premios, sin racha diaria. Nada diseñado para que vuelvas
  solo.
- **Sin desconocidos.** No hay lobby global, no hay matchmaking. Solo se juega con quien te ha invitado
  alguien. Esto elimina de un plumazo el 90% de tu coste de moderación, de tu riesgo legal y de tu
  parecido con un casino.
- Sin notificaciones cebo. Las push solo sirven para convocar: *"Marcos ha abierto la timba"*. Nunca
  *"te echamos de menos"*.

**Y sobre todo: el torneo tiene última mano.** El formato ya elegido es, en sí mismo, el diseño
anti-adicción — un cash game no termina nunca, un torneo sí. Es un titular:

> *"La única app de poker que se acaba."*

### 4.8 Los rituales de la noche

Un juego de mesa tiene montaje, partida y recogida. Las apps de poker solo tienen partida. Los otros dos
huecos son gratis y son donde vive el cariño:

- **Antes:** sala de espera con las caras de quien va llegando, elección de stickers, sorteo de asientos
  con algo de ceremonia, el host eligiendo las reglas de la casa a la vista de todos. Que llegar pronto
  tenga premio social.
- **Después:** podio → premios (§4.5) → crónica (§3) → cartel compartible (§2.1) → botón de reconvocar.
  **El final de la noche es el momento más valioso del producto entero** y es el que todas las apps de
  poker desperdician.

### 4.9 Tabla de decisión rápida

| Feature | ¿Casino o mesa? | Veredicto |
|---|---|---|
| Lobby público / matchmaking | Casino | Nunca |
| Compra de fichas | Casino | Nunca |
| Recompensa diaria / racha | Casino | Nunca |
| Cash game infinito | Casino | Ya descartado, bien |
| Estadísticas de winrate serias | Casino | Evitar. Estadística sí, pero como material de broma, no como panel de tracker |
| Rail de eliminados | Mesa | Prioridad alta |
| Premios con nombre | Mesa | Prioridad alta |
| Cosméticas de mesa | Mesa | Sí |
| Temporadas y trofeo vigente | Mesa | Sí |
| Stickers con caras del grupo | Mesa | Sí, es el diferencial |
| Crónica narrada | Mesa | Sí |

---

## 5. Monetización: el problema del plan "gratis con anuncios"

### 5.1 El riesgo de los anuncios (importante)

Google clasifica el poker simulado sin dinero real como **social casino**: "juegos que simulan el juego de
azar sin oportunidad de ganar dinero o premios de valor real". Consecuencias:

- Es una **categoría restringida con certificación**, no contenido normal.
- Del lado publisher, quienes están **fuera de un grupo limitado de países no pueden poner anuncios en
  contenido de gambling ni en páginas que enlacen a él**, y las políticas varían por país del editor.
- Google califica los incumplimientos en esta área como *"egregious"*: suspensión inmediata y permanente
  de la cuenta.

Traducción: **puede que AdSense te acepte, puede que no, y puede que te acepte y te expulse dentro de seis
meses sin apelación.** Construir el modelo de negocio ahí es apostar la casa a una política que no
controlas y que no puedes negociar sin ser una empresa.

Alternativas si aun así queréis anuncios: redes especializadas en juegos HTML5 (AdinPlay, que sirve a
Gartic Phone y Skribbl.io; Playgama; AppLixir), con vídeo recompensado en el rango 10-50 $ CPM frente a
0,10-1 $ del banner. Pero implica integrar SDKs de terceros, y el vídeo recompensado *dentro* de una
partida de 8 personas es horroroso (¿paras la mesa mientras uno ve un anuncio?).

### 5.2 Mi recomendación: no metas anuncios (todavía)

Razones, por orden:

1. **Los anuncios son lo único que puede hacer que esto se parezca a lo que no quieres ser.** Un
   intersticial entre manos convierte tu juego de mesa en una app de casino gratuita en un segundo.
2. Tú mismo has dicho que dudas de ganar dinero. Entonces el objetivo no es maximizar ingresos: es no
   perder dinero y que sea divertido. Un proyecto de este tamaño en Vercel + Upstash cuesta poco hasta que
   tenga muchísimos usuarios.
3. El riesgo de política de §5.1 es asimétrico: ganas céntimos, arriesgas la cuenta.
4. "Sin anuncios nunca" es un argumento de venta y de posicionamiento que refuerza todo lo de §4.7.

Si en algún momento el coste de infraestructura duele, la palanca correcta no es el anuncio: es §5.3.

### 5.3 Cobra al anfitrión, no al jugador

El error clásico en productos de grupo es la suscripción per cápita. En una timba de 8, pedir 5 €/mes a
cada uno te da 8 negativas. Pero:

- El **host** ya está haciendo un esfuerzo social (convoca, configura, organiza). Es la persona con
  disposición a pagar y con crédito en el grupo.
- Pagar por la mesa es **socialmente legible**: es como poner las cervezas. Regalar algo al grupo se siente
  bien; comprarse un skin, no.

Estructura sugerida (sobre tu esquema de 5 €/mes y 20 € lifetime):

| Producto | Qué desbloquea | Quién paga |
|---|---|---|
| **Gratis** | Todo el juego. En serio: todo el poker, sin límite de partidas | — |
| **Noche Pro** (micro, ~1-2 €) | Esta noche, para los 8: cosméticas premium, crónica, replays | El host, puntualmente |
| **Mesa Pro** (~5 €/mes) | La mesa siempre pro: temporadas, historial completo, packs, stickers con fotos | El host, o a escote |
| **Lifetime** (20 €) | Lo mismo, para siempre, + algo que se vea (marco, insignia de fundador) | El fan |

Dos detalles que importan: (a) **nada que afecte al juego se vende jamás** — es cosmético, social y de
conveniencia, nunca ventaja; (b) el que paga tiene que **verse** que paga, delante de sus amigos. Ese es
el único incentivo real en un producto social.

Y con esto, si algún día quieres vender cosméticas dentro de Discord, el Game Shop ya existe (ellos se
llevan ~30%).

---

## 6. Legal, en dos párrafos

Con la decisión ya tomada de **solo fichas, sin dinero real y sin ledger**, estás fuera del ámbito de la
Ley 13/2011 y de las licencias de la DGOJ, que regulan la explotación de juegos **con dinero o premios de
valor económico**. No necesitas licencia para un juego de fichas sin valor, igual que no la necesita un
Monopoly.

Lo que sí conviene tener, y es media tarde de trabajo:

- **Términos y aviso visible**: no es juego con dinero real, las fichas no tienen valor ni se pueden
  canjear, no se promociona juego real. (Es literalmente lo que Google exige para la categoría social
  casino, y es buena práctica igualmente.)
- **Edad mínima** declarada y no dirigirse a menores. Aunque no haya dinero, la estética de casino con
  menores es donde está el riesgo reputacional y regulatorio europeo (el debate de loot boxes y menores).
- **No integrar ni enlazar salas de dinero real jamás.** Ni afiliación, ni "también puedes jugar en X".
  Ese enlace es lo que te reclasificaría de golpe.
- No añadir ledger ni "quién debe cuánto a quién". Es la feature que más te pedirán y la que más caro te
  saldría: convierte el producto en infraestructura de juego por dinero. La decisión de no tenerlo ya
  tomada es correcta — mantenla.

---

## 7. Qué medir (y qué ignorar)

**La única métrica que importa:**

> **% de invitados que crean su propia mesa en los 30 días siguientes.**

Si ese número supera ~1 host nuevo por cada 7 invitados, creces solo. Instruméntalo desde el día uno.

**Las que sí valen:**

| Métrica | Por qué |
|---|---|
| Mesas creadas / semana | El pulso real |
| Jugadores por mesa | Salud del link de invitación |
| **Host conversion (arriba)** | El k-factor |
| **Repetición de grupo** (% de mesas que juegan una 2ª noche) | Retención de grupo, no de usuario. Es lo que mide si sois un juego de mesa |
| Comparticiones del cartel / mesa | Salud del loop de §2.1 |
| Instalaciones a pantalla de inicio | Puerta a las push |

**Las que hay que ignorar deliberadamente:** DAU, sesiones por usuario, tiempo en app. Son métricas de
casino. Un grupo que juega dos horas un jueves cada dos semanas y se lo pasa en grande es un éxito
absoluto de este producto y un fracaso en un dashboard de engagement diario. No te midas con la vara de la
industria de la que estás huyendo.

---

## 8. Orden de trabajo sugerido

Priorizado por (impacto en el loop) ÷ (esfuerzo), no por lo divertido que sea de construir.

**Fase 1 — Cerrar el loop (lo único urgente)**
1. OG image dinámica del link de invitación, con caras de los que ya están dentro (§2.1a).
2. Cartel de fin de noche compartible + Web Share API (§2.1b).
3. Podio + 6-8 premios con nombre (§4.5) — es el contenido del cartel.
4. Instrumentar host conversion (§7).
5. UX de "añadir a pantalla de inicio" mostrada al terminar la primera partida (§2.6).

**Fase 2 — Que la noche entera sea buena**
6. Rail de eliminados (§4.3). La feature de producto más importante del documento.
7. Reconvocatoria en un botón + push (§4.4).
8. Crónica generada de la noche (§3).
9. Stickers con fotos del grupo (§4.6).

**Fase 3 — Identidad y dinero**
10. Cosméticas de mesa: tapete, baraja, fichas, pack de sonido (§4.2).
11. Temporadas + corona del campeón vigente (§4.4).
12. Precios: Noche Pro / Mesa Pro / Lifetime (§5.3).

**Fase 4 — Canales nuevos**
13. Discord Activity (§2.2).
14. Herramientas de anfitrión + SEO programático (§2.3).
15. Play Store vía TWA (§2.6).
16. Lanzamiento público, una vez (§2.7).

Nota sobre las fases 1 y 2: son casi todas features de *producto*. Eso es intencionado. En este tipo de
producto, el trabajo de distribución **es** trabajo de producto. La única excepción real es la fase 4.

---

## Fuentes

**Crecimiento y loops virales**
- [How Kahoot! Became Popular Without Marketing (case study)](https://bettermarketing.pub/how-kahoot-became-popular-without-marketing-a-case-study-19dececaf3db) · [Kahoot PMF case study](https://medium.com/@EmergePMFAcademy/how-kahoot-grew-to-7-billion-users-by-designing-for-behaviour-a-product-market-fit-case-study-667cc4504f14)
- [Wordle: creator Josh Wardle on why it went viral (Slate)](https://slate.com/culture/2022/01/wordle-game-creator-wardle-twitter-scores-strategy-stats.html) · [The History of Wordle](https://phrazle.co.uk/blog/history-of-wordle/)
- [Partiful Marketing Strategy (NoGood)](https://nogood.io/blog/partiful-marketing-strategy/) · [Partiful doesn't want to be 'unhinged' (Marketing Brew)](https://www.marketingbrew.com/stories/2026/03/09/partiful-marketing-strategy-organic-mentions-the-pitt)
- [How to Build a Wrapped Feature for Your App (Trophy)](https://trophy.so/blog/how-to-build-wrapped-feature)

**Discord como canal**
- [Shipping Indie Games on Discord Activities: 2026 playbook (StraySpark)](https://www.strayspark.studio/blog/discord-activities-embedded-app-sdk-indie-game-distribution-2026)
- [Come Build Where the World Plays (Discord)](https://discord.com/blog/build-where-the-world-plays) · [Introducing the Embedded App SDK](https://support-dev.discord.com/hc/en-us/articles/21204423970071-Introducing-the-Embedded-App-SDK)
- [Best Poker Discord Servers (Hive Index)](https://thehiveindex.com/topics/poker/platform/discord/) · [Poker Now Discord Bot](https://top.gg/bot/613156357239078913)

**PWA: distribución, iOS y Play Store**
- [Do Progressive Web Apps Work on iOS? Complete Guide 2026 (MobiLoud)](https://www.mobiloud.com/blog/progressive-web-apps-ios) · [PWA iOS Limitations and Safari Support 2026 (MagicBell)](https://www.magicbell.com/blog/pwa-ios-limitations-safari-support-complete-guide)
- [Can You Publish a PWA to the App Store and Google Play? (MobiLoud)](https://www.mobiloud.com/blog/publishing-pwa-app-store) · [PWABuilder — Android platform](https://blog.pwabuilder.com/docs/android-platform/)
- [PWAs in app stores (web.dev)](https://web.dev/articles/pwas-in-app-stores)

**Diseño de party games**
- [These Design Principles Made Jackbox a Party Game Phenomenon (Built In Chicago)](https://www.builtinchicago.org/articles/jackbox-games-design-party-pack)
- [Jackbox creative director on improv roots (WBUR)](https://www.wbur.org/hereandnow/2025/10/23/jackbox-games)
- [Emote System Design: Social Animation for Online Games](https://mocaponline.com/blogs/mocap-news/emote-system-design-guide)
- [Gen Z's Revival Of Poker Nights In The Digital Age](https://playtoday.co/blog/guides/poker-nights-gen-z/) · [Over two thirds of Gen Z would pick board games over clubbing (E.ON)](https://news.eonenergy.com/news/generation-game-over-two-thirds-of-gen-z-would-pick-playing-board-games-over-clubbing-with-friends)

**Competencia y nicho**
- [pokernow.club traffic (Similarweb)](https://www.similarweb.com/website/pokernow.club/) · [Poker Now alternatives (AlternativeTo)](https://alternativeto.net/software/poker-now/)
- [Cómo jugar al póker online con amigos desde España (PokerNews ES)](https://es.pokernews.com/poker-online-con-amigos.htm)
- [ClubGG vs PokerBros 2026](https://bluffingmonkeys.com/clubgg-vs-pokerbros-2026-best-poker-app/)
- Herramientas de anfitrión: [pokertimer.net](https://pokertimer.net/) · [freepokerclock.com](https://freepokerclock.com/) · [Travis Poker Timer](https://travispokertimer.com/) · [Ultimate Holdem Timer](https://ultimate-holdem-timer.com/) · [888 Poker Timer](https://www.888poker.com/poker/poker-timer)

**Monetización y políticas**
- [Gambling and games — Google Advertising Policies](https://support.google.com/adspolicy/answer/15132179?hl=en) · [Google Updates Its Gambling & Games Advertising Policy (SEJ)](https://www.searchenginejournal.com/google-updates-its-gambling-games-advertising-policy/539503/)
- [Google AdSense Gambling Policy Update, Aug 2026](https://www.chiangraitimes.com/tech/google-adsense-gambling-policy-update/)
- [10 Ways to Monetize HTML5 Games in 2026 (Playgama)](https://playgama.com/blog/main/10-ways-to-monetize-html5-games-that-actually-work-in-2026/) · [AdinPlay](https://adinplay.com/)
- [Leyes de Juego en España 2026 (Ley 13/2011)](https://datadiar.tv/leyes-de-juego-en-espana-2026/)

**Marketing orgánico**
- [Zero-Budget Indie Game Marketing (Althera)](https://altheragames.com/en/blog/indie-game-marketing-zero-budget) · [TikTok's Changing Landscape for Game Marketing in 2026 (Cloutboost)](https://www.cloutboost.com/blog/tiktoks-changing-landscape-for-game-marketing-in-2026-what-developers-need-to-know)
- [WhatsApp sticker specs 2026](https://moda.app/resources/sizes/whatsapp-sticker)
