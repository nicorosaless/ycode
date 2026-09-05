# El subset que `rin5-import` reproduce fielmente

> Contrato para el generador de rin5 (G9, P-2609): lo que este importador
> representa 1:1, y lo que no. El generador solo debe escribir HTML/CSS
> dentro de la columna "sí" — cualquier cosa en la columna "no" se pierde o se
> deforma en el round-trip import → export, con independencia de lo bien
> escrito que esté el HTML fuente.
>
> Estado a 2026-09-05, tras la **ronda 7**: los dos runs de la cohorte 2 que
> fallaban el gate —8,36% y 9,19% de diff ponderado— quedan en **0,14% y
> 0,16%**, por una sola causa (las fuentes que la hoja trae con `@import`), y
> los cinco controles se mueven dentro del ruido. La ronda 6 había dejado las
> tres generaciones de la cohorte 1 en 0,25%, 0,37% y 0,19%. Tabla completa,
> advertencia sobre el cambio de medidor y **la lista PROHIBIDO para el
> linter** al final del documento.

## El ciclo, reproducible sin UI

```bash
export RIN5_SITE_DIR=/ruta/a/clients/<id>/site
node --require ts-node/register --require tsconfig-paths/register scripts/rin5-import.ts
npm run rin5:publish
RIN5_EXPORT_ORIGINAL_ASSETS=1 \
  node --require ts-node/register --require tsconfig-paths/register scripts/export.ts
node scripts/rin5-roundtrip-diff.mjs --src "$RIN5_SITE_DIR" --out ./out --diff /tmp/diff
```

Detalles de entorno y trampas conocidas en `ops/README.md`.

## Lo que la ronda 3 cambió, y por qué importa al generador

Las cuatro causas grandes que quedaban no eran del CSS que escribe el
generador, sino de cómo el importador construía la cascada. Se listan aquí
porque explican por qué la columna "no" es ahora mucho más corta:

1. **Estilos por defecto del navegador.** El importador resolvía solo la hoja
   del autor, y lo que exporta Ycode lo resetea el preflight de Tailwind. Un
   sitio sin su propio `*{margin:0}` perdía todo margen, sangrado y escalón
   tipográfico heredado del UA. `<figure>` con su `margin: 1em 40px` era el
   16,5% del hero de portada. Ahora se siembran por tag, por debajo de
   cualquier regla del autor.
2. **Shorthand contra longhand.** El mapa de ganadores va indexado por nombre
   de propiedad, así que `p{margin:0 0 1em}` y `p:last-child{margin-bottom:0}`
   no competían: sobrevivían los dos y ganaba el que Tailwind generase último.
   `margin`/`padding` se expanden ahora a longhands al parsear — y desde la
   ronda 6 también `border`, `border-top/right/bottom/left` y los lógicos
   `margin-inline`/`margin-block`/`padding-inline`/`padding-block`. Los tres
   sitios que quedaban con diff alto tropezaban con alguno: `.btn{border:1.5px
   solid transparent}` contra `.btn--ghost{border-color:…}` dejaba los botones
   sin borde, y `.wrap{margin-inline:auto}` contra el `margin-left:0` del
   reset universal descentraba el sitio entero.
3. **El atributo `style` no estaba en la cascada**, se pegaba detrás como
   clases más. Ahora entra por encima de todo selector.
4. **`<details>`/`<summary>`** ya tiene equivalente (ver más abajo).

## Selectores

| Sí | No |
|---|---|
| Clase única, cadenas de clases, combinadores descendente/hijo/hermano, atributos (`[data-x]`), `:hover` **solo en el sujeto** (`.btn:hover`, no `.card:hover img`) | `::selection`, `::placeholder`, `::marker`, `::first-line`, `::first-letter` |
| `::before` / `::after` (ver abajo) | `:focus-visible`, `:active` |
| Selector universal `*` **anclado** en algo: `.stack > * + *` (el "búho"), `.prose * + *` | Un universal **combinado** sin anclar (`* + *`, `* > *`) — se descarta la regla entera |
| El reset universal a secas (`*{margin:0}`), con especificidad 0: por encima de los estilos por defecto del navegador, por debajo de cualquier regla de autor | Su `box-sizing` se sigue tirando: el preflight de Tailwind ya aplica `border-box` y emitirlo en cada capa es ruido sin píxeles detrás |
| Cualquier selector que el motor de matching (`Element.matches()`) resuelva, dentro de lo anterior | Selectores con `@` embebido (artefactos de parseo) |

**El reset universal también funciona, desde la ronda 6.** `*{margin:0}` es
medio reset de Meyer y lo escribe cualquier hoja hecha a mano. Descartarlo
dejaba en pie las semillas del navegador que el importador siembra por tag, así
que cada `<h2>`, `<p>` y `<ul>` del export llevaba un margen que el original no
tiene y la página entera se desplazaba hacia abajo: era el 13,4% de diff de la
generación de Natural Equus. Con especificidad 0 el reset cae exactamente donde
CSS lo pone y cancela esas semillas sin pisar ninguna regla de autor.

**El "búho" (`.stack > * + *`) funciona.** Descartarlo era el defecto que
más pixeles movía en la generación 188658f6: es la forma más común de espaciar
una pila de hermanos en CSS escrito a mano, y sin él cada tarjeta
`.panel.stack` perdía la separación entre su etiqueta, su `h3` y su `p` — las
regiones `section.section-tint` llegaban al 13,3%. Lo único que sigue fuera es
un universal sin anclar, porque emitir `[box-sizing:border-box]` en cada una de
las capas del sitio es ruido sin ningún pixel detrás.

La resolución de cascada (especificidad, orden de declaración) es real —
usa el DOM, no una aproximación — así que dentro de lo soportado el ganador
por propiedad es el mismo que en un navegador. Tres capas, de menos a más
peso: estilos por defecto del navegador (sembrados por tag) → reglas de la
hoja por especificidad y orden de declaración → atributo `style`. `!important` viaja pegado al
valor, no altera el orden.

