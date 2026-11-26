> Fuente: artifact de sistema de diseño Cimiento (https://claude.ai/artifact/WPs1jbtm48V6AUL7xjCqfA, privado). Copiado el 2026-11-24 como fuente de verdad versionada de la Fase 15 (adopción del sistema de diseño). `tokens.json` es la fuente de `src/lib/styles/tokens.css`.

Cimiento es un sistema de diseño para aplicaciones de gestión en español: paneles de administración, formularios largos, tablas densas, registros con historial y operaciones que no se pueden deshacer. No pertenece a ningún dominio: los mismos componentes sirven para campañas, inventarios, socios, turnos o facturación.

Tres principios guían cada decisión:

1. **Claridad antes que decoración.** Una sola acción principal por vista, jerarquía tipográfica antes que color, y color solo cuando comunica estado.
2. **Datos que se leen de un vistazo.** Cifras tabulares, alineación a la derecha, códigos en monoespaciada, estados con ícono y palabra.
3. **Errores difíciles, recuperación fácil.** Confirmar lo irreversible, explicar qué pasó y qué hacer, nunca perder lo que la persona escribió.

## Contenido y tono

**Idioma.** Toda la interfaz está en español. Usar un español neutro y profesional; si un producto adopta una variante regional (por ejemplo, voseo rioplatense: «Ingresá», «Revisá»), aplicarla en toda la interfaz sin mezclar formas.

**Persona gramatical.** Evitar la segunda persona cuando no hace falta: los botones van en infinitivo y los mensajes en forma impersonal.

| Hacer                                                        | Evitar                      |
| ------------------------------------------------------------ | --------------------------- |
| Guardar cambios                                              | Guarde sus cambios / Guardá |
| No se pudo guardar. Revisar la conexión y volver a intentar. | Error 500                   |
| Anular registro                                              | Sí / Aceptar                |
| Sin resultados para «Pérez»                                  | No data                     |

**Mayúsculas.** Tipo oración en todo: títulos, botones, etiquetas, pestañas («Datos generales», no «Datos Generales»). Las mayúsculas sostenidas solo en siglas (DNI, CUIT, CSV). Las mayúsculas llevan tilde: «Última actualización».

**Signos.** Abrir siempre las preguntas y exclamaciones: «¿Anular la campaña?». Comillas latinas «» para citar valores ingresados. Sin signos de exclamación en mensajes de error.

**Botones.** Verbo + objeto, máximo tres palabras: «Crear campaña», «Importar archivo», «Descargar CSV». En confirmaciones, el botón repite la acción del título («¿Anular 3 registros?» → «Anular registros»), nunca «Sí» o «Aceptar».

**Mensajes de error.** Qué pasó + qué hacer, en una o dos oraciones: «El número 0457 ya está asignado. Elegir otro o liberar el registro anterior.» Junto al campo, no solo arriba del formulario.

**Estados vacíos.** Qué es esta sección + cómo empezar: «Todavía no hay importaciones. Subir un archivo CSV o XLSX para cargar registros en lote.»

**Formato de datos (configuración regional `es`).** Formatear siempre con `Intl` y la configuración regional del producto (por ejemplo `es-AR`):

- Números: punto para miles y coma decimal — `1.284.500,75`.
- Moneda: símbolo, espacio y cifra — `$ 1.284.500`. Sin decimales cuando son siempre cero.
- Fechas: `24/11/2026`; en texto, «24 de nov. de 2026». Meses y días en minúscula.
- Horas: 24 h — `18:05`.
- Relativos solo para menos de 7 días: «hace 5 min», «ayer».
- Documentos y códigos: tal como se cargaron, en `code`.

## Fundamentos visuales

### Color

Rediseño (2026-11, aprobado en #50): papel (`bg` `#f7f7f5`) para el fondo, tinta (`text` `#1a1d21`) para el texto y marino (`primary` `#1d3557`) como único color de acción. Dos tokens de identidad se usan con cuentagotas:

- `brand` (rojo autobomba `#b42318`): **solo** la marca de la institución en el `AppHeader` y la franja del talón del bono (`BondStub`). Nunca para acciones ni errores (para eso está `danger`).
- `accent` (amarillo reflectivo `#f5c518`): subrayado del ítem de navegación activo (junto con peso 600, nunca solo color) y halo decorativo del foco. Nunca como fondo de texto ni como única señal.

El color de estado está reservado para estados.

- Fondo de página `bg`; todo contenido vive sobre `surface` (tarjetas, tablas, formularios).
- Texto principal en `text`; secundario en `text-muted`; placeholders y numeración en `text-subtle`, solo sobre `surface` y `bg`.
- `primary` para la acción principal, enlaces y selección. Un solo botón `primary` por vista; el resto `secondary` o `ghost`.
- `primary-soft` marca lo seleccionado (fila, hover de navegación). El ítem activo del `AppHeader` usa el subrayado `accent` y peso 600.
- Estados: cada uno tiene `*-soft` (fondo), `*-text` (texto sobre ese fondo) y el color base (ícono y borde). Éxito `success`, advertencia `warning`, error/destructivo `danger`, informativo `primary`, neutral `neutral-soft` + `text-muted`.
- Ningún estado se comunica solo por color: siempre marca y palabra («Activa», «Anulada»), y la marca del `Badge` cambia de forma con el tono (redonda, rombo para advertencia, cuadrada para un problema).
- `border` es decorativo (divisores); los controles usan `border-strong`, que cumple 3:1.
- Todos los pares de texto cumplen 4,5:1 en los temas Claro y Oscuro. `text-disabled` está exento y siempre va acompañado de otra señal.

### Tema oscuro

El rediseño todavía no cambió la paleta oscura (sigue el azul claro `#86a6ff` para `primary`); solo `focus` (amarillo), `brand` y `accent` tienen valores nuevos. Alinearla con el marino queda como seguimiento.

Cada token tiene valor para `light` y `dark`. No se invierte el color a mano: siempre se usa el token. En oscuro, `primary` se aclara y su texto (`on-primary`) se oscurece; por eso nunca usar `#fff` literal sobre un color de marca. La sombra pierde fuerza en oscuro, así que `shadow-lg` suma un filete de 1px.

### Tipografía

**IBM Plex Sans** para la interfaz e **IBM Plex Mono** para códigos, autoalojadas con `@fontsource` (pesos 400, 500, 600; el negrito usa 600). **IBM Plex Sans Condensed 700** (`font-figure`, tamaños `text-figure` 26 px y `text-figure-lg` 34 px) solo para cifras principales y números de bono. Plex cubre todo el español (tildes, ñ, ¿¡) y tiene cifras tabulares.

- Un `heading-1` por vista. `heading-2` para secciones y diálogos, `heading-3` para tarjetas.
- Cuerpo en `body` (15/24). Campos en `input` (16px: evita el zoom automático en iOS).
- Etiquetas, botones y encabezados de tabla en `label`. Ayudas y errores en `body-sm`.
- Cifras: `font-variant-numeric: tabular-nums` en tablas, totales y contadores; `number-lg` para KPIs (con `font-figure`); el monto principal de una vista en `text-figure-lg`.
- Códigos de barras, números de serie e identificadores en `code`.
- Ancho de párrafo máximo `prose-max` (68 caracteres).

### Espaciado y grilla

Escala de 4px (`space-0` … `space-16`). Dentro de un componente: `space-1` a `space-3`. Entre campos: `space-5`. Entre secciones: `space-8`. Padding de tarjetas: `space-6` en escritorio, `space-4` en móvil. Contenido limitado a `content-max`; formularios de una columna a `form-max`.

### Tamaños y área táctil

Controles de `control-md` (40px) por defecto, `control-sm` en barras de herramientas de tablas, `control-lg` para la acción principal en móvil. En pantallas táctiles toda área clicable mide al menos `touch-target` (44px).

### Radios, bordes y sombras

`radius-md` para controles, `radius-lg` para tarjetas y diálogos, `radius-sm` para badges, `radius-full` para puntos de estado. Las tarjetas se separan con `border` + `shadow-sm`; las capas flotantes con `shadow-lg` sobre `surface-raised`. Nada de sombras en elementos planos dentro de una tarjeta.

### Estados de interacción

| Estado        | Tratamiento                                                                                                                                                                                                                                                                                                                                             |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hover         | Fondo `surface-hover` (filas, ghost) o `*-hover` (botones con relleno).                                                                                                                                                                                                                                                                                 |
| Foco          | `outline` de 2px con 2px de separación, solo con teclado (`:focus-visible`): marino en claro (12,4:1) y amarillo en oscuro (11,7:1). En claro se suma un halo `accent` de 6px, decorativo: el contraste lo garantiza el `outline`, que ningún componente pisa (las sombras propias de un control sí tapan el halo). Nunca quitar el foco sin reemplazo. |
| Deshabilitado | Fondo `surface-sunken`, texto `text-disabled`, cursor `not-allowed`. Preferir explicar por qué antes que deshabilitar.                                                                                                                                                                                                                                  |
| Cargando      | Spinner dentro del botón, el ancho no cambia, `aria-busy`.                                                                                                                                                                                                                                                                                              |
| Inválido      | Borde `danger` + mensaje en `danger-text` debajo del campo, enlazado con `aria-describedby`.                                                                                                                                                                                                                                                            |
| Solo lectura  | Fondo `surface-sunken`, texto `text`, sin borde fuerte. Se puede seleccionar y copiar.                                                                                                                                                                                                                                                                  |

### Movimiento

Transiciones de 120 ms (hover, color) y 200 ms (diálogos, avisos), curva `cubic-bezier(0.2, 0, 0, 1)`. Respetar `prefers-reduced-motion`: sin desplazamientos, solo opacidad.

### Capas

`z-sticky` < `z-dropdown` < `z-overlay` < `z-modal` < `z-toast`. No usar valores sueltos.

## Patrones

**Formularios.** Una columna; etiqueta arriba del campo; marcar lo opcional («(opcional)») en vez de lo obligatorio cuando la mayoría lo es. Validar al salir del campo y al enviar; al enviar con errores, mostrar una `Alert` de resumen arriba que enlaza a cada campo y llevar el foco al primero. Botones al final, alineados a la izquierda, la principal primero.

**Tablas.** Encabezado `surface-sunken` y fijo; números y montos alineados a la derecha en tabular; estados con `Badge`; acciones de fila al final. Más de 50 filas: paginar o filtrar. En móvil, desplazamiento horizontal dentro de la tarjeta, nunca de la página.

**Acciones irreversibles.** Anular, eliminar, restaurar una copia: siempre `Dialog` de confirmación con el objeto nombrado y la consecuencia. Si la acción es grave (afecta a muchos registros), pedir un motivo o una casilla de confirmación.

**Registros con secciones.** Una ficha larga se divide en `Section` numeradas con un índice de anclas arriba.

**Avisos.** `Alert` para mensajes que viven en la página; `Toast` para confirmar una acción que ya ocurrió («Cambios guardados») o avisos del sistema («Nueva versión disponible»). Los errores bloqueantes nunca van en un `Toast`.

## Iconografía

Íconos de trazo, 24×24 de grilla, trazo de 1,75px, puntas redondeadas, en `currentColor`; se muestran a `icon-sm` (16px) o `icon-md` (20px). El paquete incluye un conjunto mínimo (`Icon`: check, info, alert, error, x, chevron-down, plus, search, inbox, download, menu). Para más, usar **Lucide** (licencia ISC), que comparte la misma geometría. Sin emoji en la interfaz. Un ícono sin texto lleva `aria-label`; uno junto a texto lleva `aria-hidden`.

## Marca

La marca es una barra vertical `brand` (10 × 28 px, decorativa, `aria-hidden`) delante del nombre del producto, que se compone en `heading-3` con IBM Plex Sans 600 dentro del `AppHeader`. El único otro uso del rojo `brand` es el talón del bono ganador (`BondStub`). Cada producto que adopte el sistema puede cambiar `brand`, `accent` y el tono de `primary`/`primary-hover`/`primary-soft`/`primary-text`/`focus` manteniendo los contrastes.

## Accesibilidad (mínimos)

- Contraste AA en ambos temas (ya garantizado por los tokens).
- Todo se opera con teclado; orden de foco = orden visual.
- Cada campo tiene `<label>`; ayudas y errores enlazados con `aria-describedby`; `aria-invalid` en campos con error.
- Alertas de error con `role="alert"`; avisos y confirmaciones con `role="status"`.
- Diálogos con `aria-modal`, foco atrapado y devuelto al cerrar; `Esc` cierra.
- `lang="es-AR"` en el documento.
