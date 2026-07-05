# Diseno tecnico

## Objetivo

Definir la arquitectura tecnica del MVP usando SvelteKit, TypeScript y Supabase, manteniendo una estructura que permita migrar a una API propia y AWS en una etapa posterior.

## Arquitectura MVP

```txt
Browser / PWA
  |
  v
SvelteKit + TypeScript
  |
  v
SvelteKit server actions / server routes
  |
  v
Supabase Auth + Postgres + Storage
```

## Principios

- La logica de negocio no debe vivir en componentes de UI.
- El acceso a Supabase debe estar encapsulado.
- Las reglas criticas deben estar en servicios de dominio o constraints SQL documentadas.
- RLS debe estar activo en tablas expuestas.
- No usar `service_role` en cliente.
- No borrar historicos economicos sin anulacion auditada.
- No asumir que los numeros tienen siempre 4 cifras.
- Usar permisos granulares para acciones sensibles.
- Mantener importaciones y migraciones en staging hasta confirmacion.

## Estructura sugerida

```txt
src/
  routes/
  lib/
    components/
    domain/
    schemas/
    supabase/
    server/
      auth/
      repositories/
      services/
      audit/
      documents/
```

### `src/lib/domain`

Reglas puras sin dependencia de Supabase.

Ejemplos:

- Calcular numero asociado.
- Formatear numero visible.
- Validar rango de numero.
- Calcular valor de pata.
- Calcular comision preliminar.
- Evaluar elegibilidad de sorteo.

### `src/lib/schemas`

Schemas Zod para inputs de formularios y acciones.

Ejemplos:

- Crear campana.
- Crear bono.
- Crear venta.
- Registrar pago.
- Cerrar rendicion.
- Crear sorteo.
- Cargar ganador.

### `src/lib/server/repositories`

Capa de acceso a datos.

Responsabilidades:

- Consultas a Supabase/Postgres.
- Persistencia de entidades.
- Mapeo de datos crudos a tipos de aplicacion.
- Evitar queries dispersas en componentes.

### `src/lib/server/services`

Casos de uso transaccionales.

Ejemplos:

- `createCampaign`
- `createBond`
- `assignBondsToCollector`
- `registerSale`
- `addPaymentToRendition`
- `closeRendition`
- `generateDrawRoster`
- `loadWinningNumber`

### `src/lib/server/audit`

Funciones para registrar auditoria de acciones sensibles.

### `src/lib/server/documents`

Generacion de HTML imprimible para remitos y constancias.

## Numeracion

La configuracion de numeracion vive en `campaigns`.

Campos clave:

```txt
number_digits
max_number
associated_number_offset
overflow_policy
```

Funcion de dominio esperada:

```ts
type CampaignNumbering = {
  numberDigits: number;
  maxNumber: number;
  associatedNumberOffset: number;
};

function calculateAssociatedNumber(baseNumber: number, config: CampaignNumbering): number {
  return baseNumber + config.associatedNumberOffset;
}

function formatCampaignNumber(value: number, config: CampaignNumbering): string {
  return String(value).padStart(config.numberDigits, '0');
}
```

Regla:

- No usar `padStart(4)` fuera de una funcion centralizada.
- No usar columnas `char(4)`.
- Validar rango contra `campaign.max_number`.

## Codigo de barras e importaciones

La lectura de codigo de barras debe implementarse como flujo configurable por campana.

Campo clave:

```txt
barcode_mode
```

Valores iniciales:

- `base_number`
- `internal_code`
- `external_legacy_code`
- `manual_mapping`

Regla:

- Escanear no debe impactar datos definitivos hasta confirmar una sesion de importacion.
- Toda carga masiva debe pasar por vista previa y validacion.
- Las importaciones desde sistema viejo deben pasar por staging.

## Rendiciones y comisiones

El cierre de rendicion es una operacion critica.

Debe ejecutarse server-side.

Responsabilidades de `closeRendition`:

- Verificar que la rendicion este abierta.
- Verificar pagos incluidos.
- Calcular totales definitivos.
- Calcular comision definitiva.
- Confirmar pagos.
- Actualizar cuotas cubiertas.
- Crear movimientos de cuenta corriente.
- Guardar snapshots de totales.
- Marcar rendicion como cerrada.
- Registrar auditoria.

Las comisiones pueden tener reglas especiales por cobrador y ajustes manuales con permiso `commission.adjust`.

Regla:

```txt
Una rendicion cerrada no se reabre ni se edita directamente.
```

Correcciones posteriores:

- Anular pago.
- Generar ajuste.
- Generar movimiento compensatorio.
- Registrar motivo y usuario.

Detalle de flujos: `docs/corrections.md`.

