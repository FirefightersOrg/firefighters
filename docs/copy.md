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

## The bond record (`src/lib/domain/bond-summary.ts`)

The record opens with sentences built from data, not with labels and values. Every state has its sentence (the full table is the test of that file):

| State               | Sentence                                                                                                                       |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Available           | «Disponible. Todavía no se entregó a ningún cobrador.»                                                                         |
| Delivered           | «Lo tiene {cobrador}. Todavía no se vendió.»                                                                                   |
| Sold, with debt     | «Vendido a {comprador} en 6 cuotas. Lo cobra {cobrador}. Pagó 1 cuota y debe $ 50.000, de los cuales $ 40.000 están vencidos.» |
| Sold in one payment | «Vendido a {comprador} en un pago. Lo cobra {cobrador}. Debe $ 60.000, que vence el 01/12/2026.»                               |
| Sold, paid          | «Vendido a {comprador} en 6 cuotas. Lo cobró {cobrador}. Está pagado.»                                                         |
| Lost                | «Extraviado. Lo tenía {cobrador}.»                                                                                             |
| Annulled            | «Anulado el 20/11/2026. Motivo: {motivo}.»                                                                                     |

- A name the role cannot read is left out («Vendido en 6 cuotas.»): never «Unknown», never a placeholder.
- The next step is named by what it does: «Entregar a un cobrador», «Registrar venta», «Registrar pago».
- An installment says «Pagada el 09/10/2026 en efectivo, rendición 14» only once that settlement is closed. Before that: «Pago de $ 10.000 en efectivo cargado en la rendición 3, que sigue abierta», or «Cobro de $ 10.000 enviado por el cobrador el 26/11/2026, sin procesar».
- No text mentions phases of the project («fase 5»): the record describes the bond, not how the system was built.

## Lists: who has it, and filters

- A row of the bonds list says who has the bond in words: «Vendido a {comprador}, lo cobra {cobrador}», «Lo tiene {cobrador}», «Lo tenía {cobrador}» (lost). When there is nobody, or the role cannot read the name, a dash: never «Unknown».
- The search field is named by what it takes («Número de bono»); the other filters are under «Filtrar». A filter in effect is a chip that says what it is («Estado: Vendido», «Pagos: En mora») and is removed with one click; «Quitar todos» clears them.
- Column and filter names are the short word people say: «Estado» (not «Estado comercial»), «Pagos» (not «Estado financiero»).
- A control that does nothing yet is not shown. No «Fase N» labels.

## The collector's portal: «Por cobrar» and «Cobrar»

- The portal opens on «Por cobrar»: «Vencidas» first, then «Vencen esta semana», each with how many installments and how much («11 cuotas, $ 160.000»).
- A row is the bond, the buyer, «Cuota 2, venció el 25/09/2026» and the amount. Its actions are named by what they do: «Llamar» (a `tel:` link) and «Cobrar».
- «Cobrar» opens a sheet titled with what is being collected («Cobrar la cuota 1 del bono 0012») and its button names the amount («Enviar cobro de $ 10.000»). The sheet says once what sending means: «El cobro queda enviado y se confirma cuando el operador lo incluye en una rendición y la cierra. Una vez enviado, no se puede editar.»
- What was sent and not processed yet stays on the row as «Enviado $ 10.000»; what is already in a settlement, as «En rendición: $ 10.000».
- The tab bar uses one short word per section («Por cobrar», «Bonos», «Ventas», «Compradores», «Cuenta»); the link's full name stays «Mis bonos», «Mi cuenta corriente».
- A collector with no campaign in course reads «No hay una campaña en curso», never a list of drafts or closed campaigns.

## The collector's account

- The balance is said in words, with the figure without a sign: «Saldo a favor del cobrador», «Saldo a cargo del cobrador», «Sin saldo». Under it, one line on what it is: «Suma los movimientos que no están anulados.»
- The commission figures («Comisiones generadas», «Ajustadas», «Liquidadas», «Anulaciones y correcciones») are reference amounts, not the terms of a sum: they are listed under the balance, never drawn as an addition.
- On a phone a movement shows one amount with its sign («− $ 30.000,00» for a debit) instead of a debit and a credit column.

