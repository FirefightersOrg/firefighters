# Modelo de datos preliminar

## Objetivo

Definir el modelo relacional conceptual para el MVP. Los nombres son preliminares y deben convertirse luego en migraciones SQL versionadas.

## Principios

- PostgreSQL sera la fuente de verdad.
- Usar claves foraneas reales.
- Usar constraints para invariantes criticas.
- No borrar datos economicos historicos.
- Modelar saldos como movimientos, no como campos editables.
- Separar valor interno de formato visible en numeros de bonos.
- Mantener reglas configurables por campana.

## Entidades principales

### campaigns

Representa una campana anual.

Campos sugeridos:

- `id`
- `name`
- `status`
- `starts_at`
- `ends_at`
- `simple_bond_value`
- `installment_count`
- `installment_value`
- `number_digits`
- `max_number`
- `associated_number_offset`
- `overflow_policy`
- `barcode_mode`
- `created_at`
- `updated_at`

Constraints sugeridas:

- `number_digits > 0`
- `max_number > 0`
- `associated_number_offset >= 0`
- `overflow_policy in ('reject')` inicialmente

### profiles

Representa usuarios de aplicacion vinculados a Supabase Auth.

Campos sugeridos:

- `id`
- `auth_user_id`
- `full_name`
- `email`
- `status`
- `created_at`

### roles

Roles de aplicacion.

Valores iniciales:

- `admin`
- `operador`
- `tesorero`
- `cobrador`
- `consulta`

### permissions

Permisos granulares de aplicacion.

Campos sugeridos:

- `id`
- `code`
- `description`

Ejemplos:

- `payment.annul`
- `rendition.close`
- `commission.adjust`
- `draw.freeze_roster`

### role_permissions

Relacion entre roles y permisos.

Campos sugeridos:

- `role_id`
- `permission_id`

### user_roles

Relacion entre usuarios y roles.

Campos sugeridos:

- `user_id`
- `role_id`

### collectors

Cobradores o vendedores.

Campos sugeridos:

- `id`
- `display_name`
- `phone`
- `email`
- `address`
- `user_profile_id`
- `status`
- `created_at`

### buyers

Compradores.

Campos sugeridos:

- `id`
- `type`
- `first_name`
- `last_name`
- `business_name`
- `document_number`
- `tax_id`
- `phone`
- `address`
- `usual_collector_id`
- `notes`
- `created_at`

### bonds

Unidad comercial vendible: bono simple o pata.

Campos sugeridos:

- `id`
- `campaign_id`
- `kind`
- `origin`
- `internal_code`
- `barcode`
- `commercial_status`
- `financial_status_snapshot`
- `current_collector_id`
- `current_buyer_id`
- `commercial_unit_count`
- `total_value`
- `created_at`

Valores de `kind`:

- `simple`
- `pata`

Valores de `origin`:

- `printed`
- `manual_grouping`

Regla:

- Para bono simple, `commercial_unit_count = 1`.
- Para pata, `commercial_unit_count = cantidad de numeros base`.

### bond_numbers

Numeros participantes asociados a bonos.

Campos sugeridos:

- `id`
- `campaign_id`
- `bond_id`
- `number_value`
- `number_kind`
- `source_base_number_id`
- `created_at`

Valores de `number_kind`:

- `base`
- `associated`
- `extraordinary`

Constraints criticas:

- Unico `(campaign_id, number_value)` para evitar duplicados de numeros participantes.
- `number_value >= 0`.
- `number_value <= campaign.max_number` debe validarse por servicio o trigger documentado, ya que cruza contra configuracion de campana.

Notas:

- El numero visible se deriva de `number_value` y `campaign.number_digits`.
- No usar `char(4)` ni longitud fija.

### bond_assignments

Historial de entrega, devolucion y reasignacion de bonos.

Campos sugeridos:

- `id`
- `campaign_id`
- `bond_id`
- `collector_id`
- `assignment_type`
- `status`
- `assigned_at`
- `returned_at`
- `created_by`
- `notes`

Tipos:

- `delivery`
- `return`
- `reassignment`
- `lost`

### delivery_notes

Remitos de entrega.

Campos sugeridos:

- `id`
- `campaign_id`
- `note_number`
- `collector_id`
- `status`
- `issued_at`
- `created_by`
- `notes`

### delivery_note_items

Items de remitos de entrega.

Campos sugeridos:

- `delivery_note_id`
- `bond_id`

### sales

Venta de un bono a un comprador.

Campos sugeridos:

- `id`
- `campaign_id`
- `bond_id`
- `buyer_id`
- `collector_id`
- `sold_at`
- `payment_mode`
- `total_amount`
- `status`
- `created_by`

### payment_plans

Plan de pago generado para una venta.

Campos sugeridos:

- `id`
- `sale_id`
- `installment_count`
- `total_amount`
- `status`

### installments

Cuotas del plan de pago.

Campos sugeridos:

- `id`
- `payment_plan_id`
- `installment_number`
- `due_date`
- `amount`
- `status`

Constraints:

- Unico `(payment_plan_id, installment_number)`.

### payments

Pagos registrados.

Campos sugeridos:

- `id`
- `campaign_id`
- `sale_id`
- `collector_id`
- `buyer_id`
- `rendition_id`
- `amount`
- `payment_method`
- `payment_date`
- `status`
- `created_by`
- `created_at`
- `annulled_by`
- `annulled_at`
- `annulment_reason`

Metodos:

- `cash`
- `transfer`

Estados:

- `draft`
- `pending_in_rendition`
- `confirmed`
- `annulled`
- `adjusted`

### payment_installments

