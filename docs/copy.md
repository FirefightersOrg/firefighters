# Copy guide and glossary

## Objective

One Spanish voice and one set of domain terms for every screen, message and printable document. Decided in SAN-126; formatting lives in `src/lib/format.ts` (SAN-131). Screen tickets must follow this guide; changes to a term are made here first.

## Voice (SAN-126)

Neutral Spanish that avoids second person.

- Buttons and actions use the infinitive: «Guardar cambios», «Anular registro», «Cerrar sesión», «Registrar pago».
- Messages are impersonal: «No se pudo guardar. Revisar la conexión y volver a intentar.»
- No voseo («Ingresá», «Revisá») and no «usted» forms. If second person is ever unavoidable, use «tú».
- Say what happened, then what to do. Do not blame the person and do not use exclamation marks.
- Destructive actions name the object and ask for a reason when the rules require one: «Anular pago», never «Eliminar».
- Sentence case everywhere (only the first word and proper nouns are capitalized). Use the same term for the same concept; never alternate synonyms.

## Formatting (SAN-126, `src/lib/format.ts`)

Locale `es-AR`, time zone `America/Argentina/Buenos_Aires`. Always use the helpers, never a hand-written `Intl` call or `toLocaleString`.

| Value                          | Helper                                   | Example               |
| ------------------------------ | ---------------------------------------- | --------------------- |
| Number                         | `formatNumber`                           | `1.284.500,75`        |
| Money, whole amount            | `formatMoney`                            | `$ 1.284.500`         |
| Money, with cents              | `formatMoney`                            | `$ 1.284.500,75`      |
| Money in documents and ledgers | `formatMoney(v, { decimals: 'always' })` | `$ 100,00`            |
| Calendar date                  | `formatDate`                             | `24/11/2026`          |
| Date and time (24 h)           | `formatDateTime`                         | `24/11/2026, 18:05`   |
| Time                           | `formatTime`                             | `18:05`               |
| Relative (under 7 days only)   | `formatRelative`                         | `ayer`, `hace 3 días` |
| Zero-padded number             | `formatPaddedNumber`                     | `0007`                |

Rules:

- A SQL `date` (payment date, sale date) is a calendar day: it prints without time and without zone shifts. Timestamps are shown in Buenos Aires time.
- Missing or invalid values print `—`.
- `Intl` puts a non-breaking space between `$` and the amount. Do not replace it and do not compare against strings with hardcoded spaces in tests.
- Parsing what people type stays in `src/lib/domain/money.ts` and `percent.ts`; `format.ts` is display only.

## The institution's name

The interface names the institution, not the software: «Bomberos Voluntarios» beside the red mark, in page titles (`Ventas - Bono 2026 - Bomberos Voluntarios`) and on documents. It comes from `PUBLIC_INSTITUTION_NAME` through `institutionName()` (`src/lib/institution.ts`). «Firefighters» is the repository's name and is never shown. In sentences about money, the institution is «Bomberos» («Neto para Bomberos», «Ajuste a favor de Bomberos»).

## Error pages (`src/lib/error-copy.ts`)

An error page says what happened and where to go, inside the same navigation as the rest of the app. It never shows a status word in English («Forbidden», «Not Found»).

| Status | Heading                   | Body                                                                                                                                          | Actions                                |
| ------ | ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| 403    | Sin acceso a esta sección | Whose section it is, from the missing permission: «Esta sección es de tesorería. Para usarla, pedir el acceso a quien administra el sistema.» | The way back                           |
| 404    | No se encontró            | What was not found, when the server says it («Sorteo no encontrado.»), then «Revisar la dirección o volver a la lista.»                       | The section's list, then the home      |
| 500+   | No se pudo cargar         | The server's message, or «Algo salió mal. Volver a intentar.»                                                                                 | «Volver a intentar», then the way back |

The areas are «tesorería» (settlements, payments, commissions, current account, financial reports), «operación» (loading and delivering bonds, sales, managing collectors and buyers) and «administración» (campaigns, draws, prizes, audit, users).

## The open settlement (`src/lib/components/settlements/OpenSettlement.svelte`)

| Where                   | Text                                                                                  | Why                                                                                   |
| ----------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Entry field             | «Número del bono que pagó»                                                            | The number is what the collector and the treasurer both have in front of them.        |
| Hint                    | «Solo los bonos que vendió {cobrador}. Enter busca; otro Enter agrega el pago.»       | Says what the field searches and how the keyboard works.                              |
| Number not found        | «{cobrador} no tiene una venta con deuda para el bono {n}. No se agregó ningún pago.» | Says what happened and that nothing changed.                                          |
| Add button              | «Agregar pago de $ 10.000»                                                            | The button names the amount it is about to record.                                    |
| Partial amount          | «Pagó otro importe»                                                                   | Opens the amount of each checked installment for editing.                             |
| Sheet                   | «Hasta ahora», «Comisión que se queda el cobrador», «Neto para Bomberos»              | The same rows as the closed sheet, in the present.                                    |
| Cash to hand over       | «{cobrador} tiene que entregar $ 45.000 en efectivo.»                                 | The figure the treasurer counts: cash less the commission kept. Transfers are not in. |
| Task bar (phone)        | «Entrega en efectivo», «Revisar y cerrar»                                             | «Revisar»: the dialog shows the sheet before the close.                               |
| Close                   | «Cerrar rendición», «¿Cerrar la rendición 9 de {cobrador}?»                           | A normal, primary action (P4); the dialog says it cannot be reopened.                 |
| Row menu                | «Quitar de la rendición», «¿Quitar el pago del bono 0019 de esta rendición?»          | The dialog asks for the reason; the payment stays on record under «Pagos quitados».   |
| Campaign page           | «Registrar pago»                                                                      | Leads to the collector's open settlement, or opens one.                               |
| Collector with one open | «{cobrador} ya tiene abierta la rendición 9», «Cargar pagos en la rendición 9»        | A collector has one open settlement at a time.                                        |