## `@media`

Solo hay **dos buckets**, y son los de Tailwind. Toda `@media (max-width: Npx)`
del autor cae en uno de los dos según su N:

| Breakpoint del autor | Bucket | Dónde corta de verdad |
|---|---|---|
| `max-width` ≤ 767px | `max-md:` | 767px |
| 768px – 1200px | `max-lg:` | 1023px |
| > 1200px | — | **se descarta la regla entera** |

**El corte no es el que escribiste.** Un `@media(max-width:900px)` y un
`@media(max-width:820px)` acaban los dos en `max-lg:`, que corta en 1023px: entre
900 y 1023 el export ya aplica lo que el original todavía no. A 1440 y a 390 —los
dos viewports que mide el gate— coinciden, y por eso el diff no lo ve; en las
anchuras intermedias, no. **Regla para el generador: escribe los breakpoints en
767px y 1023px**, y tendrás el mismo pixel en los dos lados.

**Dos breakpoints del autor que caen en el mismo bucket se funden.** Natural
Equus declara 900, 860, 820, 780, 700, 640 y 520px; 900/860/820/780 son todos
`max-lg:` y 700/640/520 todos `max-md:`, así que de siete escalones quedan dos.
Dentro de cada bucket gana la última regla, como en la hoja original — pero los
escalones intermedios desaparecen. Si un layout necesita tres pasos, dos de ellos
van a llegar juntos.

| Sí | No |
|---|---|
| `@media (max-width: Npx)` con las salvedades de arriba | `@media (min-width: …)` — se descarta la regla entera |
| Reglas de `::before`/`::after` dentro de una media query — se mapean al mismo prefijo que las reglas de elementos normales | Cualquier query que no sea `max-width` sola: `(min-width: A) and (max-width: B)`, `orientation`, `hover`, `pointer` |
| `grid-template-columns`, `display:none`, spacing y tipografía dentro de una media query: cualquier propiedad, igual que fuera | `@supports`, `@keyframes`, `@container`, cualquier otro at-rule |
| | `prefers-reduced-motion` — se descarta explícitamente |

### La media query no añade especificidad

Es lo que arregla la ronda 6 y lo que más píxeles movía. En un navegador, estas
tres reglas dejan **dos columnas** a 390px:

```css
.split        { grid-template-columns: 1fr 1fr }
.split.narrow { grid-template-columns: 1.05fr .95fr }
@media (max-width: 900px) { .split { grid-template-columns: 1fr } }
```

`.split.narrow` es más específico y la media query no le suma nada a `.split`.
El importador cascadeaba cada bucket por su cuenta, así que la regla de la media
query era la única candidata de su bucket, salía como `max-lg:grid-cols-[1fr]` y
ganaba: el export colapsaba a una columna donde el original no. Nueve páginas de
Can Nicolau, 13,77% de diff en móvil.

Ahora cada bucket se resuelve como lo haría el navegador a esa anchura —reglas
base incluidas, compitiendo por especificidad y orden— y solo se emite lo que
cambia respecto del bucket más ancho. **Regla para el generador:** si quieres que
una media query gane, dale al menos la misma especificidad que la regla base a
la que se enfrenta, o no escribas la variante más específica.

## Pseudo-elementos `::before` / `::after`

| Sí | No |
|---|---|
| `content: "texto literal"` (con escapes `\"`) → capa de texto hija | `content: attr(...)`, `content: url(...)`, contenido con imagen |
| `content: counter(nombre[, decimal\|decimal-leading-zero])` → capa de texto con el valor calculado | `counters()` (multi-nivel), más de un nombre de contador por declaración, `content` con **varias partes concatenadas** (`content: "Paso " counter(step)` — solo se lee el primer valor coincidente) |
| `content: ""` / `none` **sin** texto pero con `background`/`border*`/`box-shadow`/`mask` → capa vacía decorativa con esas propiedades | `content: ""` sin ninguna propiedad visual → no genera nada (correcto, así lo especifica CSS) |
| `counter-reset` / `counter-increment` de una sola página, un solo namespace plano, incremento constante | Contadores anidados por scope real (dos listas independientes con el mismo nombre en la misma página comparten contador) |

`::before`/`::after` ganan sobre el colapso a texto enriquecido: un elemento
que de otro modo colapsaría a una sola capa de texto se queda como
contenedor si su pseudo-elemento genera una capa real.

**Las media queries también valen para un pseudo-elemento.** La cascada de
`::before`/`::after` se resuelve por bucket igual que la de un elemento real,
así que `.nav a.active::after{display:block}` en la hoja base y
`display:none` dentro de `@media (max-width:760px)` salen como
`block … max-md:hidden`, no como un `hidden` incondicional. Antes se
fundían en una sola cascada y ganaba la regla de la media query por ser
posterior en el fichero: el subrayado del enlace activo desaparecía también
en escritorio. Comprobado con Playwright sobre el export de `out-v7`: la capa
del `::after` computa `display:block` a 1440 y `display:none` a 390, lo mismo
que el pseudo-elemento del HTML de entrada.

## Colapso inline → texto enriquecido

Un elemento colapsa a una sola capa de rich-text solo si:

- su tag está en la lista `textish` (`h1`–`h6`, `p`, `span`, `strong`,
  `small`, `td`, `th`, `figcaption`, `dd`), **y**
- todos sus descendientes son de la lista inline (`br`, `strong`, `b`, `em`,
  `i`, `small`, `a`, `span`, `u`, `s`, `sub`, `sup`), sin clase propia, y no
  quedan "blockificados" por CSS — incluyendo ser hijo directo de un
  contenedor `flex`/`grid` (que fuerza su propia línea aunque el hijo no
  declare `display` propio).

