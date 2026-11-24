# Toast

Aviso flotante breve que confirma algo que ya ocurrió.

## Qué provee quien lo usa

- `children`: una oración corta en pasado o estado («Cambios guardados»).
- `tone`: `success` (por defecto), `info`, `warning`, `danger`.
- `action`: un único `Button size="sm"` («Deshacer», «Recargar»).
- `onDismiss`; `inline` para renderizarlo en el flujo (por defecto se fija abajo y centrado).

## Reglas

- Desaparece a los 5 s salvo que tenga acción; con acción, queda hasta que se cierre.
- Nunca para errores que requieren corregir algo: eso es un `Alert`.
- Uno a la vez.
