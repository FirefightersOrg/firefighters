# Plan de implementacion

## Objetivo

Ordenar la construccion del MVP en etapas tecnicas verificables.

## Fase 0: Preparacion del repositorio

Entregables:

- Inicializar SvelteKit con TypeScript.
- Configurar pnpm.
- Configurar lint, format y check.
- Configurar estructura `src/lib`.
- Agregar `.env.example`.
- Agregar Supabase local.

Criterio de aceptacion:

- `pnpm check` ejecuta correctamente.
- Supabase local puede iniciar.

## Fase 1: Auth, roles y permisos

Entregables:

- Supabase Auth.
- Tablas `profiles`, `roles`, `permissions`, `role_permissions`, `user_roles`.
- RLS base.
- Helpers server-side de permisos.
- Pantallas basicas de login y sesion.

Criterio de aceptacion:

- Un usuario autenticado tiene roles.
- Una accion sensible valida permiso server-side.

## Fase 2: Campanas y configuracion

Entregables:

- CRUD de campanas.
- Configuracion de numeracion.
- Configuracion de cuotas.
- Configuracion de reglas base de comision.

Criterio de aceptacion:

- Se puede crear campana con `number_digits`, `max_number` y `associated_number_offset`.

## Fase 3: Bonos, patas y numeros

Entregables:

- Tablas `bonds` y `bond_numbers`.
- Calculo de numero asociado.
- Formato visual por campana.
- Validacion de duplicados.
- Carga manual de bono simple.
- Carga basica de pata.

Criterio de aceptacion:

- No se pueden duplicar numeros participantes en una campana.
- El sistema soporta configuracion futura de 5 cifras.

## Fase 4: Carga por codigo de barras e importaciones

Entregables:

- Sesiones de importacion.
- Carga por escaneo.
- Configuracion `barcode_mode`.
- Vista previa de errores.
- Confirmacion de lote.

Criterio de aceptacion:

- Se puede cargar un lote escaneado sin impactar datos hasta confirmar.

## Fase 5: Cobradores y compradores

Entregables:

- CRUD de cobradores.
- CRUD de compradores.
- Ficha de cobrador.
- Ficha de comprador.

Criterio de aceptacion:

- Se puede asociar comprador y cobrador a una venta.

## Fase 6: Entrega de bonos

Entregables:

- Asignar bonos a cobradores.
- Registrar devoluciones.
- Remito HTML imprimible.
- Historial de asignaciones.

Criterio de aceptacion:

- Un bono entregado cambia de estado y queda en historial.

## Fase 7: Ventas, planes y cuotas

Entregables:

- Registrar venta.
- Generar plan de pago.
- Generar cuotas.
- Registrar modalidad contado/cuotas.

Criterio de aceptacion:

- Un bono vendido queda asociado a comprador, cobrador y cuotas.

## Fase 8: Pagos y rendicion asistida

Entregables:

- Crear rendicion.
- Agregar pagos.
- Seleccionar cuotas.
- Diferenciar efectivo y transferencia.
- Resumen en tiempo real.
- Cierre de rendicion.
- Remito HTML.

Criterio de aceptacion:

- Al cerrar rendicion se confirman pagos y se bloquea edicion directa.

## Fase 9: Comisiones y ledger

Entregables:

- Reglas generales de comision.
- Reglas especiales por cobrador.
- Ajustes manuales auditados.
- `collector_ledger_entries`.
- Vista de cuenta corriente.

Criterio de aceptacion:

- El saldo del cobrador se reconstruye desde movimientos.

## Fase 10: Correcciones y anulaciones

Entregables:

- Anular pagos.
- Corregir medio de pago.
- Corregir ventas con auditoria.
- Ajustar rendicion cerrada sin reabrir.
- Auditar cambios.

Criterio de aceptacion:

- Una rendicion cerrada no se modifica directamente.

## Fase 11: Sorteos y padrones

Entregables:

- Crear sorteos.
- Configurar reglas.
- Generar padron.
- Congelar padron.
- Numeros extra de extraordinario.

Criterio de aceptacion:

- El padron congelado no cambia aunque se carguen pagos posteriores.

## Fase 12: Ganadores y premios

Entregables:

- Cargar numero ganador.
- Buscar en padron congelado.
- Validar habilitacion.
- Registrar premio adjudicado, entregado o no adjudicado.

Criterio de aceptacion:

- El sistema explica por que un ganador cobra o no cobra.

## Fase 13: Reportes

Entregables:

- Bonos por estado.
- Pagos por fecha.
- Rendiciones por cobrador.
- Cuenta corriente.
- Padrones.
- Ganadores y premios.

Criterio de aceptacion:

- Administracion puede operar sin Excel como fuente de verdad.

## Fase 14: Migracion desde sistema viejo

Entregables:

- Staging de migracion.
- Importar cobradores.
- Importar compradores.
- Importar numeros historicos.
- Generar reservas/conflictos.

Criterio de aceptacion:

- Los datos historicos se importan con vista previa y resolucion de conflictos.

## Fase 15: Hardening productivo

Entregables:

- Backups verificados.
- Exportaciones operativas.
- Revision RLS.
- Tests criticos.
- Documentacion de operacion.

Criterio de aceptacion:

- El sistema puede usarse en produccion con procedimientos de recuperacion definidos.