**Defecto conocido, medido y no corregido:** un descendiente inline sin
atributo `class` pero alcanzado por un selector (`.pagehero__side dd a
{border-bottom:1px solid …}`) sí colapsa, y al hacerlo el `<a>` pasa a ser una
*marca* de Tiptap, que no lleva clases: pierde su `border-bottom` y se queda
con el subrayado por defecto de Ycode. Es la mayor causa residual que queda
(0,06–0,37% en las secciones `pagehero` y `bg-page`). Se deja sin arreglar a
propósito: bloquear el colapso ante cualquier descendiente con estilo propio
haría que casi ningún enlace del sitio colapsara, y eso reestructura el árbol
entero por 0,4 puntos. **Regla para el generador:** si un enlace dentro de un
párrafo necesita estilo propio, dale una clase — con `class` el importador ya
no colapsa y el enlace conserva su capa.

`<br>` funciona en los dos caminos: en el de rich-text se convierte en un
`hardBreak`, y en el de contenedor genérico (cuando algún descendiente está
blockificado) en un bloque de altura cero que parte las dos tiradas inline en
dos cajas de bloque anónimas. El defecto de la ronda 2 — dos porciones de
texto pegadas sin salto — ya no existe para ningún tag.

## Propiedades CSS e imágenes

| Sí | No / con matices |
|---|---|
| El grueso de layout (flex, grid, position, spacing, tipografía, bordes, sombras, transform, transition) vía utilidades Tailwind arbitrarias | Custom properties (`--token`) se resuelven a su valor literal en el momento de importar — no sobreviven como variable editable |
| `object-fit`, `object-position`, `aspect-ratio` | |
| `padding-top` porcentual (hack de caja de proporción intrínseca) — se traduce como `pt-[N%]`, funciona pero es un patrón antiguo; preferir `aspect-ratio` | |
| Cualquier valor con `min()`/`max()`/`clamp()`/`calc()`/`rgba()` — los espacios internos se escapan (`_`) para no romper la clase Tailwind | `background-clip: text` + `-webkit-text-fill-color: transparent` (gradiente en texto) — se descarta explícitamente, el texto se queda con su color resuelto en vez de quedar invisible |
| `src`/`alt`/`width`/`height` de `<img>` | `<picture>`/`<source>`/`srcset` de autor — solo se lee `src` |
| **Bytes originales de las imágenes** con `RIN5_EXPORT_ORIGINAL_ASSETS=1`: todo asset subido por `rin5-import` sale en `assets/<filename>`, misma ruta y mismo md5 que la entrada, sin query, sin `srcset` y sin `sizes` | Sin esa variable, el export por defecto sirve la foto por el proxy de imágenes (`/a/<hash>/<slug>.jpg?width=…&quality=85` + srcset de siete candidatos). Las rutas cambian y qué candidato pide el navegador depende del DPR, así que un bundle así no es diffable contra el HTML de entrada |
| | **`<svg>` inline dimensionado con `height:100%`.** El importador lo convierte en una capa `icon`, y el renderer le inyecta `style="aspect-ratio:<viewBox>"`, que al ser inline gana a la clase `h-full`: el SVG sale con la altura que dicta su `viewBox`, no la de su contenedor. Medido en el croquis decorativo de `.map-card`: 425px en vez de 449px (0,23–0,41% de las dos secciones "cómo llegar"). Es comportamiento del renderer de Ycode (`getSvgAspectRatioStyle` en `lib/asset-utils.ts`), no del mapeo. Dimensiona los SVG decorativos con `aspect-ratio` explícito, no con `height:100%` |
| **Estilos por defecto del navegador**, sembrados por tag (`p`, `h1`–`h6`, `ul`/`ol`, `dl`/`dd`, `figure`, `blockquote`, `pre`, `hr`, `address`, `strong`/`b`, `th`, `small`, `code`, y la tipografía de `button`/`input`/`select`/`textarea`, que el UA deliberadamente no hereda) | El UA también pone a cero los márgenes de una lista *anidada* (`ul ul{margin:0}`). Eso es contextual, no por tag: una lista dentro de otra recibe un `1em` de más. Evitar listas anidadas |
| El **cromo** de un control de formulario nativo (borde gris de 2px, fondo, padding) **no** se siembra: estila siempre tus `<button>`/`<input>` |  |

## `@font-face` / fuentes

| Sí | No |
|---|---|
| Fuentes de Google Fonts servidas por un `<link href="https://fonts.googleapis.com/css2?family=...">` en el `<head>` de cualquier página — se detectan por URL, no por regla CSS | `@font-face` con archivo propio auto-hospedado — no se lee; si no hay ningún link de Google Fonts, cae a un set fijo (Inter/Bricolage Grotesque/Caveat) que probablemente no es el de tu sitio |

**Los nombres de fuente con dígitos, espacios o acentos ya no son un
problema; la restricción "sin dígitos en el nombre de la fuente" queda
retirada.** Lo era: el generador escribe `--f-body: "Source Sans 3",
system-ui, sans-serif`, el importador resuelve la custom property y quita
todas las comillas (un `"` no cabe dentro de un `class="…"`), y la utilidad
salía como `font-[Source_Sans_3,system-ui,sans-serif]` → `font-family: Source
Sans 3,system-ui,sans-serif`. `3` no es un identificador CSS válido, así que
Chromium descartaba **la declaración entera** y todo el cuerpo caía a la
fuente por defecto de Tailwind. Medido sobre `out-v7`: 7,75% de diff
ponderado global, contra 0,23% con el mismo sitio y un nombre sin dígitos.

