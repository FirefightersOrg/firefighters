# Dialog

Ventana modal para confirmar una acción o pedir un dato puntual sin salir de la página.

## Qué provee quien lo usa

- `open`, `onClose`, `onConfirm`, `title` (pregunta con la acción y el objeto: «¿Anular 3 registros?»), `description` (consecuencia), `confirmLabel` (repite la acción), `cancelLabel` (por defecto «Cancelar»), `tone` `default | danger`, `loading`, `confirmDisabled`, `children` (campos extra).

## Reglas

- Para acciones irreversibles: `tone="danger"`; el foco inicial va a «Cancelar».
- Decir qué se pierde y si se puede deshacer.
- `Esc` y clic en el velo cierran; el foco queda atrapado y vuelve al disparador.
- En móvil los botones ocupan el ancho completo, la acción arriba.
- No anidar diálogos ni usarlos para contenido largo.
