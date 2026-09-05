# El subset que `rin5-import` reproduce fielmente

> Contrato para el generador de rin5 (G9, P-2609): lo que este importador
> representa 1:1, y lo que no. El generador solo debe escribir HTML/CSS
> dentro de la columna "sí" — cualquier cosa en la columna "no" se pierde o se
> deforma en el round-trip import → export, con independencia de lo bien
> escrito que esté el HTML fuente.
>
> Medido sobre `clients/7/site` (autoescuela, 9 páginas) con
> `scripts/rin5-roundtrip-diff.mjs`. Estado a 2026-09-05, tras la ronda 3:
> **0,02% de diff ponderado global, ninguna sección por encima de 0,41%**
> (venía de 11,91% / 49,70%). Evidencia en
> `~/.rin5/ycode-roundtrip/7-v4/diff-sections/`.

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
   `margin`/`padding` se expanden ahora a longhands al parsear.
3. **El atributo `style` no estaba en la cascada**, se pegaba detrás como
   clases más. Ahora entra por encima de todo selector.
4. **`<details>`/`<summary>`** ya tiene equivalente (ver más abajo).

## Selectores

| Sí | No |
|---|---|
| Clase única, cadenas de clases, combinadores descendente/hijo/hermano, atributos (`[data-x]`), `:hover` **solo en el sujeto** (`.btn:hover`, no `.card:hover img`) | `::selection`, `::placeholder`, `::marker`, `::first-line`, `::first-letter` |
| `::before` / `::after` (ver abajo) | `:focus-visible`, `:active` |
| Selector universal `*` como parte del selector | igual, se descarta la regla entera |
| Cualquier selector que el motor de matching (`Element.matches()`) resuelva, dentro de lo anterior | Selectores con `@` embebido (artefactos de parseo) |

La resolución de cascada (especificidad, orden de declaración) es real —
usa el DOM, no una aproximación — así que dentro de lo soportado el ganador
por propiedad es el mismo que en un navegador. Tres capas, de menos a más
peso: estilos por defecto del navegador (sembrados por tag) → reglas de la
hoja por especificidad y orden de declaración → atributo `style`. `!important` viaja pegado al
valor, no altera el orden.

## `@media`

| Sí | No |
|---|---|
| `@media (max-width: Npx)`, mapeado a `max-lg:` (≤1200px) o `max-md:` (≤767px) de Tailwind — **aproximado**, no exacto: un `@media(max-width:720px)` del original y el `max-md:` de Tailwind (≈767px) no cortan en el mismo pixel | `@media (min-width: …)` — se descarta la regla entera |
| | `@supports`, `@keyframes`, `@container`, cualquier otro at-rule |
| | `prefers-reduced-motion` — se descarta explícitamente |

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