`lib/import/css.ts` reescribe ahora la lista: cada familia que no sea un
único identificador CSS válido (`/^-?[A-Za-z][A-Za-z0-9-]*$/`) se emite entre
comillas simples y con `_` por espacio —
`font-['Source_Sans_3',system-ui,sans-serif]`, que Tailwind compila a
`font-family: 'Source Sans 3',system-ui,sans-serif`. Se usan comillas simples
a propósito: sobreviven dentro de un atributo `class="…"`, las dobles no.
Las palabras clave genéricas (`sans-serif`, `system-ui`, `ui-monospace`) y
`-apple-system` sí son identificadores válidos y se dejan **sin** comillas —
entrecomillarlas convertiría una palabra clave en el nombre de una fuente que
nadie tiene instalada.

Comprobado con Playwright sobre el export de `out-v7`:
`getComputedStyle(document.body).fontFamily` da `"Source Sans 3", system-ui,
sans-serif`, idéntico al del HTML de entrada (antes daba la pila
`ui-sans-serif, system-ui, …` de Tailwind).

## Clases de estado que pone el JS

| Sí | No |
|---|---|
| **Reveal on scroll.** `.reveal{opacity:0}` + `.reveal.in{opacity:1;transform:none}` + un IntersectionObserver que añade `in`: el importador resuelve el estado **visible** | Cualquier otra clase de estado. Se lee de la misma hoja, pero solo se le hace caso a `opacity`, `transform` y `visibility` |
| | Estado inicial *oculto* con `display`, `max-height` o `visibility` que el JS abre (`.nav-links.open{display:block}`, acordeones de altura animada): el export se queda en el estado cerrado, que es como carga la página |

Una clase que la hoja comprueba pero que no lleva ningún elemento de ninguna
página se pone desde script. El importador no puede saber cuál de sus estados
es "el" estado, así que solo resuelve las tres propiedades que pueden **hacer
visible** algo: acertar en un menú abierto no vale nada, pero exportar una
sección con `opacity: 0` y sin nadie que se la quite es contenido que el
visitante nunca ve.

Eso era exactamente lo que pasaba antes de la ronda 6. El observador del
`site.js` original no sobrevive al export —Ycode reconstruye el árbol y sus
selectores dejan de casar—, así que los 19 bloques `.reveal` de Hipiclub salían
con `opacity-[0]` horneado y en blanco para siempre. No era un desajuste de
píxeles: era el sitio sin contenido.

**Regla para el generador:** si animas la entrada de un bloque, hazlo con la
pareja `opacity`/`transform` y nada más. Un reveal que además cambie
`display`, `height` o `max-height` se exporta cerrado.

## Scripts / interactividad

| Sí | No |
|---|---|
| El script del menú móvil (`site.js`) se duplica verbatim en `custom_code.body` de cada página; los atributos `data-*`/`aria-*` se copian genéricamente | Cualquier otro script que dependa de la forma exacta del DOM — Ycode reestructura el árbol (envuelve, reordena atributos), así que un selector `document.querySelector('.foo > .bar:nth-child(2)')` puede dejar de coincidir |
| `<details>`/`<summary>` (acordeón nativo). Se mapea al toggle `click`→`display` que Ycode ya tiene: el `<summary>` es el disparador, cada hermano un objetivo que arranca oculto. Cerrado por defecto, abre y cierra con el clic, y el marcador `+` sale de `.faq summary::after` porque esa regla sí casa con un `<details>` cerrado | El marcador **no cambia a `–` al abrir**: el estilado por estado (`details[open] …`) no tiene equivalente. Y un cambio de viewport reaplica el estado inicial, cerrando un panel abierto. Si el `+`/`–` importa, usa dos capas y un toggle de clase en vez del pseudo-elemento |

## Qué gate de fidelidad es razonable

Medido con `scripts/rin5-roundtrip-diff.mjs` sobre `clients/7/site`
(desktop 1440 / mobile 390, 5 páginas de referencia), ronda 2 → ronda 3:

| página | viewport | v3 | v4 |
|---|---|---:|---:|
| index | desktop | 5,36% | 0,03% |
| index | mobile | 18,07% | 0,05% |
| contacto | desktop | 13,45% | 0,04% |
| contacto | mobile | 17,75% | 0,11% |
| permiso-a | desktop | 7,02% | 0,00% |
| permiso-a | mobile | 17,74% | 0,00% |
| permiso-b | desktop | 8,78% | 0,00% |
| permiso-b | mobile | 18,57% | 0,00% |
| permisos | desktop | 11,45% | 0,01% |
| permisos | mobile | 22,46% | 0,03% |

**Global ponderado por área: 11,91% → 0,02%.** De las 86 regiones medidas, 69
salen exactamente a 0,00% y ninguna pasa de 0,41%.

Con estas cifras el gate ya no necesita excepciones por categoría de sección:
**< 1% por sección, sin excluir fotografías ni acordeones**, es alcanzable y
deja margen suficiente para no volverse ruidoso. Las dos únicas causas
residuales conocidas están nombradas arriba con su elemento y su regla:

| Región | Diff | Elemento | Regla |
|---|---:|---|---|
| `index`/`contacto` "cómo llegar" | 0,15–0,41% | `<svg>` decorativo de `.map-card` | `.map-card svg{height:100%}` pierde contra el `aspect-ratio` inline que inyecta el renderer de iconos |
| `pagehero` de páginas internas | 0,06–0,24% | `<a>` dentro de un `<dd>` colapsado a rich-text | `.pagehero__side dd a{border-bottom:1px solid …}` se pierde porque el enlace pasa a ser una marca de Tiptap, sin clases |

Ninguna de las dos es CSS mal mapeado: son consecuencias del modelo de capas.
Las reglas para el generador que se derivan de ellas están en sus secciones.

## Ronda 4, medida sobre `out-v7`

Las cifras de arriba son de `clients/7/site`, escrito a mano. La ronda 4 mide
el sitio que produce hoy el pipeline de generación de rin5
(`~/.rin5/bench/out-v7/run-1/output/site`, 9 páginas), que usa **Source Sans
3** como fuente de cuerpo y tiene el `::after` del enlace de navegación activo
apagado por media query. Los dos defectos que se corrigen en esta ronda están
descritos en sus secciones; ninguno se veía en `clients/7`.

