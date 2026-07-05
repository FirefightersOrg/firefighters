# Decisiones y preguntas abiertas

## Objetivo

Este documento separa las decisiones ya tomadas de las dudas que siguen abiertas. Sirve como registro de criterios para no bloquear el diseno funcional y tecnico del sistema.

## Decisiones cerradas

### Plataforma del MVP

El MVP sera una webapp instalable tipo PWA.

Stack definido:

```txt
SvelteKit + TypeScript + Supabase + PWA
```

Quedan fuera del MVP:

- Tauri.
- Rust.
- Backend propio complejo desde el dia 1.

### Numeracion por campana

La cantidad de cifras no sera una regla global del sistema. Sera configuracion de cada campana.

Configuracion inicial para el MVP:

```txt
number_digits = 4
max_number = 9999
associated_number_offset = 4871
overflow_policy = reject
```

Ejemplo de campana futura con 5 cifras:

```txt
number_digits = 5
max_number = 99999
associated_number_offset = 4871
overflow_policy = reject
```

Regla:

```txt
numero_asociado = numero_base + associated_number_offset
```

Para el MVP, si `numero_asociado > max_number`, la carga se bloquea.

### Ceros a la izquierda

Los ceros a la izquierda deben conservarse visualmente.

El sistema debe diferenciar:

```txt
valor interno: 68
valor visible: 0068
cantidad de cifras de campana: 4
```

No se debe hardcodear `padStart(4)`. El formateo debe usar la configuracion de la campana.

### Unicidad de numeros participantes

Dentro de una misma campana, un numero participante no puede apuntar a mas de un bono.

Numero participante incluye:

- Numero base.
- Numero asociado.
- Numeros base incluidos en patas.
- Numeros asociados de patas.
- Numeros extraordinarios si se implementan como numeros persistidos.

Regla por defecto: bloquear duplicados.

### Valor de patas

Regla provisional:

```txt
valor_pata = valor_bono_simple * cantidad_numeros_base
```

Esta regla debe quedar configurable por campana para permitir ajuste administrativo futuro.

### Comisiones

La comision no se consolida al cargar un pago aislado. Se calcula de forma preliminar mientras la rendicion esta abierta y se confirma al cerrar la rendicion.

Al cerrar una rendicion, el sistema genera movimientos definitivos en la cuenta corriente del cobrador.

### Rendiciones cerradas

Una rendicion cerrada no se reabre ni se edita directamente.

Todo error posterior se corrige mediante anulacion o ajuste auditado.

### Sorteos en MVP

El MVP debe incluir sorteos, con alcance controlado:

- Sorteos mensuales.
- Sorteo extraordinario por pago total.
- Sorteo final.
- Sorteos consuelo.
- Padron congelado.
- Carga de numeros ganadores.
- Validacion de ganador habilitado o no habilitado.
- Registro de premios adjudicados, pendientes o no adjudicados.

Reglas confirmadas:

- Sorteo final: para ganar debe estar pago completo.
- Sorteos consuelo: participan solo bonos no ganadores y que esten al dia.
- Sorteo extraordinario: agrega N numeros extra segun cantidad de numeros base del bono.

### Permisos adaptables

El sistema usara roles como agrupadores de permisos granulares. No se debe hardcodear comportamiento solo por nombre de rol.

Documento de referencia: `docs/permissions.md`.

### Pantallas adaptables

Las pantallas se disenan por flujo operativo y las acciones visibles dependen de permisos. Esto permite agregar roles o cambiar permisos sin rehacer pantallas completas.

Documento de referencia: `docs/screens.md`.

### Carga por codigo de barras

Cada bono fisico contiene codigo de barras. El MVP debe contemplar carga y busqueda por escaneo.

Como no esta confirmado que representa el codigo viejo, la interpretacion debe ser configurable por campana mediante `barcode_mode`.

Documento de referencia: `docs/imports.md`.

### Documentos imprimibles

El MVP usara HTML imprimible para remitos y constancias. PDF persistente queda como mejora futura.

Documento de referencia: `docs/documents.md`.

### Comisiones especiales y ajustes

El sistema debe contemplar reglas especiales por cobrador y ajustes manuales de comision autorizados por administracion.

Todo ajuste debe exigir motivo y auditoria.

Documento de referencia: `docs/commissions.md`.

### Migracion desde sistema viejo

Se contempla que el sistema antiguo pueda exportar cobradores, compradores y numeros historicos de la campana anterior.

La migracion debe pasar por staging, validacion y confirmacion antes de impactar datos definitivos.

Documento de referencia: `docs/migration.md`.

### Backups y operacion

El MVP debe operar con backups automaticos, exportaciones previas a operaciones riesgosas y procedimiento de restauracion.

Objetivos iniciales:

```txt
RPO: maximo 24 horas
RTO: restauracion durante el mismo dia
```

Documento de referencia: `docs/backup-operations.md`.

## Preguntas abiertas

### Valor definitivo de patas

Pendiente confirmar si la pata siempre vale `valor_bono_simple * cantidad_numeros_base` o si existen excepciones comerciales.

Decision temporal: implementar regla configurable con valor por defecto proporcional.

### Comisiones especiales

Pendiente confirmar porcentajes exactos:

- Pago contado.
- Primera cuota.
- Cuotas intermedias.
- Ultima cuota.

Decision temporal: modelar reglas configurables por campana, tipo de cuota/pago y cobrador.

### Acceso de cobradores

Pendiente confirmar si los cobradores tendran usuario propio en el MVP.

Decision temporal: operar desde administracion, pero modelar rol `cobrador` para no bloquear acceso futuro.
