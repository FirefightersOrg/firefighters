# Checkbox

Casilla para una opción independiente o una confirmación explícita.

## Qué provee quien lo usa

- `label`, `description` (opcional) y atributos de `<input type="checkbox">` (`checked`, `onChange`, `name`).

## Cuándo usar

- Opciones que se pueden combinar entre sí.
- Listas de verificación antes de operaciones riesgosas: el botón de confirmar se activa al marcarlas todas.
- Para activar algo con efecto inmediato, usar un interruptor; la casilla se aplica al enviar.

## Reglas

- La etiqueta afirma, no niega («Enviar comprobante», no «No enviar comprobante»).
- Toda la fila (casilla + texto) es clicable.