Relacion entre pagos y cuotas cubiertas.

Campos sugeridos:

- `payment_id`
- `installment_id`
- `amount_applied`

### renditions

Rendiciones de cobradores.

Campos sugeridos:

- `id`
- `campaign_id`
- `rendition_number`
- `collector_id`
- `status`
- `opened_at`
- `closed_at`
- `created_by`
- `closed_by`
- `total_cash`
- `total_transfer`
- `total_amount`
- `commission_amount`
- `commission_paid_amount`
- `net_to_firefighters`
- `notes`

Regla:

- Totales pueden guardarse como snapshot al cierre, pero deben poder reconstruirse desde pagos y movimientos.

### commission_rules

Reglas de comision por campana.

Campos sugeridos:

- `id`
- `campaign_id`
- `rule_type`
- `installment_number`
- `percentage`
- `fixed_amount`
- `applies_to_collector_id`
- `valid_from`
- `valid_to`

### commission_adjustments

Ajustes manuales de comision.

Campos sugeridos:

- `id`
- `campaign_id`
- `collector_id`
- `rendition_id`
- `payment_id`
- `amount`
- `direction`
- `reason`
- `created_by`
- `created_at`

Regla:

- Todo ajuste debe generar movimiento de cuenta corriente y auditoria.

Tipos:

- `cash_full_payment`
- `installment_first`
- `installment_middle`
- `installment_last`
- `custom`

### collector_ledger_entries

Ledger de cuenta corriente del cobrador.

Campos sugeridos:

- `id`
- `campaign_id`
- `collector_id`
- `rendition_id`
- `payment_id`
- `entry_type`
- `direction`
- `amount`
- `status`
- `occurred_at`
- `created_by`
- `reason`

Valores de `direction`:

- `collector_credit`
- `collector_debit`

Regla:

- El saldo del cobrador se calcula sumando movimientos no anulados.

### draws

Sorteos.

Campos sugeridos:

- `id`
- `campaign_id`
- `draw_type`
- `name`
- `draw_date`
- `payment_cutoff_at`
- `required_installment_number`
- `eligibility_rule`
- `status`

Tipos:

- `monthly`
- `extraordinary_full_payment`
- `final`
- `consolation`

### draw_rosters

Padrones de sorteo.

Campos sugeridos:

- `id`
- `draw_id`
- `status`
- `generated_at`
- `frozen_at`
- `generated_by`
- `frozen_by`

### draw_roster_entries

Entradas congeladas de padron.

Campos sugeridos:

- `id`
- `draw_roster_id`
- `bond_id`
- `bond_number_id`
- `number_value`
- `buyer_snapshot`
- `collector_snapshot`
- `eligible`
- `ineligibility_reason`

Regla:

- Guardar snapshots suficientes para justificar resultado historico aunque cambien datos actuales.

### prizes

Premios de sorteos.

Campos sugeridos:

- `id`
- `draw_id`
- `name`
- `description`
- `position`
- `status`

### winning_numbers

Numeros ganadores cargados.

Campos sugeridos:

- `id`
- `draw_id`
- `prize_id`
- `number_value`
- `matched_roster_entry_id`
- `result_status`
- `loaded_by`
- `loaded_at`
- `notes`

Estados de resultado:

- `pending_review`
- `eligible_winner`
- `not_eligible`
- `no_match`

### prize_awards

Resultado administrativo de premios.

Campos sugeridos:

- `id`
- `prize_id`
- `winning_number_id`
- `bond_id`
- `buyer_id`
- `collector_id`
- `status`
- `awarded_at`
- `delivered_at`
- `created_by`
- `notes`

### audit_log

Auditoria general.

Campos sugeridos:

- `id`
- `actor_user_id`
- `action`
- `entity_type`
- `entity_id`
- `old_value`
- `new_value`
- `reason`
- `created_at`
- `request_id`

### import_sessions

Sesiones de carga por codigo de barras, archivo o sistema viejo.

Campos sugeridos:

- `id`
- `campaign_id`
- `source_type`
- `status`
- `created_by`
- `created_at`
- `confirmed_at`
- `notes`

### import_session_items

Items de una sesion de importacion.

Campos sugeridos:

- `id`
- `import_session_id`
- `raw_value`
- `parsed_value`
- `barcode`
- `item_type`
- `status`
- `error_message`

### legacy_migration_staging

Area de staging para datos exportados del sistema viejo.

Campos sugeridos:

- `id`
- `source_file_id`
- `record_type`
- `raw_data`
- `normalized_data`
- `status`
- `error_message`

## Indices sugeridos

- `bond_numbers(campaign_id, number_value)` unico.
- `bonds(campaign_id, commercial_status)`.
- `bonds(campaign_id, current_collector_id)`.
- `buyers(document_number)` cuando exista.
- `buyers(tax_id)` cuando exista.
- `payments(campaign_id, status)`.
- `payments(rendition_id)`.
- `installments(payment_plan_id, installment_number)` unico.
- `collector_ledger_entries(collector_id, campaign_id, occurred_at)`.
- `draw_roster_entries(draw_roster_id, number_value)`.
- `import_sessions(campaign_id, status)`.
- `import_session_items(import_session_id, status)`.

## Reglas de integridad criticas

- No duplicar numeros participantes por campana.
- No vender un bono anulado o extraviado.
- No reasignar directamente un bono vendido.
- No editar directamente rendiciones cerradas.
- No editar directamente pagos confirmados.
- No recalcular padrones congelados.
- No calcular saldos desde campos manuales editables.
- No confirmar importaciones con errores bloqueantes.
- No aplicar ajustes de comision sin motivo y auditoria.
