# Issues y consideraciones criticas

Este documento resume los puntos que deben aclararse o resolverse a partir del modelo de negocio definido en `README.md`.

## Veredicto general

El sistema es viable como aplicacion web administrativa. No parece inviable, pero tiene complejidad media-alta por tres areas principales:

- Numeracion de bonos, patas y sorteos.
- Pagos, cuotas, adelantos y rendiciones.
- Cuenta corriente y comisiones de cobradores.

El `README.md` esta bien como documento de negocio, pero todavia falta convertirlo en diseño funcional y tecnico.

## Issues criticos

### 1. Definir plataforma principal

El documento indica que la aplicacion sera web y accesible desde distintos dispositivos.

Si ese es el objetivo, la plataforma principal deberia ser una web app o PWA con backend centralizado y base de datos compartida.

Tauri puede servir para una app desktop administrativa, pero no deberia ser la plataforma principal si se requiere acceso desde celulares, tablets y distintos dispositivos.

Decision pendiente:

- Web app como producto principal.
- Tauri solo como opcion complementaria.
- O descartar Tauri para este proyecto.

### 2. Cerrar la regla del numero asociado `+4871`

La regla de numero asociado es central para todo el sistema:

```text
numero_asociado = numero_base + 4871
```

Debe confirmarse que ocurre cuando el resultado supera `9999`.

Opciones posibles:

1. No se permiten numeros base que generen asociados mayores a `9999`.
2. Se toman las ultimas 4 cifras.
3. La campana admite numeros de mas de 4 cifras.
4. Existe otra regla heredada del sistema anterior.

Esto bloquea decisiones de base de datos, validaciones, busqueda de ganadores, importacion de bonos y control de duplicados.

### 3. Definir unicidad de numeros participantes

Debe quedar formalmente definido que un numero participante no puede apuntar a mas de un bono dentro de la misma campana.

Numero participante incluye:

- Numero base.
- Numero asociado calculado.
- Numeros incluidos en patas.
- Numeros extra de sorteos extraordinarios, si aplican.

Hay que definir que hace el sistema ante duplicados:

- Bloquear carga.
- Permitir con advertencia.
- Exigir resolucion administrativa.
- Marcar conflicto pendiente.

Recomendacion: bloquear por defecto y permitir excepciones solo con rol administrador y auditoria.

### 4. Modelar la cuenta corriente del cobrador como movimientos

La cuenta corriente del cobrador es un componente central. No deberia modelarse solo con saldos calculados o campos editables.

Debe modelarse como un ledger de movimientos auditables.

Movimientos posibles:

- Comision generada.
- Comision liquidada.
- Pago recibido por transferencia.
- Efectivo rendido.
- Ajuste manual.
- Anulacion de pago.
- Anulacion de comision.
- Saldo a favor del cobrador.
- Saldo a favor de Bomberos.

Esto es critico para evitar descuadres entre efectivo, transferencias, comisiones y rendiciones.

### 5. Definir estados y transiciones

El README propone estados comerciales y financieros, pero falta una maquina de estados formal.

Hay que definir transiciones permitidas, por ejemplo:

- `Disponible en administracion` -> `Entregado a cobrador`.
- `Entregado a cobrador` -> `Vendido`.
- `Entregado a cobrador` -> `Devuelto`.
- `Vendido` -> `Anulado`.
- `Vendido` -> `Cerrado`.
- `Disponible en administracion` -> `Extraviado`.

Tambien deben definirse reversiones:

- Venta cargada por error.
- Pago mal registrado.
- Bono asignado al cobrador equivocado.
- Cambio de comprador.
- Devolucion de bono ya entregado.

Recomendacion: no borrar datos; anular o revertir mediante movimientos auditados.

### 6. Recortar alcance MVP

El alcance completo es grande. Intentar implementar todo de una vez aumenta mucho el riesgo.

MVP recomendado:

1. Campanas.
2. Cobradores.
3. Compradores.
4. Bonos simples.
5. Carga/importacion de bonos.
6. Asignacion de bonos a cobradores.
7. Venta de bonos.
8. Plan de cuotas.
9. Registro de pagos.
10. Rendiciones basicas.
11. Comisiones basicas.
12. Cuenta corriente del cobrador.
13. Reportes operativos basicos.

Fase posterior:

1. Patas avanzadas.
2. Armado/desarmado de patas.
3. Sorteos mensuales.
4. Padrón congelado.
5. Premios.
6. Sorteo extraordinario.
7. Sorteos consuelo.
8. Acceso directo de cobradores.
9. Codigo de barras.
10. Infraestructura AWS productiva.

## Dudas abiertas importantes

### Numeracion y bonos

1. Que ocurre si `numero_base + 4871 > 9999`.
2. Si el numero asociado siempre se calcula igual en todas las campanas.
3. Si la regla `+4871` debe ser configurable por campana.
4. Si los numeros con ceros a la izquierda deben conservar formato fijo, por ejemplo `0068`.
5. Si se permiten numeros de 3, 4 o mas cifras en una misma campana.
6. Como se resuelve un numero historico que ahora pertenece a una pata.

### Patas

1. Si una pata siempre vale `valor_bono_simple x cantidad_de_numeros_base`.
2. Si una pata armada desde bonos simples puede desarmarse despues de venderse.
3. Si una pata puede desarmarse despues de tener pagos registrados.
4. Si una pata puede desarmarse despues de participar en sorteos.
5. Como se imprimen o documentan patas armadas manualmente.

### Pagos y rendiciones