`npm run rin5:roundtrip --schema cliente_a` + `scripts/rin5-roundtrip-diff.mjs`
sobre las 9 páginas, viewports 1440 y 390:

| página | viewport | antes | después |
|---|---|---:|---:|
| index | desktop | 7,35% | 1,20% |
| index | mobile | 10,03% | 0,43% |
| consulta-tus-notas | desktop | 4,71% | 2,59% |
| consulta-tus-notas | mobile | 11,38% | 2,31% |
| contacto | desktop | 4,63% | 2,37% |
| contacto | mobile | 10,01% | 1,83% |
| permiso-a2 | desktop | 7,20% | 2,02% |
| permiso-a2 | mobile | 7,46% | 1,78% |
| permiso-clase-a | desktop | 7,96% | 2,10% |
| permiso-clase-a | mobile | 11,32% | 1,83% |
| permiso-clase-a1 | desktop | 5,14% | 2,11% |
| permiso-clase-a1 | mobile | 10,09% | 1,87% |
| permiso-clase-b | desktop | 8,82% | 2,02% |
| permiso-clase-b | mobile | 9,15% | 1,74% |
| permisos | desktop | 8,37% | 2,42% |
| permisos | mobile | 12,18% | 1,37% |
| test-online-dgt | desktop | 5,17% | 2,74% |
| test-online-dgt | mobile | 11,29% | 2,07% |

**Global ponderado: 7,75% → 1,92%.** El `header.site-header` de las nueve
páginas pasa a 0,00% en escritorio (era donde vivía el subrayado perdido).

**Sigue por encima del gate del 1%**, y lo que queda ya no es tipografía: en
escritorio se concentra en la segunda `section.section` de cada página (5,8–7,7%)
y en `footer.site-footer` (5,3%). No se ha diagnosticado en esta ronda.

## Ronda 5: el búho, medido sobre una generación real

Run `~/.rin5/runtime/generation/188658f6-559a-4590-9ade-8287eb3d3609`
(hípica, 12 páginas), `roundtrip-src` como entrada, schema `rin5_roundtrip`:

| | antes | después |
|---|---:|---:|
| **global ponderado** | **1,41%** | **0,09%** |
| peor región `section.section-tint` | 13,31% (actividades mobile) | 1,19% |
| regiones exactamente a 0,00% | — | 69 de 152 |

Única causa: `.stack > * + * { margin-top: 1rem }` se descartaba por contener
`*`. Peor región que queda, 5,44% (`band-dark` de `momentos-severino` en
mobile); sin diagnosticar.

`out-v7` remedido con este cambio: **1,92%**, idéntico a la ronda 4 — esa hoja
no usa el búho, así que el cambio es neutro ahí.

## Ronda 6: tres generaciones reales por debajo del gate

Tres generaciones seguían muy por encima del 1% tras la ronda 5. Ninguna de las
causas era una propiedad mal mapeada: las cuatro son la cascada resolviéndose
de forma distinta a como la resuelve un navegador.

| # | Causa | Dónde se veía |
|---|---|---|
| 1 | **La media query ganaba a un selector más específico.** Cada bucket cascadeaba solo, así que la regla de la `@media` era la única candidata del suyo y salía siempre | Can Nicolau, `.split.narrow` colapsando a una columna en móvil (13,77%) |
| 2 | **El reset universal `*{margin:0}` se descartaba**, y las semillas del navegador que el importador siembra por tag se quedaban en pie | Natural Equus, la página entera desplazada hacia abajo (13,45%) |
| 3 | **`border` y `margin-inline` no se partían en longhands**, así que shorthand y longhand no competían y decidía el orden de generación de Tailwind | Natural Equus: botones sin borde, y el `.wrap` descentrado (este segundo solo aparece una vez la causa 2 está arreglada) |
| 4 | **El reveal on scroll se exportaba invisible para siempre** | Hipiclub, nueve secciones en blanco (2,63% medido, mucho peor de lo que el número decía) |

### El harness cambió, y hay que decirlo

La causa 4 obligó a tocar el medidor. `scripts/rin5-roundtrip-diff.mjs` recorre
ahora la página entera antes de capturar. Un `fullPage` de un sitio que revela
al hacer scroll era una referencia que no ve nadie: de los 19 bloques `.reveal`
de Hipiclub solo dos habían entrado en el viewport de 1000px, así que 17 se
medían en blanco **en los dos lados** y el diff los daba por buenos.

Eso significa que las cifras de la ronda 6 no son comparables con las de las
rondas 1–5. La tabla de abajo trae por eso las tres columnas: el mismo export de
partida medido con el medidor viejo y con el nuevo, y el export de hoy.

| run | páginas | antes (medidor viejo) | antes (medidor nuevo) | después |
|---|---:|---:|---:|---:|
| lead 13 · Can Nicolau | 18 | 3,67% | 15,57% | **0,25%** |
| lead 26 · Hipiclub | 8 | 2,63% | 11,23% | **0,37%** |
| lead 64 · Natural Equus | 18 | 13,45% | 13,59% | **0,19%** |
| lead 9 · Severino (control) | 11 | 0,09% | — | **0,22%** |
| `out-v7` (control) | 9 | 1,92% | — | **1,94%** |

La columna del medidor nuevo es mucho peor que la del viejo en los dos sitios
con reveal, y prácticamente idéntica en Natural Equus, que no lo usa: es
exactamente lo que tenía que pasar si el medidor viejo estaba tapando contenido
invisible y nada más.

