# Card

Contenedor de un bloque de contenido relacionado sobre `surface`.

## Qué provee quien lo usa

- `children`; `title`, `description`, `actions` (cabecera); `footer` (acciones de formulario).
- `flush`: sin padding interno (para tablas o estados vacíos de borde a borde).
- `as`: elemento (`section`, `article`…).

## Reglas

- No anidar tarjetas: dentro de una tarjeta, separar con espacio o divisores.
- Pares etiqueta/valor con `<dl className="cm-dl">`.
