# UX direction

> The screenshots, the prototypes and the two measuring scripts this document refers to were removed from the tree in PR 20. The paths are kept as they were; the files are in the repository's history, see [«Where the evidence went»](README.md#where-the-evidence-went).

The vision for the frontend redesign: principles, navigation, the patterns each kind of screen follows, and prototypes of the four screens that matter most. It answers the problems in [`audit.md`](audit.md) (referenced as A1, A2, …). Nothing here is implemented yet. Once this direction is approved, `plan.md` turns it into small PRs.

All interface text below is in Spanish, as it will ship. This document, like the rest of the repo docs, is in English.

## What this builds on

The visual direction approved in #50 and merged in #145 to #148 stays as it is:

- navy `#1d3557` for actions, paper `#f7f7f5` for the background, ink `#1a1d21` for text;
- fire-engine red `#b42318` only on the institution mark and the bond stub;
- reflective yellow `#f5c518` for focus and for the active navigation item;
- IBM Plex Sans, with Plex Sans Condensed 700 for bond numbers and lead amounts;
- the campaign as a workbench, the closed settlement as a cash sheet, the winning number as a bond stub.

Those three screens proved the language. This direction applies it to the rest of the app and fixes what the language alone does not fix: how people move between screens, and how many steps the daily work takes.