Los dos controles se mueven poco y por el medidor, no por el mapeo. `out-v7`
queda igual (1,92% → 1,94%, ruido) y sigue con lo que la ronda 4 dejó sin
diagnosticar. Severino sube de 0,09% a 0,22%, y **0,107 de esos 0,13 puntos son
una sola región**: el `header.site-header` pegajoso y traslúcido, que el
medidor captura sobre una parte distinta del hero en cada lado. La causa está
en `html{scroll-behavior:smooth}`, que el importador tira: el original vuelve
arriba con una animación y el export salta, así que la referencia se fotografía
a medio camino. Fijar el `scroll-behavior` durante el recorrido lo arregla —y
deja Hipiclub en 0,01% y Natural Equus en 0,01%— pero hace que el export pierda
las fotos de hero que carga en diferido, así que se ha descartado. **Defecto
conocido del medidor, no del importador; sin corregir.**

### Por página y viewport

Todas las páginas del medidor nuevo, antes y después. Ninguna pasa del 2%, y de
las 74 combinaciones página/viewport, 23 quedan exactamente a 0,00%.

| run | peor página/viewport antes | después |
|---|---:|---:|
| lead 13 | index mobile 30,62% | **1,90%** |
| lead 26 | actividades-ecuestres mobile 25,42% | **1,43%** (index mobile 1,98%) |
| lead 64 | index desktop 25,46% | **1,54%** |

Lo que queda se concentra en dos regiones, las mismas en los tres runs:
`section.hero` —la portada a sangre, donde la foto se reescala distinto— y
`header.site-header`, que es el artefacto del `scroll-behavior` descrito arriba.
En Can Nicolau esas dos regiones son las cinco peores de las 274 medidas. No
queda ninguna causa de cascada identificada.

## Ronda 7: una generación nueva, una sola causa

Un run nuevo de la cohorte 2 —lead 26, Hipiclub Internacional, run
`a15ba55c-7684-4f0e-95de-1ff24b923a90`, 18 páginas— fallaba el gate con **8,36%
de diff ponderado**, con las secciones `section--tint` y `section--surface`
entre el 25% y el 38% en los dos viewports a la vez. El segundo run de la misma
cohorte (`a6c7fd5e`, Can Nicolau) resultó tener la misma causa y el mismo
tamaño: 9,19%.

Que *todas* las secciones de *todas* las páginas fallen a la vez, y en los dos
viewports, no es una propiedad mal mapeada: una propiedad rompe una
construcción, no un sitio entero. Era la fuente.

**La hoja trae sus familias con `@import`, no con un `<link>`:**

```css
@import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;…&family=Source+Sans+3:wght@400;500;600;700&display=swap');
```

El importador solo miraba los `<link>` del `<head>`, no encontraba ninguno y
caía al set de reserva (Inter/Bricolage Grotesque/Caveat). El export pedía tres
familias que la hoja no nombra y ninguna de las dos que sí, así que Chromium
renderizaba todo el sitio con los sustitutos locales de `Fraunces` y
`Source Sans 3`.

Con otras métricas de glifo se mueve mucho más que el color del texto:

| | entrada | export (antes) |
|---|---:|---:|
| `.section-head{max-width:62ch}` computado | 496px | 602,9px |
| `<h2>Nuestras noticias y eventos</h2>` | dos líneas | una |

El `ch` es el ancho del `0` de la fuente **que se usa de verdad**, no de la que
pide el CSS. Un `max-width` en `ch` que engorda un 21% cambia dónde parte cada
título, y con él la altura de la cabecera de sección y la posición vertical de
todo lo que va debajo. De ahí que las nueve secciones de la portada diffeasen
juntas.

`lib/import/rin5-html.ts` expone ahora `googleFontsImportHrefs`, que lee las
tres formas que CSS admite (`url('…')`, `url("…")`, `url(…)` y la cadena
suelta), y `scripts/rin5-import.ts` sintetiza el `<link>` correspondiente
cuando el `<head>` no trae ninguno. El set de reserva sigue existiendo, pero ya
solo para una hoja que de verdad no declara fuentes.

### Los sospechosos que no eran

La hoja de Hipiclub usa 16 `grid-template-columns`, 17 `transform`, 11
`clamp()`, 6 `position:absolute`, 6 `::after`, 5 `::before`, 3 `object-fit`, 2
`inset`, 2 `aspect-ratio`, un `position:sticky`, un `backdrop-filter` y 2
`@media`. Ninguno era la causa, y el remedido lo demuestra región por región:
tras la corrección, **227 de las 256 regiones dan exactamente 0,00%**, entre
ellas todas las que contienen esas construcciones:

| Construcción | Dónde vive en esta hoja | Región | Diff |
|---|---|---|---:|
| `::before`/`::after` con `content:""`, `position:absolute` e `inset:0` | `.hero::before` / `.hero::after` (dos velos de degradado sobre la foto) | `section.hero` | 0,00%¹ |
| `::before` decorativo con `position:absolute` y `border-radius:50%` | `.list-check li::before` | `section--dark` | 0,00% |
| `grid-template-columns:repeat(N,1fr)` y `1.4fr 1fr 1fr` | `.grid-3`, `.contact-grid`, `.footer-cols` | `section--tint`, `footer` | 0,00% |
| `aspect-ratio` + `object-fit:cover` | `.card-media`, `.gallery img` | `section--tint` | 0,00% |
| `clamp()` en `padding` y `gap` | `.section`, `.split`, `.hero-inner` | todas | 0,00% |
| `transform` en `:hover` | `.card:hover`, `.btn:hover` | todas | 0,00% |
| `@media (max-width:900px)` y `(max-width:720px)` | los dos únicos escalones | todas | 0,00% |

¹ 0,00% una vez descontado el artefacto del medidor que se explica abajo.

Las dos `@media` de esta hoja caen una en `max-lg:` (900px) y otra en `max-md:`
(720px), y a 1440 y 390 —los dos viewports que mide el gate— coinciden con el
original. Sigue valiendo la advertencia de la ronda 6: entre 720 y 767, y entre
900 y 1023, el export aplica lo que el original todavía no.

