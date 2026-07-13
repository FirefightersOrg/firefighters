# Alcance del MVP

## Objetivo

El MVP debe reemplazar el control operativo principal de bonos, pagos, rendiciones y sorteos. No debe intentar cubrir todas las mejoras futuras, pero si debe resolver el ciclo administrativo central sin depender de Excel como fuente de verdad.

## Alcance incluido

### Campanas

- Crear campana anual.
- Configurar valor de bono simple.
- Configurar cantidad de cuotas.
- Configurar cantidad de cifras de numeros.
- Configurar numero maximo permitido.
- Configurar offset de numero asociado.
- Configurar reglas basicas de comision.
- Configurar tipos de sorteos de la campana.

### Bonos y patas

- Cargar bonos simples.
- Cargar patas basicas.
- Cargar o buscar bonos mediante codigo de barras.
- Calcular numero asociado.
- Mostrar numeros con ceros a la izquierda segun configuracion de campana.
- Validar duplicados de numeros participantes.
- Validar que numero base y numero asociado no superen `max_number`.
- Consultar ficha unica del bono.

### Cobradores

- Crear y editar cobradores.
- Consultar bonos asignados.
- Consultar ventas, pagos, rendiciones y saldo.
- Generar reporte operativo por cobrador.

### Compradores

- Crear y editar compradores.
- Asociar comprador a una venta.
- Consultar historial de bonos, cuotas, pagos y premios dentro de la informacion disponible.

### Entrega de bonos

- Asignar bonos a cobradores.
- Registrar fecha, usuario y observaciones.
- Emitir remito de entrega imprimible.
- Registrar devoluciones y reasignaciones basicas.

### Ventas

- Registrar venta de bono simple o pata.
- Asociar comprador, cobrador y modalidad de pago.
- Generar plan de cuotas.
- Registrar pago inicial si corresponde.

### Pagos y cuotas

- Registrar pagos de contado.
- Registrar pagos por cuota.
- Registrar pagos adelantados.
- Diferenciar efectivo y transferencia.
- Asociar pagos a una rendicion cuando corresponda.
- Consultar cuotas pendientes, pagas, adelantadas y vencidas.

### Rendiciones

- Crear rendicion por cobrador.
- Agregar pagos a la rendicion.
- Mostrar totales en tiempo real.
- Calcular comision preliminar.
- Cerrar rendicion.
- Confirmar comisiones al cierre.
- Generar movimientos de cuenta corriente.
- Emitir remito de rendicion imprimible.
- Corregir errores posteriores mediante anulaciones o ajustes auditados.

### Comisiones

- Configurar reglas basicas por campana.
- Configurar reglas especiales por cobrador.
- Calcular comision preliminar durante rendicion abierta.
- Confirmar comision al cerrar rendicion.
- Ajustar comision manualmente con permiso y motivo obligatorio.
- Registrar comision generada en cuenta corriente del cobrador.
- Registrar comision liquidada si se paga en la rendicion.

### Cuenta corriente del cobrador

- Registrar movimientos auditables.
- Calcular saldo desde movimientos.
- Diferenciar comisiones generadas, comisiones liquidadas, efectivo rendido, transferencias y ajustes.

### Sorteos

- Crear sorteos mensuales.
- Crear sorteo extraordinario por pago total.
- Crear sorteo final.
- Crear sorteos consuelo.
- Configurar fecha del sorteo y fecha/hora de corte.
- Generar padron congelado.
- Cargar numeros ganadores.
- Validar si el numero ganador corresponde a un bono habilitado.
- Registrar premios adjudicados, pendientes o no adjudicados.

Reglas incluidas:

- Sorteo mensual: debe estar al dia hasta la cuota requerida.
- Sorteo extraordinario: debe estar pago completo antes del corte y suma N numeros extra segun cantidad de numeros base.
- Sorteo final: debe estar pago completo para ganar.
- Sorteo consuelo: participan solo no ganadores y que esten al dia.

### Reportes y remitos

- Remito de entrega de bonos.
- Remito de rendicion.
- Constancia de pago.
- Constancia de premio entregado o no adjudicado.
- Resumen mensual por cobrador.
- Reporte de bonos vendidos, disponibles y entregados.
- Reporte de cuotas pagas, pendientes y vencidas.
- Reporte de padron de sorteo.
- Reporte de ganadores y premios.

### Auditoria

- Auditar acciones sensibles.
- Registrar usuario, fecha, accion, entidad, datos anteriores y datos nuevos cuando aplique.

### Migracion inicial

- Importar cobradores desde sistema viejo si hay exportacion disponible.
- Importar compradores desde sistema viejo si hay exportacion disponible.
- Importar numeros historicos para generar reservas y conflictos.
- Validar datos en staging antes de confirmar.

## Fuera del MVP

- Portal publico de comprador.
- Portal completo de cobrador.
- Notificaciones por WhatsApp, email o SMS.
- Conciliacion bancaria automatica.
- QR propio para nuevas impresiones.
- Caja diaria avanzada.
- Analitica comparativa entre campanas.
- Integracion AWS nativa.

## Criterios de aceptacion del MVP

- La administracion puede crear una campana y cargar bonos.
- El sistema impide numeros participantes duplicados dentro de una campana.
- El sistema respeta cantidad de cifras por campana.
- Se puede asignar bonos a cobradores y emitir remito.
- Se puede vender un bono a un comprador.
- Se puede registrar pagos de contado, por cuota y adelantados.
- Se puede crear y cerrar una rendicion.
- El cierre de rendicion genera comisiones y movimientos de cuenta corriente.
- Una rendicion cerrada no se edita directamente.
- Se puede aplicar regla especial o ajuste manual de comision con auditoria.
- Se puede generar padron congelado para sorteo.
- Se puede cargar ganador y validar habilitacion segun padron.
- Se puede consultar saldo de cobrador desde movimientos.
- Se puede cargar o buscar bonos por codigo de barras segun configuracion de campana.
- Se pueden emitir documentos HTML imprimibles principales.

## Riesgos principales

- Reglas de patas incompletas.
- Comisiones exactas pendientes.
- Posible complejidad si se intenta digitalizar todos los procesos futuros en la primera version.

## Documentos relacionados

- `docs/permissions.md`
- `docs/screens.md`
- `docs/imports.md`
- `docs/documents.md`
- `docs/commissions.md`
- `docs/draw-rules.md`
- `docs/corrections.md`
- `docs/migration.md`
- `docs/backup-operations.md`
- `docs/implementation-plan.md`

## Estrategia de control de alcance

El MVP debe priorizar trazabilidad y consistencia sobre automatizaciones avanzadas. Si una regla no esta confirmada, debe quedar configurable o documentada como decision temporal, no hardcodeada como verdad permanente.
