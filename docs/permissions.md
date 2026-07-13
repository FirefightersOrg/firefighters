# Permisos y roles

## Objetivo

Definir un modelo adaptable de permisos para el MVP y futuras etapas. El sistema no debe depender solo de nombres de roles fijos; debe usar roles como agrupadores de permisos granulares.

## Principio rector

```txt
Rol = conjunto de permisos
Permiso = accion concreta del sistema
```

Esto permite cambiar permisos de un rol sin reescribir logica de negocio, pantallas o politicas RLS.

## Roles iniciales

| Rol | Proposito |
|---|---|
| `admin` | Configuracion total, usuarios, reglas y correcciones criticas. |
| `operador` | Operacion diaria de bonos, compradores, ventas, pagos y rendiciones abiertas. |
| `tesorero` | Rendiciones, comisiones, cuenta corriente, caja y reportes economicos. |
| `cobrador` | Acceso futuro limitado a cartera propia. |
| `consulta` | Solo lectura segun alcance definido. |

## Permisos granulares

### Campanas

| Permiso | Descripcion |
|---|---|
| `campaign.view` | Ver campanas. |
| `campaign.create` | Crear campanas. |
| `campaign.update` | Editar datos generales. |
| `campaign.update_rules` | Modificar reglas criticas de numeracion, cuotas, comisiones y sorteos. |
| `campaign.close` | Cerrar campana. |

### Bonos

| Permiso | Descripcion |
|---|---|
| `bond.view` | Ver bonos. |
| `bond.create` | Crear bonos manualmente. |
| `bond.import` | Importar o cargar bonos por lote. |
| `bond.scan` | Cargar o buscar bonos por codigo de barras. |
| `bond.assign` | Asignar bonos a cobradores. |
| `bond.return` | Registrar devoluciones. |
| `bond.mark_lost` | Registrar extravio. |
| `bond.annul` | Anular bonos. |

### Compradores y cobradores

| Permiso | Descripcion |
|---|---|
| `buyer.view` | Ver compradores. |
| `buyer.manage` | Crear y editar compradores. |
| `collector.view` | Ver cobradores. |
| `collector.manage` | Crear y editar cobradores. |
| `collector.ledger.view` | Ver cuenta corriente. |
| `collector.ledger.adjust` | Registrar ajustes manuales. |

### Ventas, pagos y rendiciones

| Permiso | Descripcion |
|---|---|
| `sale.create` | Registrar ventas. |
| `sale.correct` | Corregir ventas con auditoria. |
| `payment.create` | Registrar pagos. |
| `payment.annul` | Anular pagos confirmados. |
| `rendition.create` | Crear rendiciones. |
| `rendition.update_open` | Editar rendiciones abiertas. |
| `rendition.close` | Cerrar rendiciones. |
| `rendition.correct` | Corregir rendiciones cerradas mediante ajustes. |

### Comisiones

| Permiso | Descripcion |
|---|---|
| `commission.view` | Ver comisiones. |
| `commission.rule_manage` | Gestionar reglas de comision. |
| `commission.adjust` | Ajustar comision manualmente con motivo. |
| `commission.settle` | Liquidar/pagar comisiones. |

### Sorteos y premios

| Permiso | Descripcion |
|---|---|
| `draw.view` | Ver sorteos. |
| `draw.create` | Crear sorteos. |
| `draw.update` | Editar sorteos programados. |
| `draw.generate_roster` | Generar padron. |
| `draw.freeze_roster` | Congelar padron. |
| `draw.load_winner` | Cargar numero ganador. |
| `prize.resolve` | Resolver adjudicacion o no adjudicacion. |
| `prize.deliver` | Registrar entrega de premio. |

### Reportes, auditoria y usuarios

| Permiso | Descripcion |
|---|---|
| `report.view_operational` | Ver reportes operativos. |
| `report.view_financial` | Ver reportes economicos. |
| `report.export` | Exportar reportes. |
| `audit.view` | Ver auditoria. |
| `user.manage` | Gestionar usuarios y roles. |

## Matriz inicial sugerida

| Permiso | admin | operador | tesorero | cobrador | consulta |
|---|---:|---:|---:|---:|---:|
| `campaign.view` | si | si | si | no | si |
| `campaign.create` | si | no | no | no | no |
| `campaign.update_rules` | si | no | no | no | no |
| `bond.view` | si | si | si | propio | si |
| `bond.create` | si | si | no | no | no |
| `bond.import` | si | si | no | no | no |
| `bond.assign` | si | si | no | no | no |
| `buyer.manage` | si | si | no | no | no |
| `collector.manage` | si | no | no | no | no |
| `sale.create` | si | si | no | no | no |
| `payment.create` | si | si | si | futuro | no |
| `payment.annul` | si | no | si | no | no |
| `rendition.create` | si | si | si | no | no |
| `rendition.close` | si | no | si | no | no |
| `rendition.correct` | si | no | si | no | no |
| `commission.rule_manage` | si | no | no | no | no |
| `commission.adjust` | si | no | si | no | no |
| `draw.freeze_roster` | si | no | si | no | no |
| `draw.load_winner` | si | si | si | no | no |
| `report.view_financial` | si | no | si | no | si |
| `audit.view` | si | no | si | no | no |
| `user.manage` | si | no | no | no | no |

## Reglas tecnicas

- La UI puede ocultar acciones, pero la seguridad real debe estar en server-side y RLS.
- Cada accion sensible debe validar permisos explicitamente.
- Los permisos deben estar versionados en base de datos o migraciones iniciales.
- Si se habilita acceso de cobradores, sus consultas deben limitarse a su cartera propia.
