# Diseno funcional

## Objetivo

Definir modulos, roles, pantallas y flujos principales del sistema de gestion de bonos. Este documento describe comportamiento esperado desde el punto de vista operativo.

## Roles

El sistema debe usar permisos granulares agrupados en roles. La definicion detallada esta en `docs/permissions.md`.

### Administrador

Puede gestionar configuracion general, campanas, usuarios, reglas, bonos, pagos, rendiciones, sorteos, premios y reportes.

### Operador administrativo

Puede cargar compradores, ventas, pagos, rendiciones, remitos y consultas operativas. No debe modificar reglas criticas de campana.

### Tesorero

Puede consultar y gestionar informacion economica, rendiciones, comisiones, cuenta corriente, transferencias, reportes y cierres.

### Cobrador

Inicialmente puede no tener acceso directo. El modelo debe permitir que en el futuro consulte su cartera, pagos, cuotas pendientes y saldo.

### Consulta

Solo lectura, con acceso a reportes y consultas definidas.

## Modulos funcionales

### Campanas

Permite crear y configurar el periodo anual del bono.

Pantallas sugeridas:

- Listado de campanas.
- Crear/editar campana.
- Configuracion de numeros.
- Configuracion de cuotas.
- Configuracion de comisiones.
- Configuracion de sorteos.

### Bonos y patas

Permite administrar bonos simples y patas.

Pantallas sugeridas:

- Listado de bonos.
- Ficha unica de bono.
- Carga manual de bono.
- Carga de pata.
- Carga/busqueda por codigo de barras.
- Validacion de numeros.
- Busqueda por numero visible, asociado, codigo de barras o identificador interno.

### Cobradores

Permite administrar vendedores/cobradores y consultar su situacion.

Pantallas sugeridas:

- Listado de cobradores.
- Ficha unica de cobrador.
- Bonos asignados.
- Rendiciones.
- Cuenta corriente.
- Resumen mensual.

### Compradores

Permite administrar compradores y su historial.

Pantallas sugeridas:

- Listado de compradores.
- Ficha unica de comprador.
- Bonos comprados.
- Pagos.
- Premios.

### Entregas de bonos

Permite registrar entrega fisica de bonos a cobradores.

Pantallas sugeridas:

- Nueva entrega.
- Detalle de entrega.
- Remito imprimible.
- Devolucion o reasignacion.

### Ventas

Permite registrar que un bono fue vendido a un comprador.

Pantallas sugeridas:

- Nueva venta.
- Seleccion de bono.
- Seleccion o creacion de comprador.
- Modalidad de pago.
- Generacion de cuotas.

### Pagos

Permite registrar pagos de contado, cuotas y adelantos.

Pantallas sugeridas:

- Registrar pago.
- Seleccion de bono y cuotas.
- Medio de pago.
- Estado de cuotas.
- Historial de pagos.

### Rendiciones

Permite registrar el proceso en que un cobrador rinde ventas y pagos a administracion.

Pantallas sugeridas:

- Crear rendicion.
- Carga asistida de pagos.
- Resumen en tiempo real.
- Cierre de rendicion.
- Remito imprimible.
- Correcciones auditadas.
- Ajustes manuales de comision con permiso.

### Sorteos

Permite administrar sorteos y validar ganadores.

Pantallas sugeridas:

- Listado de sorteos.
- Crear sorteo.
- Generar padron.
- Ver padron congelado.
- Cargar ganador.
- Resultado de validacion.
- Premios.

Las reglas especificas de sorteo estan en `docs/draw-rules.md`.

### Importaciones

Permite cargar datos por codigo de barras, archivo o exportacion del sistema viejo.

Pantallas sugeridas:

- Nueva sesion de importacion.
- Carga por escaneo.
- Vista previa de lote.
- Reporte de errores.
- Confirmacion de importacion.

### Documentos

Permite emitir HTML imprimible para remitos y constancias.

Documentos iniciales:

- Remito de entrega.
- Remito de rendicion.
- Constancia de pago.
- Constancia de premio entregado.
- Constancia de premio no adjudicado.

## Flujos principales

### Crear campana

```txt
Administrador crea campana
↓
Configura valor de bono simple
↓
Configura cuotas
↓
Configura numeracion
↓
Configura comisiones
↓
Configura sorteos esperados
↓
Campana queda activa para carga de bonos
```

### Cargar bono simple

```txt
Usuario ingresa numero base
↓
Sistema calcula numero asociado
↓
Sistema valida rango segun campana
↓
Sistema valida duplicados de numeros participantes
↓
Sistema crea bono
↓
Bono queda disponible en administracion
```

### Cargar pata

```txt
Usuario crea pata
↓
Ingresa varios numeros base
↓
Sistema calcula asociados
↓
Sistema valida rango y duplicados
↓
Sistema calcula valor provisional de pata
↓
Pata queda disponible en administracion
```

### Entregar bonos a cobrador

```txt
Usuario crea entrega
↓
Selecciona cobrador
↓
Selecciona bonos disponibles
↓
Confirma entrega
↓
Bonos pasan a entregados a cobrador
↓
Sistema genera remito
```

### Registrar venta

```txt
Usuario busca bono
↓
Sistema verifica que este asignado o disponible segun regla operativa
↓
Usuario selecciona o crea comprador
↓
Usuario define modalidad de pago
↓
Sistema genera plan de cuotas
↓
Bono queda vendido
```

### Registrar pago dentro de rendicion

```txt
Usuario abre o crea rendicion del cobrador
↓
Busca bono vendido
↓
Selecciona cuotas o pago total
↓
Indica medio de pago
↓
Sistema agrega pago a rendicion abierta
↓
Sistema recalcula totales y comision preliminar
```

### Cerrar rendicion

```txt
Usuario revisa resumen
↓
Sistema muestra efectivo, transferencia, total, comision y neto
↓
Usuario confirma cierre
↓
Sistema confirma pagos
↓
Sistema consolida comisiones
↓
Sistema genera movimientos de cuenta corriente
↓
Sistema bloquea edicion directa de la rendicion
↓
Sistema emite remito
```

### Corregir rendicion cerrada

```txt
Usuario detecta error
↓
Solicita correccion con motivo
↓
Sistema genera anulacion o ajuste auditado
↓
Sistema actualiza saldos desde nuevos movimientos
↓
La rendicion original permanece cerrada como historial
```

### Generar padron de sorteo

```txt
Usuario selecciona sorteo
↓
Sistema evalua regla de elegibilidad
↓
Sistema usa pagos confirmados antes del corte
↓
Sistema genera participantes habilitados y no habilitados
↓
Usuario revisa
↓
Sistema congela padron
```

### Cargar numero ganador

```txt
Usuario ingresa numero ganador
↓
Sistema busca coincidencia en padron congelado
↓
Sistema identifica bono, comprador y cobrador
↓
Sistema informa si estaba habilitado
↓
Usuario registra resultado del premio
```

## Pantallas prioritarias del MVP

- Dashboard de campana.
- Campanas.
- Bonos.
- Ficha de bono.
- Cobradores.
- Ficha de cobrador.
- Compradores.
- Entrega de bonos.
- Venta.
- Rendicion asistida.
- Cuenta corriente de cobrador.
- Sorteos.
- Padron de sorteo.
- Carga de ganador.
- Reportes basicos.

Detalle ampliado de pantallas: `docs/screens.md`.

## Correcciones

Los flujos de anulacion y correccion estan definidos en `docs/corrections.md`.

Regla principal:

```txt
No se borra historial sensible. Se anula, ajusta o compensa con auditoria.
```