1. Como se anula un pago mal cargado.
2. Como se corrige un medio de pago incorrecto.
3. Si una transferencia requiere comprobante adjunto.
4. Si los pagos por transferencia deben conciliarse contra movimientos bancarios.
5. Si una rendicion cerrada puede reabrirse.
6. Que pasa si un cobrador rinde menos efectivo del esperado.
7. Que pasa si un cobrador descuenta una comision distinta a la calculada.

### Comisiones

1. Porcentaje exacto de comision por pago contado.
2. Porcentaje exacto por primera cuota.
3. Porcentaje exacto por cuotas intermedias.
4. Porcentaje exacto por ultima cuota.
5. Si la comision se genera al registrar el pago o al cerrar la rendicion.
6. Si la comision puede modificarse manualmente.
7. Si hay cobradores con reglas especiales.

### Sorteos

1. Regla exacta de elegibilidad del sorteo final.
2. Regla exacta de elegibilidad de sorteos consuelo.
3. Como se calculan los numeros extra del sorteo extraordinario.
4. Si los numeros extra deben ser generados por el sistema o cargados manualmente.
5. Que procedimiento formal existe para premios no adjudicados por falta de pago.
6. Si el padron congelado debe incluir tambien no habilitados o solo habilitados.

### Usuarios y acceso

1. Si los cobradores tendran usuario propio.
2. Si los cobradores podran cargar pagos directamente.
3. Si administracion debe aprobar pagos informados por cobradores.
4. Si se necesita acceso desde celulares en campo.
5. Si debe soportar mala conectividad o modo offline.

### Datos y migracion

1. Como se importaran datos desde Excel.
2. Si existe exportacion del sistema anterior.
3. Que datos historicos son obligatorios para arrancar.
4. Si se migraran campanas anteriores completas o solo numeros habituales.
5. Como se normalizaran compradores duplicados.

### Documentos y reportes

1. Si los remitos deben ser PDF, impresos A4, Excel o todos.
2. Si deben tener numeracion fiscal o solo administrativa.
3. Si las constancias de pago deben entregarse al comprador.
4. Si se deben firmar digitalmente o solo imprimir.

## Mejoras recomendadas antes del diseño tecnico

### 1. Crear un documento de MVP

Separar claramente:

- Que entra en primera version.
- Que queda para segunda version.
- Que queda solo como deseable.

### 2. Crear flujos funcionales principales

Antes de programar, conviene definir flujos paso a paso para:

- Crear campana.
- Cargar bonos.
- Entregar bonos a cobrador.
- Registrar venta.
- Registrar pago.
- Crear rendicion.
- Liquidar comision.
- Generar padron.
- Cargar ganador.
- Rechazar premio por falta de pago.

### 3. Crear maquina de estados

Definir estados y transiciones para:

- Bono.
- Cuota.
- Pago.
- Rendicion.
- Premio.
- Campana.
- Sorteo.

### 4. Crear modelo DER preliminar

Entidades probables:

- `campaigns`
- `collectors`
- `buyers`
- `bonds`
- `bond_numbers`
- `bond_assignments`
- `sales`
- `payment_plans`
- `installments`
- `payments`
- `collector_ledger_entries`
- `settlements`
- `draws`
- `draw_rosters`
- `draw_roster_entries`
- `winning_numbers`
- `prizes`
- `audit_log`
- `users`
- `roles`

### 5. Definir importaciones

El sistema probablemente necesite importar datos desde Excel.

Se deberia definir:

- Formato de Excel esperado.
- Validaciones.
- Previsualizacion antes de importar.
- Reporte de errores.
- Deteccion de duplicados.
- Rollback o anulacion de importacion.

### 6. Definir seguridad y permisos

Permisos minimos a definir:

- Quien puede crear campanas.
- Quien puede cambiar reglas de comision.
- Quien puede anular pagos.
- Quien puede cerrar rendiciones.
- Quien puede generar padrones.
- Quien puede cargar ganadores.
- Quien puede modificar datos historicos.

### 7. Definir auditoria obligatoria

Acciones que deben auditarse si o si:

- Cambios de reglas de campana.
- Carga o anulacion de pagos.
- Cambios de comprador.
- Asignacion y devolucion de bonos.
- Cierre o reapertura de rendiciones.
- Liquidacion de comisiones.
- Generacion de padrones.
- Carga de ganadores.
- Rechazo de premios.
- Ajustes manuales de saldos.

## Riesgos principales

### Riesgo 1: empezar a programar sin cerrar reglas de negocio

Impacto: alto.

Puede obligar a rehacer base de datos, validaciones y pantallas.

### Riesgo 2: mezclar saldos calculados con dinero real

Impacto: alto.

La cuenta corriente debe poder reconstruirse desde movimientos auditables.

### Riesgo 3: no congelar padrones de sorteo

Impacto: alto.

Si el padron se recalcula dinamicamente, los pagos tardios pueden alterar resultados historicos.

### Riesgo 4: no separar estado comercial y financiero

Impacto: medio-alto.

Un bono puede estar vendido, atrasado, entregado, anulado o cerrado en dimensiones distintas.

### Riesgo 5: permitir borrado fisico de informacion historica

Impacto: alto.

Para pagos, rendiciones, premios y auditoria, debe usarse anulacion/reversion, no borrado.

## Recomendacion final

Antes de implementar backend o frontend, conviene resolver en este orden:

1. Cerrar reglas de numeracion y duplicados.
2. Definir MVP.
3. Definir maquina de estados.
4. Definir ledger de cobradores y rendiciones.
5. Definir flujos funcionales principales.
6. Armar DER preliminar.
7. Recién despues, definir API, pantallas e implementacion.