## Cuenta corriente del cobrador

El saldo no debe guardarse como valor editable.

Se calcula desde `collector_ledger_entries`.

Ejemplo:

```txt
saldo = creditos_no_anulados - debitos_no_anulados
```

Movimientos esperados:

- Comision generada.
- Comision liquidada.
- Efectivo rendido.
- Transferencia recibida por Bomberos.
- Ajuste manual.
- Anulacion.

## Sorteos y padrones

La generacion de padron debe ser server-side.

Responsabilidades de `generateDrawRoster`:

- Tomar sorteo y regla de elegibilidad.
- Evaluar pagos confirmados antes del corte.
- Crear entradas para numeros participantes.
- Marcar habilitados y no habilitados.
- Guardar snapshots de comprador y cobrador.

Responsabilidades de `freezeDrawRoster`:

- Bloquear modificaciones normales al padron.
- Registrar usuario y fecha.
- Auditar congelamiento.

Responsabilidades de `loadWinningNumber`:

- Buscar numero ganador en padron congelado.
- Determinar bono, comprador y cobrador.
- Determinar si corresponde premio.
- Registrar resultado.

Reglas confirmadas:

- Final: requiere pago completo para ganar.
- Consuelo: solo no ganadores y al dia.
- Extraordinario: N numeros extra segun cantidad de numeros base.

## Supabase y RLS

Reglas obligatorias:

- RLS activo en tablas expuestas al cliente.
- Politicas versionadas en migraciones.
- Operaciones sensibles por server actions o routes.
- `SUPABASE_SERVICE_ROLE_KEY` solo en entorno server-side.
- Roles de aplicacion explicitos.

El modelo de permisos esta detallado en `docs/permissions.md`.

Politicas iniciales sugeridas:

- `admin`: acceso completo funcional.
- `operador`: operaciones administrativas sin configuracion critica.
- `tesorero`: rendiciones, reportes economicos y cuenta corriente.
- `cobrador`: solo datos propios cuando se habilite acceso.
- `consulta`: solo lectura.

## Auditoria

Acciones obligatorias a auditar:

- Cambios de configuracion de campana.
- Carga de bonos.
- Asignacion y devolucion de bonos.
- Venta.
- Carga, anulacion o ajuste de pagos.
- Cierre de rendicion.
- Correccion de rendicion cerrada.
- Liquidacion de comisiones.
- Generacion y congelamiento de padrones.
- Carga de ganadores.
- Entrega o rechazo de premios.
- Ajustes manuales de cuenta corriente.

## PWA

Alcance MVP:

- Instalacion desde navegador cuando sea compatible.
- Responsive desktop/mobile/tablet.
- Cache de assets estaticos.
- Pantalla amigable sin conexion.

Fuera del MVP:

- Registro offline de pagos.
- Sincronizacion offline de operaciones economicas.
- Resolucion de conflictos offline.

## Documentos imprimibles

MVP:

- HTML imprimible para remitos.
- Persistir datos estructurados del remito.

Futuro:

- PDF generado y almacenado.
- QR o codigo de validacion.

Detalle de documentos: `docs/documents.md`.

## Backups y operacion

Para el MVP productivo:

- Usar backups automaticos del plan Supabase contratado.
- Exportar datos criticos antes de importaciones o correcciones masivas.
- Mantener procedimiento de restauracion documentado.
- Validar periodicamente que una restauracion funciona.

Objetivos iniciales:

```txt
RPO: maximo 24 horas
RTO: restauracion durante el mismo dia
```

Detalle operativo: `docs/backup-operations.md`.

## Plan de implementacion

El orden de construccion esta definido en `docs/implementation-plan.md`.

La implementacion debe avanzar por fases verificables, empezando por tooling, auth, permisos, campanas, bonos, importaciones, cobradores/compradores, ventas, rendiciones, ledger, sorteos y reportes.

## Testing minimo

Unit tests de dominio:

- Calculo de numero asociado.
- Formato de numeros por campana.
- Validacion de rango.
- Calculo de valor de pata.
- Calculo de comisiones.
- Elegibilidad de sorteo.

Tests de servicios:

- Cierre de rendicion.
- Anulacion de pago confirmado.
- Generacion de padron.
- Carga de ganador.

E2E criticos:

- Crear campana, cargar bono, vender, pagar, rendir.
- Generar padron y validar ganador.

## Migracion futura a AWS

Para facilitar migracion posterior:

- Mantener dominio independiente del SDK de Supabase.
- Encapsular repositorios.
- Evitar Edge Functions salvo necesidad real.
- Evitar triggers complejos sin documentacion.
- Usar PostgreSQL estandar siempre que alcance.
- Documentar RLS y permisos.
