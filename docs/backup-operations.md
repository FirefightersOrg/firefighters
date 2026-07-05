# Backups y operacion productiva

## Objetivo

Definir una politica inicial adecuada para operar el MVP con datos economicos y administrativos sensibles.

## Principios

- La base de datos es la fuente de verdad.
- Toda operacion economica debe ser reconstruible desde movimientos.
- Los backups deben probarse, no solo configurarse.
- Antes de cargas masivas o migraciones debe existir exportacion previa.

## Objetivos iniciales

```txt
RPO: maximo 24 horas de perdida aceptable
RTO: restauracion operativa durante el mismo dia
```

Estos objetivos pueden endurecerse cuando el sistema entre en uso intensivo.

## Supabase MVP

Politica recomendada:

- Usar plan con backups automaticos de base de datos.
- Confirmar retencion disponible del plan contratado.
- Exportar manualmente antes de importaciones masivas.
- Exportar manualmente antes de cambios grandes de reglas o migraciones.
- Mantener copias periodicas de reportes criticos.

## Retencion recomendada

- Backups automaticos: segun plan Supabase, ideal minimo 7 dias.
- Exportacion semanal de datos criticos: 30 dias.
- Exportacion mensual: 6 a 12 meses.
- Reporte final de campana: conservacion indefinida.

## Datos criticos a respaldar

- Campanas.
- Bonos y numeros.
- Compradores.
- Cobradores.
- Ventas.
- Pagos.
- Rendiciones.
- Cuenta corriente.
- Sorteos y padrones.
- Ganadores y premios.
- Auditoria.

## Storage

Si se guardan comprobantes o documentos:

- Usar buckets privados.
- Definir politicas de acceso.
- Respaldar o exportar archivos importantes.
- No depender solo de enlaces temporales.

## Procedimiento antes de operacion riesgosa

Operaciones riesgosas:

- Importacion masiva.
- Migracion desde sistema viejo.
- Cambio de reglas de campana.
- Correccion masiva.
- Cierre de campana.

Procedimiento:

```txt
1. Exportar datos criticos.
2. Registrar motivo de la operacion.
3. Ejecutar en entorno de prueba si es posible.
4. Ejecutar en produccion.
5. Validar reportes principales.
6. Registrar resultado.
```

## Restauracion

Debe existir un procedimiento documentado para:

- Identificar backup valido.
- Restaurar en entorno separado.
- Validar integridad.
- Decidir si reemplaza produccion.
- Comunicar interrupcion si aplica.

## Monitoreo minimo

- Errores de aplicacion.
- Fallos de login.
- Fallos de cierre de rendicion.
- Fallos de generacion de padron.
- Fallos de importacion.
- Uso de permisos criticos.

## Exportaciones operativas

Aunque existan backups, el sistema debe permitir exportar reportes administrativos:

- Bonos por campana.
- Pagos por periodo.
- Rendiciones.
- Cuenta corriente de cobradores.
- Padrones congelados.
- Ganadores y premios.
