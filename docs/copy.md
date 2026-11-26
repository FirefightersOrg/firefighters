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

## Deliveries (`src/lib/domain/delivery-summary.ts`)

- The bonds of a delivery are named as the ranges the operator has in the hand: «0211 a 0215» and «5 bonos», a lone bond «0220» and «1 bono», a pata «0100 + 0101» and «Pata de 2 números». Ranges are in number order, whatever the order they were added in, and a gap splits a range, so a missing number is seen.
- Each range has one «Quitar»; for assistive tech it says what it removes: «Quitar los bonos 0211 a 0215», «Quitar el bono 0220», «Quitar la pata 0100 + 0101».
- After each search the line beside «Agregar» says what happened: «5 bonos agregados.», «1 bono agregado.», «Ya está en la lista.», «2 bonos agregados. 1 ya estaba en la lista.», «Ningún bono disponible coincide.». For a range it names what could not be added: «El 0220 no está disponible.», «No están disponibles: 0201 a 0210.», and beyond three gaps only the count («12 números de ese rango no están disponibles.»).
- The button says what is about to be recorded: «Entregar 35 bonos a Jorge Medina». Before there is a collector it is «Entregar 35 bonos»; before there are bonds, «Entregar bonos», not available.
- With several ranges the total is said once under them: «36 bonos en esta entrega.» Units are mentioned only when a pata makes them differ: «3 bonos en esta entrega, 4 unidades contando las patas.»
- The note record says the note in one sentence, with the verb of its reason: «Se entregaron 35 bonos a {cobrador} el 24/11/2026, 10:02.», «Se reasignaron 3 bonos a {cobrador} el …», «{cobrador} devolvió 4 bonos el …». A collector the role cannot read is left out («Se entregaron 35 bonos el …»). Then «Lo registró {persona}.» and «Observaciones: …» when there are any.
- Its one action is «Imprimir». Under the ranges, «Abrir la ficha de un bono» unfolds every bond as a link.

## Draws (`src/lib/domain/draw-steps.ts`)

- A draw is described as «Sorteo mensual del 25/11/2026» («Sorteo final del …», «Sorteo de consuelo del …», «Sorteo extraordinario por pago total del …»).
- The record lists the four steps of a draw in order, each named as an action: «Generar el padrón», «Congelar el padrón», «Cargar los ganadores», «Completar el sorteo». A done step says when («Generado el 24/11/2026, 10:02.», «Congelado el …»); the current one carries the page's one primary button; a later one says what it waits for («Cuando todos los premios estén resueltos, adjudicados o sin adjudicar.»).
- The button of each state: «Generar padrón», «Congelar padrón», «Cargar ganadores» («Ver ganadores y premios» for a role that cannot load them), «Completar sorteo», and on a finished draw with prizes to hand over «Registrar la entrega del premio» / «Registrar las entregas de premios».
- The winners step says how far it is: «Todavía no hay premios configurados. …», «Falta resolver 2 de 3 premios.», «2 premios resueltos. Falta entregar 1.». «Completar sorteo» is not offered while a prize is waiting; the step says why instead.
- What cannot be undone says so before its button. Freezing: «Congelar es definitivo. Un padrón congelado no se vuelve a calcular nunca, aunque después se registren pagos.», with its checkbox. The resolution of a prize: «La resolución no se puede cambiar: para corregirla hay que anular el premio y crear su reemplazo.» Annulling a draw: «Un sorteo anulado no se puede volver a activar.»
- The resolution is two buttons that name their outcome, not «Registrar resolución» over a list: «Adjudicar el premio» and «Dejar sin adjudicar». The second asks in a dialog («¿Dejar sin adjudicar el premio 1, Bicicleta?», «El número 0100 está habilitado, pero el premio queda sin ganador.»). The status word stays «No adjudicado».
- A prize is titled «Premio 1: Televisor», not «#1 — Televisor». When every prize is resolved the winners page says «Todos los premios están resueltos. El sorteo se completa desde su ficha.» with «Ir a completar el sorteo».
- Before the roster is frozen the winners page says «El padrón todavía no está congelado. Los números ganadores se cargan contra el padrón congelado. Mientras tanto se pueden configurar los premios.»
- Roster: on a phone a number is two or three lines, «0100» with «Habilitado» or «No habilitado», then «{comprador}, lo cobra {cobrador}» (a bond nobody bought: «Lo tiene {cobrador}»), then the reason when it is not eligible. The eligibility filter reads «Habilitados» / «No habilitados». A generated roster says «Este padrón todavía puede cambiar: se puede volver a generar hasta que se congele. Se congela desde el sorteo.»

