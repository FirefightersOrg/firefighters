# Select

Lista desplegable nativa para elegir una opción entre 4 y ~15.

## Qué provee quien lo usa

- `options`: strings u objetos `{ value, label, disabled }`.
- `placeholder`: primera opción vacía no seleccionable («Elegir…»).
- Atributos de `<select>` (`value`, `onChange`, `name`).

## Reglas

- Hasta 3 opciones: `RadioGroup`. Más de ~15 o con búsqueda: combobox.
- Ordenar opciones de forma lógica (frecuencia, orden natural) o alfabética.