### El resto es el medidor, y se ha comprobado

Tras la corrección quedan siete regiones por encima del 0,00% que no son
`header.site-header`, y solo una pasa del 1%. Todas las grandes son la misma
cosa: la cabecera `position:sticky` con `backdrop-filter`, fotografiada sobre
una parte distinta del hero en cada lado porque el original vuelve arriba con
la animación de `html{scroll-behavior:smooth}` y el export salta.

Es el defecto del medidor que la ronda 6 dejó documentado y sin corregir.
Comprobado aquí de la forma más directa posible: quitando esa única línea del
`styles.css` de entrada y midiendo contra **el mismo bundle exportado**,

```text
index                  desktop  0,00%   hipiclub-internacional desktop  0,00%
index                  mobile   0,00%   hipiclub-internacional mobile   0,00%
```

No queda ninguna causa de mapeo en este run.

### Antes y después, con los cinco controles

Todo medido con el mismo medidor (el de la ronda 6), schema `cliente_b`,
viewports 1440 y 390. Los dos primeros son la corrección; los cinco de abajo
solo tenían que no moverse.

| run | páginas | fuentes por | antes | después |
|---|---:|---|---:|---:|
| **lead 26 · Hipiclub · cohorte 2** (`a15ba55c`) | 18 | `@import` | **8,36%** | **0,14%** |
| **lead 13 · Can Nicolau · cohorte 2** (`a6c7fd5e`) | 18 | `@import` | **9,19%** | **0,16%** |
| lead 9 · Severino (control) (`188658f6`) | 11 | `<link>` | 0,22% | 0,23% |
| lead 26 · Hipiclub · cohorte 1 (`bf2fa74c`) | 8 | `<link>` | 0,37% | 0,33% |
| lead 13 · Can Nicolau · cohorte 1 (`de3387f3`) | 18 | `<link>` | 0,25% | 0,27% |
| lead 64 · Natural Equus (control) (`34b48e37`) | 18 | `<link>` | 0,19% | 0,14% |
| `out-v7` (control) | 9 | `<link>` | 1,94% | 1,95% |

Los cinco controles cargan sus familias por `<link>`, así que el cambio no les
toca nada y las diferencias (±0,05 puntos) son el ruido de captura de siempre.
`out-v7` sigue con lo que la ronda 4 dejó sin diagnosticar.

Que **dos** generaciones distintas, de dos negocios distintos y con hojas
distintas, cayeran las dos por la misma causa y se arreglaran las dos con el
mismo cambio es lo que hace creíble el diagnóstico: no es una hoja rara, es lo
que escribe hoy el generador.

### Regla nueva para el generador

`html{scroll-behavior:smooth}` **no se importa** (está en `DROP_PROPS` desde el
principio, junto a `box-sizing`, `counter-reset`, `counter-increment`,
`content`, `-webkit-font-smoothing`, `text-decoration-thickness` y
`text-underline-offset`). No cuesta píxeles reales, pero hace ilegible el gate:
el medidor fotografía el original a medio camino de su scroll de vuelta y toda
cabecera pegajosa sale con un 50–80% de diff que no existe. Escribir el scroll
suave en el `site.js`, no en la hoja.

## La lista PROHIBIDO, para el linter del contrato

Todo lo anterior en un solo sitio y en la forma que necesita un linter de CSS:
un patrón que detectar, por qué se pierde, y **la construcción concreta que sí
se importa**. Cada fila remite a la sección de arriba donde está la medida.

Tres categorías, y conviene no mezclarlas:

- **Se descarta** — el importador tira la regla entera o la propiedad. El
  export renderiza otra cosa. Error del linter.
- **Se deforma** — la regla llega, pero no significa lo mismo. Error del linter
  salvo que el generador acepte explícitamente el corte.
- **Se pierde en el modelo de capas** — no hay equivalente en Ycode. Error del
  linter; la alternativa siempre reestructura el HTML, no solo el CSS.

### Selectores

| # | PROHIBIDO | Qué pasa | En su lugar |
|---|---|---|---|
| S1 | `::selection`, `::placeholder`, `::marker`, `::first-line`, `::first-letter` | se descarta la regla | nada equivalente; no estilar esos pseudo-elementos |
| S2 | `:focus-visible`, `:active` | se descarta la regla | solo `:hover` |
| S3 | `:hover` en un ancestro (`.card:hover img`, `.card:hover .card-link::after`) | se descarta la regla: solo cuenta el `:hover` en el **sujeto** | poner el `:hover` en el propio elemento que cambia (`.card-link:hover`) |
| S4 | universal combinado sin anclar: `* + *`, `* > *` | se descarta la regla | anclarlo en una clase: `.stack > * + *` |
| S5 | un `@` dentro del selector | se descarta la regla (artefacto de parseo) | — |

`*{margin:0}` a secas **sí** entra, con especificidad 0. El búho anclado
(`.stack > * + *`) también.

### At-rules y breakpoints

| # | PROHIBIDO | Qué pasa | En su lugar |
|---|---|---|---|
| M1 | `@media (min-width: …)` | se descarta la regla entera | reescribir en `max-width` (diseño desktop-first) |
| M2 | `@media (min-width:A) and (max-width:B)`, `orientation`, `hover`, `pointer`, `prefers-reduced-motion` | se descarta la regla entera | un solo `max-width` |
| M3 | `@media (max-width: N)` con **N > 1200px** | se descarta la regla entera | 1023px |
| M4 | más de **dos** escalones de breakpoint en toda la hoja | solo hay dos buckets (`max-md:` 767px, `max-lg:` 1023px); tres escalones se funden en dos y gana el último de cada bucket | exactamente dos: `767px` y `1023px` |
| M5 | cualquier `max-width` que no sea 767px o 1023px | el corte se mueve al del bucket: un `@media(max-width:900px)` ya aplica a 1000px en el export | escribir 767 y 1023 |
| M6 | `@supports`, `@keyframes`, `@container`, cualquier otro at-rule | se descarta | `transition`, que sí se mapea |
| M7 | una regla dentro de `@media` **menos específica** que la regla base a la que se enfrenta (`@media{.split{…}}` contra `.split.narrow{…}`) | correcto desde la ronda 6, pero solo si la especificidad es la que quieres: la media query **no** suma especificidad | darle a la variante móvil al menos la misma especificidad que la base |