## Registering a sale

- Three steps named by what they ask: «Bono», «Comprador», «Pago». No numbers in the headings.
- An answered step is one line that says the answer («0035 Lo tiene Jorge Medina», «Panadería La Espiga») with the way back named by its object: «Cambiar el bono», «Cambiar el comprador».
- A bond that cannot be sold says why in a sentence: «El bono 0036 no se puede vender: Ya está vendido.»
- The button says what it is about to register: «Confirmar venta del bono 0035 a Panadería La Espiga». Until there is a bond it is «Confirmar venta».
- A collector the role cannot read is not named («Entregado a un cobrador»): never «Unknown collector».

## The sale record (`src/lib/domain/sale-summary.ts`)

The record leads with a figure and its name, then says the sale in sentences built from data. The last sentence is the bond record's, word for word, because both are built from the same installments.

| State          | Figure                       | Sentences                                                                                                                                                            |
| -------------- | ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| With debt      | «Falta cobrar» $ 50.000      | «{comprador} compró el bono 0190 el 16/10/2026 en 6 cuotas, por $ 60.000. Lo cobra {cobrador}. Pagó 1 cuota y debe $ 50.000, de los cuales $ 10.000 están vencidos.» |
| In one payment | «Falta cobrar» $ 60.000      | «{comprador} compró el bono 0190 el 16/10/2026 en un pago, por $ 60.000. Lo cobra {cobrador}. Debe $ 60.000, que vence el 01/12/2026.»                               |
| Paid           | «Pagado» $ 60.000            | «… Lo cobró {cobrador}. Está pagado.»                                                                                                                                |
| Uncollectible  | «Quedó sin cobrar» $ 50.000  | «… Lo cobró {cobrador}. Se dio por incobrable: quedaron $ 50.000 sin cobrar.»                                                                                        |
| Annulled       | «Total de la venta» $ 60.000 | «… La venta fue anulada: no se cobra.»                                                                                                                               |

- A buyer the role cannot read turns the first sentence into «El bono 0190 se vendió el 16/10/2026 en 6 cuotas, por $ 60.000.»; a collector it cannot read drops the second. The name is a link only when the role can open that record.
- The associated number is on its own line («Número asociado 5190»), never beside the bond's number.
- The corrections are under «Corregir la venta», each named by the case it solves and the action it takes: «La venta figura a nombre de otro comprador.» / «Corregir el comprador»; «La vendió otro cobrador.» / «Corregir el cobrador»; «Ya no se va a poder cobrar.» / «Marcar como incobrable»; «Se marcó como incobrable por error, o se volvió a cobrar.» / «Revertir la marca».
- Each one asks for its reason in a dialog whose title is the question («¿Corregir el cobrador de la venta del bono 0190?»), whose text says what figures today and what the change does, and whose button repeats the action. «Marcar como incobrable» says who can undo it: «Solo un administrador puede revertir la marca.»
- In tables, where a sentence cannot be rebuilt, a party the role cannot read is «Sin acceso al comprador» or «Sin acceso al cobrador» (`src/lib/domain/parties.ts`), as plain text with no link. No screen says «Unknown».

## The campaign home (`src/lib/domain/campaign-home.ts`)

- Under the title, a campaign under way says when it ends («Hasta el 29/06/2027, 6 cuotas de $ 10.000»); a draft or a closed one says both dates («Del … al …»).
- The day's actions are four, named by what they do: «Registrar venta», «Registrar pago», «Entregar bonos», «Cargar bonos». The search is the page's primary button («Buscar bono»); on a draft it is «Activar».
- «Para resolver» lists what waits for someone, as a sentence with its count, a line that says why it matters, and the name of where it leads. The section is not drawn when nothing waits.

