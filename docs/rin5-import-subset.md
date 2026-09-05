# El subset que `rin5-import` reproduce fielmente

> Contrato para el generador de rin5 (G9, P-2609): lo que este importador
> representa 1:1, y lo que no. El generador solo debe escribir HTML/CSS
> dentro de la columna "sí" — cualquier cosa en la columna "no" se pierde o se
> deforma en el round-trip import → export, con independencia de lo bien
> escrito que esté el HTML fuente.
>
> Medido sobre `clients/7/site` (autoescuela, 9 páginas) con
> `scripts/rin5-roundtrip-diff.mjs`. Estado a 2026-09-05, tras las tres
> rondas de fixes de este documento (pseudo-elementos, colapso inline/bloque,
> escapado de espacios en valores arbitrarios, `<dd>`+`<br>`).

## Selectores

| Sí | No |
|---|---|
| Clase única, cadenas de clases, combinadores descendente/hijo/hermano, atributos (`[data-x]`), `:hover` **solo en el sujeto** (`.btn:hover`, no `.card:hover img`) | `::selection`, `::placeholder`, `::marker`, `::first-line`, `::first-letter` |
| `::before` / `::after` (ver abajo) | `:focus-visible`, `:active` |
| Selector universal `*` como parte del selector | igual, se descarta la regla entera |
| Cualquier selector que el motor de matching (`Element.matches()`) resuelva, dentro de lo anterior | Selectores con `@` embebido (artefactos de parseo) |

La resolución de cascada (especificidad, orden de declaración) es real —
usa el DOM, no una aproximación — así que dentro de lo soportado el ganador
por propiedad es el mismo que en un navegador.

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

Fuera de esa lista de tags (`li`, `dt`, `address`, contenedores genéricos con
texto + `<br>` mezclado), un `<br>` se descarta sin más y las dos porciones
de texto quedan pegadas sin salto de línea ni espacio — visto y corregido
para `dd` en esta ronda; **cualquier otro tag con el mismo patrón sigue
teniendo este defecto** y debe evitarse en el generador (usar `<p>` separados
en vez de `<br>` dentro de un tag fuera de la lista).

## Propiedades CSS e imágenes

| Sí | No / con matices |
|---|---|
| El grueso de layout (flex, grid, position, spacing, tipografía, bordes, sombras, transform, transition) vía utilidades Tailwind arbitrarias | Custom properties (`--token`) se resuelven a su valor literal en el momento de importar — no sobreviven como variable editable |
| `object-fit`, `object-position`, `aspect-ratio` | |
| `padding-top` porcentual (hack de caja de proporción intrínseca) — se traduce como `pt-[N%]`, funciona pero es un patrón antiguo; preferir `aspect-ratio` | |
| Cualquier valor con `min()`/`max()`/`clamp()`/`calc()`/`rgba()` — los espacios internos se escapan (`_`) para no romper la clase Tailwind | `background-clip: text` + `-webkit-text-fill-color: transparent` (gradiente en texto) — se descarta explícitamente, el texto se queda con su color resuelto en vez de quedar invisible |
| `src`/`alt`/`width`/`height` de `<img>` | `<picture>`/`<source>`/`srcset` de autor — solo se lee `src` |
| | **Los bytes de la imagen se reprocesan.** El export sirve la foto a través del pipeline de imágenes de Ycode (`?width=…&quality=85`, srcset propio) — nunca es bit-a-bit idéntica a la original aunque el recorte/aspect-ratio sea idéntico. Cualquier gate de píxeles debe tratar las regiones fotográficas aparte (ver más abajo) |

## `@font-face` / fuentes

| Sí | No |
|---|---|
| Fuentes de Google Fonts servidas por un `<link href="https://fonts.googleapis.com/css2?family=...">` en el `<head>` de cualquier página — se detectan por URL, no por regla CSS | `@font-face` con archivo propio auto-hospedado — no se lee; si no hay ningún link de Google Fonts, cae a un set fijo (Inter/Bricolage Grotesque/Caveat) que probablemente no es el de tu sitio |

## Scripts / interactividad

| Sí | No |
|---|---|
| El script del menú móvil (`site.js`) se duplica verbatim en `custom_code.body` de cada página; los atributos `data-*`/`aria-*` se copian genéricamente | Cualquier otro script que dependa de la forma exacta del DOM — Ycode reestructura el árbol (envuelve, reordena atributos), así que un selector `document.querySelector('.foo > .bar:nth-child(2)')` puede dejar de coincidir |
| | `<details>`/`<summary>` (acordeón nativo) — **no tiene equivalente en el modelo de capas de Ycode**. Se aplana a un contenedor estático: el export muestra todas las respuestas del FAQ permanentemente abiertas, sin el toggle +/–. Es la causa individual de mayor impacto que queda sin resolver tras esta ronda (39–50% de diff en la sección FAQ). Evitar `<details>` en el generador; usar un componente de acordeón basado en clase/JS si se necesita ese patrón |

## Qué gate de fidelidad es razonable

Con las cuatro correcciones de esta ronda (síntesis de `::before`/`::after`
con `content`, colapso inline/bloque consciente del contexto flex/grid,
escapado de espacios en cualquier valor arbitrario Tailwind, y `<dd>` con
`<br>` por el camino de rich-text), medido con
`scripts/rin5-roundtrip-diff.mjs` sobre `clients/7/site` (desktop 1440 /
mobile 390, 5 páginas de referencia):

- El **header** pasa de 9.9–30.8% a **0.00%** en desktop en las 5 páginas.
- Las secciones sin foto ni acordeón bajan de 26–47% a **0.3–9.6%** en
  desktop (ej. `index` `bg-sand`/`bg-sand-2`: 37.6%/26.7% → 0.7%/0.8%).
- El overall ponderado por área baja de **27.3% → 11.9%**.
- Lo que queda por encima del 1% tiene dos causas concretas y no una
  regresión de CSS: fotografías reprocesadas (`object-fit`/`aspect-ratio`
  correctos, bytes distintos) y el FAQ con `<details>` sin equivalente en
  Ycode. Un gate por secciones debería, o bien excluir las regiones
  fotográficas y el `<details>` de la medición de píxeles y verificarlas por
  separado (dimensiones/aspect-ratio para la foto, presencia de las 4
  preguntas para el FAQ), o bien aceptar un umbral más alto solo para esas
  dos categorías de sección.
