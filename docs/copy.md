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

## Glossary

The code, database and existing docs are in English; the UI and printable documents use these Spanish terms. Table and enum names do not change.

| English (code, docs)     | Spanish (UI)                      | Notes                                                                                                                                                          |
| ------------------------ | --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Campaign                 | Campaña                           | Draft: borrador. Active: activa. Closing: en cierre. Closed: cerrada. Annulled: anulada.                                                                       |
| Bond                     | Bono                              | Generic word for the sellable item.                                                                                                                            |
| Simple bond              | Bono simple                       |                                                                                                                                                                |
| Pata (bond with legs)    | Pata                              | Keep «pata» in Spanish everywhere. A bono with patas; «grupo de patas» for a manual group.                                                                     |
| Manual pata / ungroup    | Pata manual / desagrupar          |                                                                                                                                                                |
| Base number              | Número base                       |                                                                                                                                                                |
| Associated number        | Número asociado                   |                                                                                                                                                                |
| Barcode                  | Código de barras                  |                                                                                                                                                                |
| Commercial status        | Estado comercial                  | Available: disponible. Delivered to collector: entregado al cobrador. Sold: vendido. Returned: devuelto. Lost: extraviado. Annulled: anulado. Closed: cerrado. |
| Financial status         | Estado financiero                 |                                                                                                                                                                |
| Collector                | Cobrador                          | Plural: cobradores.                                                                                                                                            |
| Buyer                    | Comprador                         | Not «cliente».                                                                                                                                                 |
| Sale                     | Venta                             |                                                                                                                                                                |
| Payment plan             | Plan de pago                      |                                                                                                                                                                |
| Installment              | Cuota                             | «Cuota 2 de 6».                                                                                                                                                |
| Payment                  | Pago                              | Method: cash: efectivo; transfer: transferencia.                                                                                                               |
| Payment certificate      | Comprobante de pago               | Internal receipt: número de recibo.                                                                                                                            |
| Delivery note (bonds)    | Remito de entrega                 | Return: remito de devolución.                                                                                                                                  |
| Settlement               | Rendición                         | A collector's periodic accounting (open: abierta; closed: cerrada). Not «liquidación».                                                                         |
| Settlement delivery note | Remito de rendición               |                                                                                                                                                                |
| Commission               | Comisión                          | Generated: generada. Settled: liquidada. Adjustment: ajuste.                                                                                                   |
| Liquidation              | Liquidación                       | Only for paying out commission («comisión liquidada»). Do not use it for the collector's rendición.                                                            |
| Collector balance        | Saldo del cobrador                |                                                                                                                                                                |
| Draw                     | Sorteo                            | Extraordinary draw: sorteo extraordinario.                                                                                                                     |
| Roster                   | Padrón                            | Frozen roster: padrón congelado. Eligible: habilitado.                                                                                                         |
| Prize                    | Premio                            | Unawarded prize: premio no adjudicado. Delivery: entrega del premio.                                                                                           |
| Winning number           | Número ganador                    |                                                                                                                                                                |
| Import session           | Sesión de importación             |                                                                                                                                                                |
| Audit log                | Registro de auditoría             |                                                                                                                                                                |
| Annul / annulment        | Anular / anulación                | Never «eliminar» or «borrar» for business records. Requires a reason: motivo.                                                                                  |
| Correction               | Corrección                        |                                                                                                                                                                |
| Backup / restore         | Copia de seguridad / restauración |                                                                                                                                                                |
| Institution              | Institución                       |                                                                                                                                                                |
| User / role / permission | Usuario / rol / permiso           |                                                                                                                                                                |

Choices to keep in mind:

- **Rendición vs. liquidación.** The accounting a collector hands in is a rendición; paying a commission out is a liquidación. The English «settlement» maps to rendición.
- **Padrón** is the frozen list of eligible numbers of a draw, not «lista» or «nómina».
- **Cobrador** and **comprador** are always distinct: the cobrador collects, the comprador owns the bono.