## Lists: who has it, and filters

- A row of the bonds list says who has the bond in words: «Vendido a {comprador}, lo cobra {cobrador}», «Lo tiene {cobrador}», «Lo tenía {cobrador}» (lost). When there is nobody, or the role cannot read the name, a dash: never «Unknown».
- The search field is named by what it takes («Número de bono»); the other filters are under «Filtrar». A filter in effect is a chip that says what it is («Estado: Vendido», «Pagos: En mora») and is removed with one click; «Quitar todos» clears them.
- Column and filter names are the short word people say: «Estado» (not «Estado comercial»), «Pagos» (not «Estado financiero»).
- A control that does nothing yet is not shown. No «Fase N» labels.

## Glossary

The code, database and existing docs are in English; the UI and printable documents use these Spanish terms. Table and enum names do not change.

| English (code, docs)     | Spanish (UI)                      | Notes                                                                                                                                                               |
| ------------------------ | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Campaign                 | Campaña                           | Draft: borrador. Active: activa. Closing: en cierre. Closed: cerrada. Annulled: anulada.                                                                            |
| Bond                     | Bono                              | Generic word for the sellable item.                                                                                                                                 |
| Simple bond              | Bono simple                       |                                                                                                                                                                     |
| Pata (bond with legs)    | Pata                              | Keep «pata» in Spanish everywhere. A bono with patas; «grupo de patas» for a manual group.                                                                          |
| Manual pata / ungroup    | Pata manual / desagrupar          |                                                                                                                                                                     |
| Base number              | Número base                       |                                                                                                                                                                     |
| Associated number        | Número asociado                   |                                                                                                                                                                     |
| Barcode                  | Código de barras                  |                                                                                                                                                                     |
| Commercial status        | Estado comercial                  | Available: disponible. Delivered to collector: entregado al cobrador. Sold: vendido. Returned: devuelto. Lost: extraviado. Annulled: anulado. Closed: cerrado.      |
| Financial status         | Estado financiero                 |                                                                                                                                                                     |
| Collector                | Cobrador                          | Plural: cobradores.                                                                                                                                                 |
| Buyer                    | Comprador                         | Not «cliente».                                                                                                                                                      |
| Sale                     | Venta                             |                                                                                                                                                                     |
| Payment plan             | Plan de pago                      |                                                                                                                                                                     |
| Installment              | Cuota                             | «Cuota 2 de 6».                                                                                                                                                     |
| Payment                  | Pago                              | Method: cash: efectivo; transfer: transferencia.                                                                                                                    |
| Collector submission     | Cobro enviado                     | Portal status: `draft` enviado; `pending_in_settlement` en rendición; `confirmed` confirmado; `annulled` rechazado (con motivo). Amounts: «Pendiente de rendición». |
| Payment certificate      | Comprobante de pago               | Internal receipt: número de recibo.                                                                                                                                 |
| Delivery note (bonds)    | Remito de entrega                 | Return: remito de devolución.                                                                                                                                       |
| Settlement               | Rendición                         | A collector's periodic accounting (open: abierta; closed: cerrada). Not «liquidación».                                                                              |
| Settlement delivery note | Remito de rendición               |                                                                                                                                                                     |
| Commission               | Comisión                          | Generated: generada. Settled: liquidada. Adjustment: ajuste.                                                                                                        |
| Liquidation              | Liquidación                       | Only for paying out commission («comisión liquidada»). Do not use it for the collector's rendición.                                                                 |
| Collector balance        | Saldo del cobrador                |                                                                                                                                                                     |
| Draw                     | Sorteo                            | Extraordinary draw: sorteo extraordinario.                                                                                                                          |
| Roster                   | Padrón                            | Frozen roster: padrón congelado. Eligible: habilitado.                                                                                                              |
| Prize                    | Premio                            | Unawarded prize: premio no adjudicado. Delivery: entrega del premio.                                                                                                |
| Winning number           | Número ganador                    |                                                                                                                                                                     |
| Import session           | Sesión de importación             |                                                                                                                                                                     |
| Audit log                | Registro de auditoría             |                                                                                                                                                                     |
| Annul / annulment        | Anular / anulación                | Never «eliminar» or «borrar» for business records. Requires a reason: motivo.                                                                                       |
| Correction               | Corrección                        |                                                                                                                                                                     |
| Backup / restore         | Copia de seguridad / restauración |                                                                                                                                                                     |
| Institution              | Institución                       |                                                                                                                                                                     |
| User / role / permission | Usuario / rol / permiso           |                                                                                                                                                                     |

Choices to keep in mind:

- **Rendición vs. liquidación.** The accounting a collector hands in is a rendición; paying a commission out is a liquidación. The English «settlement» maps to rendición.
- **Padrón** is the frozen list of eligible numbers of a draw, not «lista» or «nómina».
- **Cobrador** and **comprador** are always distinct: the cobrador collects, the comprador owns the bono.