| What waits                        | Sentence                                                        | Second line                                                                             | Leads to                                     |
| --------------------------------- | --------------------------------------------------------------- | --------------------------------------------------------------------------------------- | -------------------------------------------- |
| Payments sent by a collector      | «2 cobros enviados por Jorge Medina sin procesar»               | «$ 20.000. Su rendición no se puede cerrar hasta incluirlos o rechazarlos.»             | «Abrir la rendición»                         |
| The same, with no open settlement | «1 cobro enviado por Marta Giménez sin procesar»                | «$ 10.000. No tiene una rendición abierta: hace falta una para incluirlo o rechazarlo.» | «Abrir una rendición» (or «Ver rendiciones») |
| Sold bonds short of the next draw | «8 bonos vendidos pueden quedar fuera de «Sorteo de noviembre»» | «El sorteo exige la cuota 2 paga. El corte es el 05/12/2026, 23:59: faltan 9 días.»     | «Ver los bonos» (listed under the item)      |
| The same, after the cutoff        | «9 bonos vendidos no entran en «Sorteo de octubre»»             | «El sorteo exige la cuota 1 paga. El corte fue el 25/11/2026, 23:59.»                   | «Ver los bonos»                              |
| Open settlements                  | «3 rendiciones abiertas»                                        | «Sus pagos quedan confirmados cuando se cierran.»                                       | «Ver rendiciones»                            |

- Every figure says what it is measured against on its own line: «148 de 240», «58 sin vender; 33 sin entregar», «$ 4.470.000 de $ 8.880.000 vendidos», «$ 1.010.000 de $ 4.410.000 por cobrar».
- Every amount on the home is in whole pesos (rounded): it is a summary. The records and the reports keep the cents.
- «Saldo a favor de cada cobrador» lists amounts without a sign. A balance the other way says «a favor de Bomberos» under the amount: never a minus sign alone.
- A part that could not be loaded says which: «No se pudieron cargar los bonos, lo cobrado y el próximo sorteo. Volver a intentar.»

## Operation lists: sales, settlements, delivery notes

A row starts with what the record is called, and that name carries the only link of the row. Then its state, in words, and its amount in whole pesos.

| List           | The row, as it is said                                                             | Second line on a phone                                             | State                                                                                                                                      |
| -------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Sales          | «0190 Oscar Pérez»: the bond number is the sale's identifier and opens the sale    | «Lo cobra Héctor Acosta» and the total of the sale                 | How its payments stand, under «Pagos» as on the bonds list: «Sin pagos», «Al día», «En mora», «Pagado». Not active: «Corregida», «Anulada» |
| Settlements    | «Rendición 15 de Héctor Acosta»                                                    | «Abierta el 26/11/2026», or «Cerrada el 26/11/2026» and its total  | «Abierta», «Cerrada», «Anulada», «Corregida». The open ones come first                                                                     |
| Delivery notes | «Remito 0007 a Jorge Medina»; «Remito 0013 de Lucía Fernández» when it is a return | «Entrega del 26/11/2026», «Reasignación del …», «Devolución del …» | «5 bonos» ends the first line; an annulled note adds «Anulado» to its reason                                                               |

- No «#15» and no column of ids: a settlement is «Rendición 15», a note is «Remito 0007» (four digits, as printed).
- An open settlement has no total yet (it is computed when it closes): a dash on the desktop table, nothing on the phone. Never «$ 0».
- The search field is named by what it takes: «Nombre del comprador» on sales, «Número de remito» on delivery notes. Settlements have no search, only «Filtrar».
- A date filter says which date it is: «Abierta desde» and «Abierta hasta» (settlements), «Emitido desde» and «Emitido hasta» (delivery notes). Its chip writes the date as people do: «Abierta desde: 01/11/2026».
- The count above the table: «Mostrando 1–25 de 148 ventas», «Mostrando 1–13 de 13 remitos», and for settlements, which are not paged, «16 rendiciones, 3 abiertas».
- Empty lists say how the first record comes to be: «Una venta se registra con un bono que ya tiene un cobrador y el comprador que lo lleva.», «Abrir una rendición para cargar los pagos que entrega un cobrador.», «Un remito se emite al entregar bonos a un cobrador, al reasignarlos o al recibirlos de vuelta.» With filters: «Ninguna venta coincide con los filtros» and «Probar con otros filtros o quitarlos para ver todas las ventas.»
- A collector or a buyer the role cannot read: the phone sentence leaves the name out («Rendición 15», «Remito 0007»); where the row would otherwise have nothing, and in the desktop column, it is «Sin acceso al comprador» or «Sin acceso al cobrador» in muted text. Names are plain text on these lists, never links.

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