`@import url('https://fonts.googleapis.com/css2?…')` **sí** entra desde la
ronda 7, igual que un `<link>` en el `<head>`.

### Pseudo-elementos y contadores

| # | PROHIBIDO | Qué pasa | En su lugar |
|---|---|---|---|
| P1 | `content: attr(…)`, `content: url(…)`, `content` con imagen | no genera capa | texto literal, o un `<img>` de verdad |
| P2 | `content` con varias partes (`content: "Paso " counter(step)`) | solo se lee el primer valor: sale `"Paso "` **o** el número, no los dos | dos pseudo-elementos, o el prefijo en el HTML |
| P3 | `counters()` multinivel, más de un contador por declaración | no se resuelve | un solo `counter(nombre)` plano |
| P4 | dos listas independientes con el mismo nombre de contador en una página | el namespace es plano: comparten cuenta | un nombre de contador por lista |
| P5 | `content: ""` **sin** ninguna propiedad visual | no genera nada (correcto según CSS, pero suele ser un error del generador) | quitar la regla, o darle `background`/`border`/`box-shadow`/`mask` |

`content:""` con `position:absolute`, `inset:0` y un `background` **sí** entra:
es como están hechos los dos velos del hero de Hipiclub y salen a 0,00%.

### Propiedades

| # | PROHIBIDO | Qué pasa | En su lugar |
|---|---|---|---|
| C1 | `background-clip:text` + `-webkit-text-fill-color:transparent` | se descarta a propósito; el texto se queda con su color resuelto (si no, quedaría invisible) | color plano |
| C2 | `box-sizing`, `scroll-behavior`, `-webkit-font-smoothing`, `text-decoration-thickness`, `text-underline-offset` | se descartan siempre (`DROP_PROPS`) | `box-sizing` ya lo pone el preflight; el scroll suave, al `site.js` (ronda 7) |
| C3 | `@font-face` con fichero propio auto-hospedado | no se lee; se cae al set de reserva y **todo** el sitio cambia de métricas (8,36% medido) | Google Fonts, por `<link>` en el `<head>` o por `@import` en la hoja |
| C4 | `<picture>`, `<source>`, `srcset` de autor | solo se lee el `src` | un `<img src>` con `width`/`height` |
| C5 | `<svg>` inline dimensionado con `height:100%` | el renderer de iconos le inyecta un `aspect-ratio` inline que gana a `h-full`: sale con la altura de su `viewBox` | `aspect-ratio` explícito en el SVG |
| C6 | listas anidadas (`ul ul`) | el UA pone a cero los márgenes de la lista interior de forma contextual, y el importador siembra por tag: la lista anidada recibe `1em` de más | una sola lista, o `<div>` con clase |
| C7 | `<button>`/`<input>`/`<select>`/`<textarea>` sin estilar | el cromo nativo (borde gris de 2px, fondo, padding) **no** se siembra | estilar siempre borde, fondo y padding |
| C8 | tratar una custom property como token editable después del import | `var(--token)` se resuelve al literal al importar; no sobrevive como variable | asumirlo: el CSS exportado lleva valores, no tokens |

`clamp()`, `min()`, `max()`, `calc()`, `rgba()`, `grid-template-columns`,
`transform`, `position:absolute`/`sticky`, `inset`, `aspect-ratio`,
`object-fit`, `backdrop-filter` y `padding-top` porcentual **sí** entran, todos
comprobados a 0,00% en la ronda 7.

### Estado, interactividad y estructura

| # | PROHIBIDO | Qué pasa | En su lugar |
|---|---|---|---|
| E1 | un reveal on scroll que además cambie `display`, `height` o `max-height` | solo se resuelven `opacity`, `transform` y `visibility`: el bloque se exporta cerrado y el visitante no lo ve nunca | la pareja `opacity` + `transform`, y nada más |
| E2 | cualquier otra clase de estado que ponga el JS (`.nav-links.open{display:block}`, acordeones de altura animada) | el export se queda en el estado con que carga la página | `<details>`/`<summary>`, que sí tiene equivalente |
| E3 | estilar por estado abierto: `details[open] summary::after{content:"–"}` | no hay equivalente; el marcador se queda en `+` | dos capas y un toggle de clase |
| E4 | un `<a>` con estilo propio dentro de un `<p>`/`<dd>` **sin** atributo `class` | el elemento colapsa a rich-text y el enlace pasa a ser una marca de Tiptap, que no lleva clases: pierde su `border-bottom`/color | darle una clase al `<a>`: con `class` ya no colapsa |
| E5 | cualquier script que dependa de la forma exacta del DOM (`document.querySelector('.foo > .bar:nth-child(2)')`) | Ycode reestructura el árbol y el selector deja de casar | solo el `site.js` del menú móvil, que se copia verbatim, y selectores por `data-*` |

### Lo que el linter no puede ver, y hay que recordar aparte

- **El id de capa cambia en cada import.** `bundleSha256` de `roundtrip.json`
  no es reproducible; no sirve para comprobar determinismo.
- **El gate se mide a 1440 y 390.** Un fallo de M4/M5 no aparece en el número:
  vive en las anchuras intermedias. El linter es la única defensa.
- **`html{scroll-behavior:smooth}` no cuesta píxeles pero rompe la medida.**
  Cualquier cabecera `position:sticky` sale con 50–80% de diff falso.
