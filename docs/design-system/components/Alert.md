# Alert

Mensaje que vive dentro de la página, relacionado con su contenido.

## Qué provee quien lo usa

- `tone`: `info | success | warning | danger`.
- `title` (opcional, una línea) y `children` (qué pasó y qué hacer).
- `actions`: uno o dos `Button size="sm"`.
- `onDismiss`: muestra el botón de cerrar. No usar en errores que bloquean.

## Reglas

- Errores de formulario: un `Alert` `danger` arriba con enlaces a cada campo + el error junto a cada campo.
- `danger` se anuncia de inmediato (`role="alert"`); los demás con `role="status"`.
- No apilar más de dos alertas; si hay más, resumir.