## The collectors, buyers and draws lists (`src/lib/domain/people-draw-lists.ts`)

The three lists follow the bonds list: the search first, the other filters under «Filtrar», what is applied as chips, and rows that name the person or the draw and then the one or two facts people look for.

- The search field is named by what it takes: «Nombre, teléfono o correo» (collectors), «Nombre, teléfono o documento» (buyers; a CUIT is found as a document). The draws list has no search, only «Filtrar». The option that does not filter is «Cualquiera»; the chips say «Estado: Inactivo», «Tipo: Empresa», «Tipo: Mensual», «Estado: Programado».
- Collectors and buyers are shared between campaigns, the figures on their rows are not: the tables are named «Bonos y saldo en esta campaña» and «Bonos en esta campaña».
- A count of bonds is said with its noun where there is no column header: «35 bonos», «1 bono», «Sin bonos». The columns are «Bonos asignados» (the collector record's term: it counts the bonds the collector holds and the ones they sold and collect) and «Bonos en esta campaña» (buyers).
- A collector's balance is said in words, with the figure without a sign: «A favor del cobrador $ 41.000», «A cargo del cobrador $ 3.500», «Sin saldo». Never «$ -3.500», and never «A favor» alone, which does not say whose favour. Only the roles that read the financial reports see it; the others get no column, not «Sin saldo».
- A collector's status is the «Estado» column; on a phone only «Inactivo» is marked, beside the name.
- A phone number is a link that dials it. A buyer without a phone has a dash on a computer and nothing on a phone.
- A usual collector the role cannot read is «Sin acceso al cobrador» (`src/lib/domain/parties.ts`).
- The draws are a calendar in two tables: «Sorteos por realizar», the next one first, and «Sorteos realizados o anulados», the latest first. When every draw was held or annulled: «No queda ningún sorteo por realizar.» The state says the roster in words («Padrón generado», «Padrón congelado»); the date and the cutoff are «Fecha» and «Corte de pagos» (the label of the draw form).
- An empty list says what to do:

| List       | Nothing loaded yet                                                                                                                                                   | Nothing matches                                                                                                               |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Collectors | «Todavía no hay cobradores» / «Cargar el primero con «Nuevo cobrador» para poder entregarle bonos.» Without the permission: «Los carga quien administra el sistema.» | «Ningún cobrador coincide con la búsqueda» / «Probar con otro nombre, teléfono o correo.» / button «Ver todos los cobradores» |
| Buyers     | «Todavía no hay compradores» / «Se cargan al registrar una venta, o antes con «Nuevo comprador».» Without the permission: «Se cargan al registrar una venta.»        | «Ningún comprador coincide con la búsqueda» / «Probar con otro nombre, teléfono o documento.» / «Ver todos los compradores»   |
| Draws      | «Todavía no hay sorteos» / «Crear el primero con «Nuevo sorteo».» Without the permission: «Los crea quien administra la campaña.»                                    | «Ningún sorteo coincide con los filtros» / «Probar con otro tipo u otro estado.» / «Ver todos los sorteos»                    |

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

## The collector record, the current account and the buyer record

The three records open as the bond and sale records do: a figure with its name, sentences built from data by a pure function, then the one next step.

**The collector record** (`src/lib/domain/collector-summary.ts`):

| State                        | Sentences                                                                                                                                                                     |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| With debt and a balance      | «{cobrador} tiene 35 bonos: 26 vendidos y 9 sin vender. Le falta cobrar $ 760.000, de los cuales $ 150.000 están vencidos. Tiene $ 17.000 a su favor en la cuenta corriente.» |
| All overdue, balance against | «… Le falta cobrar $ 10.000, todo vencido. Su cuenta corriente tiene $ 5.000 a favor de Bomberos.»                                                                            |
| Nothing to collect           | «{cobrador} tiene 9 bonos, todos sin vender.» / «… No le falta cobrar nada. Su cuenta corriente no tiene saldo.»                                                              |
| No bonds                     | «{cobrador} no tiene bonos de esta campaña.»                                                                                                                                  |
| With sales given up          | «… Le falta cobrar $ 10.000. Otros $ 50.000 se dieron por incobrables.»                                                                                                       |

- «Falta cobrar» is what «Registrar pago» will offer: every unpaid installment by what it still owes, after every payment that is not annulled (a payment loaded in a settlement that is still open already counts). A sale given up as uncollectible is said apart.
- A balance the role cannot read is left out of the sentence: never «$ 0», never a dash. The same for the settlements: a role that cannot read them does not see the heading.
- The next step is «Registrar pago» when something is owed, or «Cargar pagos en la rendición 9» when the collector already has one open; with nothing owed it is «Entregar bonos».
- Lists are named by what they hold, with the count beside the name: «Cuotas por cobrar 71», «Bonos 35», «Rendiciones 3». A row of what is owed is the bond, the buyer, «Cuota 2, venció el 25/09/2026» and the amount. What does not fit is behind «Ver las otras 61 cuotas» (never «Ver más»).
- The bonds the collector still has are listed by number under «Sin vender: 9», with the delivery notes they came with («Entregados con el remito 0002.»); the sold ones are under «Bonos vendidos».
- Bulk return and reassignment are under «Devolver o reasignar bonos», named by what they do. The buttons say how many («Devolver 2 bonos», «Reasignar 1 bono») and the dialog asks with the names: «¿Reasignar el bono 0705 de {cobrador} a {otro}?», «Pasa a manos de {otro}. Se emite un remito de reasignación.»

**The current account** (`ledgerSheet` in `src/lib/domain/ledger.ts`):

- The balance is said in words, with the figure without a sign: «Saldo a favor del cobrador», «Saldo a favor de Bomberos», «Sin saldo». Staff read «a favor de Bomberos» where the collector's portal says «a cargo del cobrador»: each side reads it from where it stands.
- It is the lead of a sheet that adds up: «Comisiones generadas», «Ajustes a favor del cobrador», less «Comisiones liquidadas», «Ajustes a favor de Bomberos». «Efectivo rendido» and «Transferencias recibidas por Bomberos» are reference amounts under it.
- One line says how to read it: «Suma los movimientos que no están anulados. Un importe con signo menos es a favor de Bomberos.»
- A movement shows one amount with its sign and cents («− $ 17.000,00»), newest first. Only a movement that does not count carries a badge («Anulado», «Compensado»).
- The dialog names the movement it annuls: «¿Anular el movimiento «Ajuste a favor de Bomberos» del 26/11/2026?», «Es de $ 800,00. …».

**The buyer record** (`src/lib/domain/buyer-summary.ts`):

| State         | Figure                  | Sentences                                                                                                                     |
| ------------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| One bond      | «Falta cobrar» $ 20.000 | «{comprador} compró el bono 0190 en esta campaña. Debe $ 20.000, de los cuales $ 10.000 están vencidos. Lo cobra {cobrador}.» |
| Several bonds | «Falta cobrar» $ 70.000 | «{comprador} compró 2 bonos en esta campaña. Debe $ 70.000, de los cuales $ 10.000 están vencidos.»                           |
| Paid          | «Pagado» $ 60.000       | «… No debe nada. Lo cobró {cobrador}.»                                                                                        |
| No bonds      |                         | «{comprador} no compró bonos en esta campaña.»                                                                                |

- The heading keeps the name as it is filed («Pérez, Verónica»); the sentence says it as it is spoken («Verónica Pérez»).
- Each bond is a row with its terms and its debt in the words of the sale record: «Lo compró el 15/09/2026 en 6 cuotas, por $ 60.000. Pagó 2 cuotas y debe $ 40.000, de los cuales $ 10.000 están vencidos.» The collector is named once in the sentence when it is the same for every bond, and on each row when it is not.
- The way to call is a button that says the number: «Llamar al 2364 53-8769».
- «Registrar pago» is offered when everything that is owed is collected by one collector; otherwise each sale offers it.

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