Five changes to what was approved were listed as explicit proposals in [Proposals that change what was approved](#proposals-that-change-what-was-approved). Santi accepted all five on 2026-11-26, after reviewing them with Juan.

## Who uses it, and where

| Person                        | Where                                              | What they need from a screen                                                           |
| ----------------------------- | -------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Treasurer                     | At the station desk, cash on the table, in a hurry | Take a collector's money without mixing up a bond or an amount; know what to hand over |
| Operator                      | Desk or phone, between other tasks                 | Find a bond in seconds; deliver bonds; register a sale                                 |
| Collector                     | On the sidewalk, phone in one hand                 | Who to visit today, how much to ask for, and send the payment in two taps              |
| Admin, read-only, draw nights | Desk, a few times a month                          | Reports, configuration, rosters and winners that can be explained to a buyer           |

## Principles

1. **The bond number is the handle.** People arrive with a number: the one on the paper stub. Every list, record, form and document shows it first, zero-padded, in Plex Sans Condensed 700, and every task can start by typing it. A screen never makes someone find a bond by scrolling a dropdown.
2. **The first screenful answers the question.** A record opens with one sentence that says what state the thing is in and one button for what usually comes next. History, audit and corrections come after, collapsed.
3. **The common path is the cheap one.** What happens fifty times a day (a payment) costs a number and two confirmations. What happens once a month (a correction, an annulment) sits one step away, asks for a reason, and names its consequence.
4. **Money is added up in sight.** Wherever amounts combine, they are shown as a sheet: lines, a rule, a total, the same way from the open settlement to the printed delivery note. One format per context: whole pesos on screens, cents on documents and ledgers.
5. **Thumb first for work done standing up.** Collecting, delivering and recording payments are designed at 375 px, one-handed: 48 px primary actions at the bottom of the screen, numeric keyboards, no horizontal scrolling. Reports and configuration are designed for the desk and only have to remain usable on a phone.
6. **The station's words.** «Rendición», «remito», «padrón», «cuota». No words from how the system was built («fase 6», `sale.create`), no product name in English, no identifiers.

## Information architecture and navigation

### Today

Inside a campaign there is no persistent navigation. The thirteen sections are links on the campaign page; every other screen has only breadcrumbs. On a phone those links render at the bottom of a page that is five screens long (A2). After signing in, the home page shows the session and the role names, and the campaign is two more clicks away (A11).

### Proposed

```txt
/                      goes straight to the active campaign (or the list if there are several)
/campaigns             campaign list (also reachable from the top bar)
/campaigns/[id]        Inicio: bond search, the day's actions, what needs attention, state
  Operación            Bonos, Entregas, Ventas, Rendiciones
  Personas             Cobradores, Compradores
  Sorteos y reportes   Sorteos, Reportes
  Administración       Datos y reglas, Comisiones, Auditoría, Copias de seguridad
/portal/[campaignId]   Por cobrar, Bonos, Ventas, Compradores, Mi cuenta
```

No route changes. What changes is the shell around them:

- **Top bar.** The institution mark and name, the campaign as context (a link to the campaign list), a bond search that is always there, and the session. On a phone the name and the campaign stack next to the red mark and the search collapses into an icon.
- **Desktop (1024 px and up): a left rail** with the four groups above. The current section is marked with the yellow bar plus weight 600. «Rendiciones» shows how many are open. Administración is last and, for roles without those permissions, absent.
- **Phone and tablet: a bottom tab bar** with Inicio, Bonos, Ventas, Rendiciones and Más. «Más» opens the rest of the sections as a list. Five destinations, 75 px wide each at 375 px, 56 px tall, reachable with the thumb.
- **Focused tasks replace the tab bar.** While registering a sale, loading a settlement or building a delivery, the bottom of the screen belongs to the task: a bar with the running total and the action that finishes it («Revisar y cerrar»). A back link at the top returns to the section.
- **Breadcrumbs become one back link** to the parent section («Rendiciones», «Bonos»). The rail and the tab bar already say where you are; a four-level breadcrumb that wraps to two lines on a phone does not help.
- **The portal** uses the same shell with its own five tabs. «Por cobrar» goes first because it is the collector's working list.

Which sections each role sees does not change: the rail and the tabs are built from the same permissions as today's links.

## Patterns by kind of screen

### Lists (bonds, sales, settlements, deliveries, buyers, collectors, draws)

- **Search first, filters second.** One search field at the top (a bond number, or a name on the people lists). The other filters fold into «Filtrar», which shows how many are active; applied filters appear as removable chips. Today the filter card fills the first screen on a phone before any row is visible (A7).
- **Rows, not wide tables, below 720 px.** Each row is two lines: bond number (or name) and the main fact on the first; state and amount on the second. The whole row is the link. At desktop width the same data is a table with at most six columns, amounts right-aligned.
- **Each list says who has the thing.** The bond list shows the collector and the buyer; the settlement payment list shows the bond and the buyer (A3, A4).
- **Work in progress on top.** Open settlements before closed ones; drafts before the rest.
- **25 rows per page**, with «Anterior» and «Siguiente» at 44 px. Inside a record, a list longer than 10 rows shows the first 10 and a link to the full, filtered list instead of growing the page (A12).
- **Empty state:** what this list is and the one action that starts it. No illustration.

### Records (bond, sale, buyer, collector, draw)

- **Header:** the identifier in figure type (the bond as its stub), then **one sentence** with the state, written from data: «Vendido a Stella Rodríguez en 6 cuotas. Lo cobra Héctor Acosta. Pagó 1 cuota y debe $ 50.000, de los cuales $ 40.000 están vencidos.»
- **Next step:** one primary button chosen by state. Available bond: «Entregar». Delivered: «Registrar venta». Sold with debt: «Registrar pago». Paid: none.
- **Body:** at most three open sections with what people come to check (installments, draws, who has it).
- **History and corrections:** collapsed at the end. «Corregir o anular» lists the rare actions; each opens a dialog (see Risky operations).
- No numbered sections and no index of anchors: a record that needs an index is too long.

### Task flows (register a sale, load a settlement, deliver bonds, load winners)

- **One column, in the order the person thinks.** Each answered step collapses to a line that can be reopened («Bono 0035, lo tiene Jorge Medina»), so the current step is always in view.
- **Type, do not pick.** Bonds by number; people by typing part of the name, with matches listed under the field. A `<select>` is only for short, closed lists (collectors, draw type).
- **Two options are two buttons.** Efectivo or Transferencia, Pago total or En cuotas: a segmented control, both visible, no dropdown.
- **Nothing typed is lost.** A search inside a flow never reloads the page or clears a previous step (A6).
- **The button says what will happen, with the amount:** «Agregar pago de $ 10.000», «Enviar cobro de $ 10.000», «Entregar 5 bonos a Raúl Sosa».
- **Defaults do the typing:** next unpaid installment checked, full amount, today, cash.
- **After saving,** focus returns to the first field for the next one, and the new row appears at the top of the list.

### Money sheets (open and closed settlement, collector account, sale plan)

The idiom of the closed settlement (#147), everywhere amounts add up: label on the left, amount on the right in tabular figures, a rule above each subtotal, a double rule above the lead figure in Plex Sans Condensed. Under the sheet, the sentence people act on: «Jorge Medina tiene que entregar $ 63.000 en efectivo.» The open settlement shows the same sheet while it is being loaded, so closing it holds no surprise.

### Printable documents (delivery notes, settlement note, payment and prize certificates)

- Same sheet idiom and the same figure type for numbers, on white, with the institution mark as the only colour.
- Bond numbers in a grid that can be checked off with a pen; totals at the bottom right; two signature lines with the names printed under them.
- Dates as `dd/mm/aaaa`, times in 24 h Buenos Aires time, amounts with cents.
- The screen that precedes a document has one primary button, «Imprimir», and the document opens ready for A4 and for an 80 mm receipt printer where it applies (to be confirmed with the station).

### Empty, loading and error states

- **Empty:** one sentence and one action. «Todavía no hay rendiciones. Abrir la primera cuando un cobrador traiga dinero.»
- **Loading:** the button that was pressed shows the spinner and keeps its width; lists keep their previous rows until the new ones arrive. No full-page spinners.
- **Field error:** next to the field, what happened and what to do. **Form error:** summary on top linking to each field (already in Cimiento).
- **Not found and no permission:** say which thing was not found and offer the way back to its list. A 403 names the permission in words («Esta sección es de tesorería»), not as a code.
- **Offline (PWA):** a bar under the top bar, «Sin conexión. Lo que se envíe ahora no se guarda.», and submit buttons disabled with that reason.

### Risky operations

Three levels, by how hard the action is to undo:

| Level                   | Examples                                                         | Treatment                                                                                                                                                                          |
| ----------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Normal end of a task    | Close a settlement, deliver bonds, confirm a sale                | Primary button. A dialog restates the numbers that matter (cash to hand over, bond count, collector) and its button repeats the verb.                                              |
| Definitive, expected    | Freeze a roster, award a prize, send a collector payment         | Primary button after an explicit confirmation naming the consequence («No se vuelve a calcular nunca»).                                                                            |
| Correction or annulment | Annul a payment, correct a closed settlement, mark uncollectible | Not on the main surface. Under «Corregir o anular», each opens a dialog that names the object, states the consequence and requires a reason. Danger button only inside the dialog. |

Today «Cerrar rendición» is a red danger button beside the title, and every payment row carries a permanent «Motivo obligatorio» field with «Quitar» (A4, A8). Red should mean «this destroys something», so it is reserved for the third level.

### Status, numbers, money and dates

- Status is always a word with a mark whose **shape** differs, not only its colour: round for normal, diamond for attention, square for a problem.
- A bond number is never inside running text in mono or body type; it uses the `BondNumber` treatment and is always zero-padded to the campaign's digits. The associated number follows it, smaller: `0181 / 5181`.
- Money: `formatMoney` everywhere. Whole pesos on screens (`$ 150.500`), cents on documents and ledgers (`$ 150.500,00`), never both in one block (A10). The `$` and the amount never break across lines.
- Dates `dd/mm/aaaa`; relative words («hoy», «ayer») only in lists of the last week.

## Prototypes

The prototypes were static HTML in `docs/ux/prototypes/`, built with the Cimiento tokens and the repo's fonts; they responded from 375 px to 1280 px and followed the system colour scheme. Data is the demo campaign from `pnpm seed:demo`. Their screenshots were in `docs/ux/prototypes/shots/`.

### 1. Campaign home (`01-campaign-workbench.html`)

Screenshots, no longer in the tree: «375 px» (`docs/ux/prototypes/shots/01-campaign-workbench-375-light.jpg`), «1280 px» (`docs/ux/prototypes/shots/01-campaign-workbench-1280-light.jpg`).

What changes from today:

- The shell: rail on desktop, tab bar on a phone. The section links stop being page content.
- «Registrar pago» joins the day's actions. Today a payment starts from «Abrir rendición», a name that hides the most frequent task.
- «Para resolver» gathers what is waiting for someone (collector payments not processed, bonds left out of the next draw, open settlements), each with its consequence and the link that resolves it. Today these are three separate cards among the dashboard panels.
- One line of figures and two ruled lists replace seven cards. The page goes from 5.2 screens to about 2 on a phone.
- Data: everything shown is already in the page's `load`, except the count of overdue installments and bonds under «Cuotas vencidas sin cobrar» (the amount is there; the counts would be dropped if they need a new query).

### 2. Bond record (`02-bond-record.html`)

Screenshots, no longer in the tree: «375 px» (`docs/ux/prototypes/shots/02-bond-record-375-light.jpg`), «1280 px» (`docs/ux/prototypes/shots/02-bond-record-1280-light.jpg`).

What changes from today:

- The record is the bond's stub, then a sentence that names the buyer and the collector. Today sections 4 and 6 say «Hay un cobrador registrado para este bono; sus datos se muestran cuando existan las fichas de cobradores» and never show a name (A3).
- One next step by state. «Registrar pago» goes to the collector's open settlement with this bond already typed (or to «Abrir rendición» for that collector when there is none).
- Installments read as a list with the overdue ones marked and the amount still owed as the lead figure.
- Fourteen numbered sections become three open sections and three collapsed ones. 5.5 screens become about 2.
- Data: the names of the current collector and buyer, and the buyer's phone. The page already reads the active sale and the collectors with the caller's permissions, so this is a change in the route's `load`, with no SQL. If a role cannot read buyers, the sentence falls back to «Vendido» without the name.

### 3. Open settlement (`03-open-settlement.html`)

Screenshots, no longer in the tree: «375 px» (`docs/ux/prototypes/shots/03-open-settlement-375-light.jpg`), «1280 px» (`docs/ux/prototypes/shots/03-open-settlement-1280-light.jpg`).

What changes from today:

- **A payment is a bond number and two confirmations.** Type the number, Enter; the buyer, the debt and the next installment appear, already checked; Enter again adds it and the cursor is back on the number. Today it is a dropdown with every sale of the collector that still owes something (14 in the measured run, a few hundred in a real campaign), a checkbox, a second dropdown for the method, and a button (A1).
- **Each payment row says whose it is:** bond, buyer, installment, method. Today the table has date, amount, method and state, and nothing that identifies the payment (A4).
- **The sheet is live** and ends in the sentence that matters at the desk: how much cash the collector has to hand over. On a phone that figure stays in the bar at the bottom with «Revisar y cerrar».
- Removing or correcting a payment moves behind «…» on its row and opens a dialog that asks for the reason. Today each row shows a reason field, «Quitar» and a «Corregir / anular» disclosure all the time (A8).
- Collector payments from the portal keep their two actions, with the reject reason asked in a dialog.
- It depends on the people being readable: today a treasurer sees «Unknown collector» and «Unknown buyer» (A9). Until #50 decides on that permission, rows fall back to the bond number alone, which every role that opens a settlement can read.
- «Cerrar rendición» is a primary button, disabled with the reason written under it while something blocks it.
- Data: all of it is in today's `load` (`candidates` already has bond, buyer and installments per sale), except the bond and buyer of each payment row, which the route can join from the same candidates. Matching the typed number happens in the browser over that list. The form posts to the same `?/add` action with the same fields.
- The prototype's script only simulates the loop (press «Agregar pago» and watch the sheet move).

Dark, with the proposed palette (see P3):

Screenshots, no longer in the tree: «375 px» (`docs/ux/prototypes/shots/03-open-settlement-375-dark.jpg`), «1280 px» (`docs/ux/prototypes/shots/03-open-settlement-1280-dark.jpg`).

### 4. Collector portal, «Por cobrar» (`04-portal-to-collect.html`)

Screenshots, no longer in the tree: «The list» (`docs/ux/prototypes/shots/04-portal-to-collect-375-light.jpg`), «Collecting» (`docs/ux/prototypes/shots/04-portal-to-collect-sheet-375-light.jpg`).

What changes from today:

- The working list is a list, not a seven-column table that scrolls sideways (A5). Overdue first, then what falls due this week, each group with its total.
- Each item has the two things a collector does on the sidewalk: «Llamar» (a `tel:` link) and «Cobrar».
- «Cobrar» opens a sheet with the amount, cash selected and today's date already filled in; the button repeats the amount. Sending is one tap after checking. Today the form is inside a table cell on the sale page, cut off at 375 px, six taps from the start (A5).
- A payment that was sent stays in the list as «Enviado» until treasury includes it, so the collector does not ask for it twice.
- The reason an installment matters is shown when the data has it («Sin esta cuota no entra al Sorteo de noviembre»).
- Routes and server contracts stay as in #142: the sheet posts to the existing `?/registrar` action of `/portal/[campaignId]/ventas/[saleId]`, with the same fields. If posting to another route's action from the list turns out to need a server change, «Cobrar» links to that sale with the form open on that installment instead (one more screen, same contracts).
- B1 (#197) now shows the buyer's address below the name in «Por cobrar», when present. The draw note is left out until approved.

## Proposals that change what was approved

**Decision (2026-11-26, #50): P1 to P5 accepted by Santi, after reviewing them with Juan.** They are part of [`plan.md`](plan.md).

| #   | Proposal                                                                                                                                                                                        | Why                                                                                                                                                               | If rejected                                                         |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| P1  | The header shows the institution («Bomberos Voluntarios», from `PUBLIC_INSTITUTION_NAME`) instead of «Firefighters». Page titles follow.                                                        | The interface is in Spanish and belongs to the station; «Firefighters» is the repo's name (A10).                                                                  | Keep «Firefighters» next to the red mark.                           |
| P2  | Navigation moves from links on the campaign page to a left rail (desktop) and a bottom tab bar (phone). The yellow marker stays; on the rail it is a bar on the left, on the tabs a bar on top. | A2: sections are unreachable on a phone without scrolling five screens, and absent from every inner page.                                                         | Keep the top bar only and repeat the grouped links in a «Más» menu. |
| P3  | A dark palette aligned with navy (`bg #0f141b`, `surface #171d26`, `primary #b9cbe6` on `#10203a`), replacing the light blue `#86a6ff`. Already listed as a follow-up in #145.                  | Dark mode today looks like a different product (A14). Contrast checked: text 15.9:1, muted 8.5:1, primary on the background 11.2:1, button text on primary 9.9:1. | Dark stays as it is.                                                |
| P4  | «Cerrar rendición» becomes a primary button (with its confirmation dialog) instead of a danger button.                                                                                          | Closing is the normal end of the task. Red is reserved for corrections and annulments.                                                                            | Keep danger; still move it to the end of the sheet.                 |
| P5  | `/portal` and `/portal/[campaignId]` land on «Por cobrar» instead of «Mis bonos», and «Por cobrar» is the first tab.                                                                            | It is the collector's working list. This touches the redirect in the portal's `load`, which #142 fixed, so it needs approval (see Limits).                        | Keep the redirect; only reorder the tabs.                           |

## Proposals that need backend or business changes

Outside this redesign's limits (no SQL, migrations, permissions or service contracts). None blocks the plan.

**Decision (2026-11-26, #50): B3 accepted, tracked in #162.** B1 is done in #197 (`20270131000000_portal_due_buyer_address.sql`, pgTAP 078): the buyer's address is shown in «Por cobrar» within the existing active-own-sale scope. B2, B4 and B5 are still open. The business questions raised by the audit were also answered: see [`audit.md`](audit.md#proposals-that-need-business-changes).

| #   | Proposal                                                                                                             | What it needs                                                                | Value                                                                   |
| --- | -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| B1  | Buyer address in the portal's «Por cobrar».                                                                          | A column in `portal_my_campaign_due_installments`.                           | The collector plans the route without opening each buyer.               |
| B2  | Search by buyer name or phone from the top bar, not only by bond number.                                             | A search function over bonds, buyers and collectors with the caller's scope. | Claims arrive as «soy Stella Rodríguez», not as a number.               |
| B3  | A payment date on the staff payment form (today it is always the day it is loaded; the portal form already has one). | The action already accepts `p_payment_date`; confirm the rule with treasury. | Payments loaded the day after they were collected keep their real date. |
| B4  | «Registrar pago» from a bond when the collector has no open settlement: open one and add the payment in one step.    | A product decision (who may open settlements implicitly).                    | One less screen for the most frequent task.                             |
| B5  | Remember the last collector and payment method per device.                                                           | Nothing on the server; listed because it stores data in the browser.         | Fewer taps on repeated loads.                                           |

## How this will be measured

The audit counted screens, taps, fields and choices for each critical flow on a phone (`scripts/ux-flows.ts`, results in `docs/ux/before/flows/flows.json`). The same script runs again after each phase. Targets:

| Flow                                            | Today (375 px)                                                                | Target                                                             |
| ----------------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Find a bond and see who has it and what it owes | 3 screens, 3 actions, only from the campaign page; the names are not shown    | 2 screens from any screen; names and debt in the first screenful   |
| Record one more payment in an open settlement   | 3 actions per payment through two dropdowns; the row does not say whose it is | Number, Enter, Enter; the row names the bond and the buyer         |
| Open a settlement, two payments, close, print   | 8 screens, 12 actions                                                         | 6 screens, 9 actions; cash to hand over visible throughout         |
| Register a sale to an existing buyer            | 5 screens, 7 actions; the bond is lost when searching for the buyer           | 4 screens, 6 actions; nothing lost; the buyer is found by typing   |
| Deliver a range of bonds and print the note     | 5 screens, 7 actions                                                          | Same steps; the button names the count and the collector           |
| Draw: roster, freeze, winner, award             | 10 screens, 19 actions                                                        | Same steps (they are deliberate); the next step is always a button |
| Collector sends a payment from the portal       | 7 screens, 6 taps                                                             | 3 screens, 3 taps: the list, Cobrar, Enviar                        |

Quality bar for every PR (from the brief), checked on the real screen before asking for review:

- A treasurer in a hurry understands the screen in 5 seconds.
- A collector can use it one-handed on the sidewalk.
- An amount or a bond number cannot be mixed up.
- It looks made for this fire station.

Plus the non-negotiables already enforced by the E2E sweep: axe with no violations in light and dark, 44 px targets at 375 px, visible focus, keyboard operation, no horizontal page scroll.
