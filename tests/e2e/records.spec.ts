import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { resolveSeedConfig } from '../../scripts/seed-admin';
import {
	apiActiveCampaign,
	apiBond,
	apiCollector,
	apiOpenSettlement,
	rpc,
	serviceClient
} from './api';
import { baDay, login, open, runId } from './helpers';

/**
 * UX plan, PR 15 (audit A12). The collector record, the collector's current account and the buyer
 * record: each opens with what it is and what is owed in sentences, then the one next step, then
 * short lists; the rare actions are collapsed. The data is built through the audited SQL functions
 * (`api.ts`); the flows checked here are the ones these screens own: bulk return and reassignment,
 * a manual adjustment and its annulment, and editing the collector and the buyer.
 */
const baseURL = `http://127.0.0.1:${process.env.E2E_PORT ?? 4317}`;
const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const FIRST = 701;
const BONDS = 12;

let campaignId: string;
let collectorId: string;
let collector: string;
let other: string;
let buyerId: string;
let buyer: string;

const record = () => `/campaigns/${campaignId}/collectors/${collectorId}`;
const ledger = () => `${record()}/ledger`;
const buyerRecord = () => `/campaigns/${campaignId}/buyers/${buyerId}`;
const sentence = (page: Page) => page.locator('[data-collector-sentence]');
const balance = (page: Page) => page.locator('[data-testid="ledger-balance"] [data-kind="lead"]');
/** The collapsed block with the bulk return and reassignment, opened. */
async function custody(page: Page) {
	await page.locator('summary', { hasText: 'Devolver o reasignar bonos' }).click();
	return page.locator('[data-custody-form]');
}

async function sell(bondId: string) {
	return rpc('sale_register', {
		p_campaign_id: campaignId,
		p_bond_id: bondId,
		p_buyer_id: buyerId,
		p_payment_mode: 'full_payment',
		p_first_due_date: null,
		p_sale_date: baDay(0)
	});
}
/** Records the cash payment of the sale's only installment in a settlement and closes it. */
async function settle(saleId: string) {
	const settlementId = await apiOpenSettlement(campaignId, collectorId);
	const service = serviceClient();
	const plan = await service.from('payment_plans').select('id').eq('sale_id', saleId).single();
	if (plan.error) throw new Error(plan.error.message);
	const installment = await service
		.from('installments')
		.select('id, amount')
		.eq('payment_plan_id', plan.data.id)
		.single();
	if (installment.error) throw new Error(installment.error.message);
	const amount = Number(installment.data.amount).toFixed(2);
	await rpc('settlement_add_payment', {
		p_settlement_id: settlementId,
		p_sale_id: saleId,
		p_amount: amount,
		p_payment_method: 'cash',
		p_applications: [{ installment_id: installment.data.id, amount_applied: amount }],
		p_payment_date: baDay(0)
	});
	await rpc('settlement_close', { p_settlement_id: settlementId });
}

test.describe.serial('collector record, current account and buyer record', () => {
	test.beforeAll(async () => {
		test.setTimeout(240_000);
		const run = runId();
		// Names that do not contain each other.
		collector = `Cobrador ${run}`;
		other = `Reemplazo ${run}`;
		buyer = `Compradora ${run}`;
		campaignId = await apiActiveCampaign(`E2E fichas ${run}`);
		collectorId = await apiCollector(collector);
		await apiCollector(other);
		const bonds: string[] = [];
		for (let i = 0; i < BONDS; i += 1) bonds.push(await apiBond(campaignId, FIRST + i));
		await rpc('bond_deliver', {
			p_campaign_id: campaignId,
			p_collector_id: collectorId,
			p_bond_ids: bonds,
			p_notes: null
		});
		buyerId = await rpc('buyer_create', {
			p_type: 'individual',
			p_first_name: 'Ana',
			p_last_name: buyer,
			p_document_number: null,
			p_tax_id: null,
			p_business_name: null,
			p_phone: '2364 55-0100',
			p_address: null,
			p_usual_collector_id: collectorId
		});
		// 0701 is sold and owed; 0702 is sold and paid in a closed settlement.
		await sell(bonds[0]);
		await settle(await sell(bonds[1]));
		await rpc('collector_ledger_adjust', {
			p_campaign_id: campaignId,
			p_collector_id: collectorId,
			p_amount: '500.00',
			p_direction: 'collector_credit',
			p_reason: 'Premio por puntualidad'
		});
	});

	test('the collector record says the bonds, what is left to collect and the balance', async ({
		page
	}) => {
		await open(page, record());
		await expect(page.getByRole('heading', { level: 1 })).toHaveText(collector);
		await expect(page.locator('[data-collector-lead]')).toContainText('Falta cobrar');
		await expect(page.locator('[data-collector-lead]')).toContainText('$ 1.000');
		await expect(sentence(page)).toContainText(
			`${collector} tiene 12 bonos: 2 vendidos y 10 sin vender. Le falta cobrar $ 1.000.`
		);
		await expect(sentence(page)).toContainText('Tiene $ 500 a su favor en la cuenta corriente.');
		// The short lists: what is owed, the unsold bonds by number, the settlements.
		await expect(page.locator('[data-debt-row]')).toHaveCount(1);
		await expect(page.locator('[data-debt-row]')).toContainText(`Ana ${buyer}`);
		await expect(page.locator('[data-debt-row]')).toContainText('Cuota 1, vence el');
		await expect(page.locator('[data-unsold-bond]')).toHaveCount(10);
		await expect(page.locator('[data-unsold-notes]')).toContainText(
			/Entregados con el remito \d{4}\./
		);
		await expect(page.locator('[data-settlement-row]')).toHaveCount(1);
		// The sold bonds, the form and the bulk actions are collapsed.
		await expect(page.locator('[data-bond-row]').first()).toBeHidden();
		await expect(page.locator('#displayName')).toBeHidden();
		await expect(page.locator('[data-custody-form]')).toBeHidden();
		await page.locator('summary', { hasText: 'Bonos vendidos' }).click();
		await expect(page.locator('[data-bond-row]')).toHaveCount(2);
		await expect(page.getByText(/Unknown|Sin acceso/)).toHaveCount(0);
	});

	test('«Registrar pago» leads to the settlement form with the collector chosen', async ({
		page
	}) => {
		await open(page, record());
		await page.getByRole('link', { name: 'Registrar pago' }).click();
		await expect(page).toHaveURL(/\/settlements\/new\?intent=payment&collector=[0-9a-f-]{36}$/);
		await expect(page.locator('#collectorId')).toHaveValue(collectorId);
	});

	test('the links of the record lead to the filtered lists and to the account', async ({
		page
	}) => {
		await open(page, record());
		await expect(page.getByRole('link', { name: 'Ver sus ventas' })).toHaveAttribute(
			'href',
			`/campaigns/${campaignId}/sales?collector=${collectorId}`
		);
		await page.getByRole('link', { name: 'Ver sus ventas' }).click();
		await expect(page.locator('main')).toContainText(`Ana ${buyer}`);
		await open(page, record());
		await page.getByRole('link', { name: 'Ver cuenta corriente' }).click();
		await expect(page).toHaveURL(new RegExp(`${collectorId}/ledger$`));
		await expect(page.getByRole('heading', { level: 1 })).toHaveText(
			`Cuenta corriente de ${collector}`
		);
	});

	test('a role that reads no payments, settlements or account gets no figure it cannot read', async ({
		browser
	}) => {
		const readOnly = resolveSeedConfig().fixtures.find((user) =>
			user.roleNames.includes('read-only')
		)!;
		const context = await browser.newContext({ baseURL, locale: 'es-AR' });
		const page = await context.newPage();
		await login(page, readOnly);
		await open(page, record());
		await expect(sentence(page)).toHaveText(
			/tiene 12 bonos: 2 vendidos y 10 sin vender\. Le falta cobrar \$\s1\.000\.$/
		);
		await expect(page.getByText('cuenta corriente')).toHaveCount(0);
		await expect(page.getByText('Sin permiso para ver los pagos')).toBeVisible();
		await expect(page.getByRole('heading', { name: /Rendiciones/ })).toHaveCount(0);
		await expect(page.getByRole('link', { name: 'Registrar pago' })).toHaveCount(0);
		await expect(page.getByText('Devolver o reasignar bonos')).toHaveCount(0);
		await expect(page.getByText('Editar los datos del cobrador')).toHaveCount(0);

		await open(page, buyerRecord());
		await expect(page.locator('[data-buyer-sentence]')).toContainText('Debe $ 1.000.');
		await expect(page.getByText('Sin permiso para ver los pagos')).toBeVisible();
		await expect(page.getByRole('link', { name: 'Registrar pago' })).toHaveCount(0);
		await expect(page.getByText('Editar los datos del comprador')).toHaveCount(0);
		await expect(page.getByText(/Unknown|Sin acceso/)).toHaveCount(0);
		await context.close();
	});

	test('the buyer record says the bonds and the debt, and how to call', async ({ page }) => {
		await open(page, buyerRecord());
		await expect(page.getByRole('heading', { level: 1 })).toHaveText(`${buyer}, Ana`);
		await expect(page.locator('[data-buyer-lead]')).toContainText('Falta cobrar');
		await expect(page.locator('[data-buyer-sentence]')).toHaveText(
			new RegExp(
				`^Ana ${buyer} compró 2 bonos en esta campaña\\. Debe \\$\\s1\\.000\\. Los cobra ${collector}\\.$`
			)
		);
		await expect(page.getByRole('link', { name: 'Llamar al 2364 55-0100' })).toHaveAttribute(
			'href',
			'tel:2364550100'
		);
		const rows = page.locator('[data-sale-row]');
		await expect(rows).toHaveCount(2);
		await expect(rows.filter({ hasText: '0701' })).toContainText(
			/Lo compró el \d{2}\/\d{2}\/\d{4} en un pago, por \$\s1\.000\. Debe \$\s1\.000, que vence el/
		);
		await expect(rows.filter({ hasText: '0702' })).toContainText('Está pagado.');
		await expect(page.locator('[data-pending-installment]')).toHaveCount(1);
		// The row of a bond is the link to its sale; the collector is a link in the sentence.
		await expect(
			page.locator('[data-buyer-sentence]').getByRole('link', { name: collector })
		).toHaveAttribute('href', record());
		await rows.filter({ hasText: '0701' }).getByRole('link').click();
		await expect(page).toHaveURL(/\/sales\/[0-9a-f-]{36}$/);
		await expect(page.locator('[data-sale-sentence]')).toContainText('Debe $ 1.000, que vence el');
	});

	test('the buyer’s data is edited from its collapsed form', async ({ page }) => {
		await open(page, buyerRecord());
		await expect(page.locator('#phone')).toBeHidden();
		await page.locator('summary', { hasText: 'Editar los datos del comprador' }).click();
		await page.locator('#phone').fill('2364 44-1234');
		await page.getByRole('button', { name: 'Guardar cambios' }).click();
		await expect(page.getByText('Comprador actualizado.')).toBeVisible();
		await expect(page.getByRole('link', { name: 'Llamar al 2364 44-1234' })).toBeVisible();
	});

	test('the collector’s data is edited from its collapsed form', async ({ page }) => {
		await open(page, record());
		await page.locator('summary', { hasText: 'Editar los datos del cobrador' }).click();
		await page.locator('#phone').fill('2364 51-2203');
		await page.getByRole('button', { name: 'Guardar cambios' }).click();
		await expect(page.getByText('Cobrador actualizado.')).toBeVisible();
		await expect(page.getByRole('link', { name: 'Llamar al 2364 51-2203' })).toHaveAttribute(
			'href',
			'tel:2364512203'
		);
	});

	test('a bulk operation the server rejects says why inside its block and keeps the choice', async ({
		page
	}) => {
		await open(page, record());
		const form = await custody(page);
		await expect(form.locator('input[name="bondIds"]')).toHaveCount(10);
		// Nothing chosen: no dialog, the server says what is missing.
		await form.getByRole('button', { name: 'Devolver seleccionados' }).click();
		await expect(form.getByRole('alert')).toContainText('Seleccionar al menos un bono.');
		await expect(page.getByRole('dialog')).toBeHidden();
		// A bond chosen but nobody to give it to.
		await form.getByLabel('0703', { exact: true }).check();
		await form.getByRole('button', { name: 'Reasignar 1 bono' }).click();
		await expect(form.getByRole('alert')).toContainText('Elegir el cobrador que recibe los bonos.');
		await expect(form.getByLabel('0703', { exact: true })).toBeChecked();
		await expect(page).toHaveURL(new RegExp(`${collectorId}$`));
	});

	test('returning bonds asks first, naming how many, and emits the return note', async ({
		page
	}) => {
		await open(page, record());
		const form = await custody(page);
		await form.getByLabel('0703', { exact: true }).check();
		await form.getByLabel('0704', { exact: true }).check();
		const trigger = form.getByRole('button', { name: 'Devolver 2 bonos' });
		await trigger.click();
		const dialog = page.getByRole('dialog');
		await expect(dialog).toContainText(`¿Devolver 2 bonos de ${collector}?`);
		await expect(dialog).toContainText('Bonos 0703, 0704.');
		await expect(dialog).toContainText('Se emite un remito de devolución.');
		// Esc closes it without posting, and the focus returns to the button.
		await page.keyboard.press('Escape');
		await expect(dialog).toBeHidden();
		await expect(trigger).toBeFocused();
		await expect(page).toHaveURL(new RegExp(`${collectorId}$`));

		await trigger.click();
		await dialog.getByRole('button', { name: 'Devolver 2 bonos' }).click();
		await expect(page).toHaveURL(/\/deliveries\/[0-9a-f-]{36}$/);
		await expect(page.getByRole('heading', { name: /Remito \d{4}/ })).toBeVisible();
		await open(page, record());
		await expect(sentence(page)).toContainText('tiene 10 bonos: 2 vendidos y 8 sin vender.');
	});

	test('reassigning a bond asks first, naming the bond and who gets it', async ({ page }) => {
		await open(page, record());
		const form = await custody(page);
		await form.getByLabel('0705', { exact: true }).check();
		await form.locator('#targetCollectorId').selectOption({ label: other });
		await form.getByRole('button', { name: 'Reasignar 1 bono' }).click();
		const dialog = page.getByRole('dialog');
		await expect(dialog).toContainText(`¿Reasignar el bono 0705 de ${collector} a ${other}?`);
		await expect(dialog).toContainText(`Pasa a manos de ${other}.`);
		await dialog.getByRole('button', { name: 'Reasignar 1 bono' }).click();
		await expect(page).toHaveURL(/\/deliveries\/[0-9a-f-]{36}$/);
		await open(page, record());
		await expect(sentence(page)).toContainText('tiene 9 bonos: 2 vendidos y 7 sin vender.');
		await expect(page.locator('[data-unsold-bond]')).toHaveCount(7);
	});

	test('the current account leads with the balance in words, over its movements', async ({
		page
	}) => {
		await open(page, ledger());
		await expect(balance(page)).toContainText('Saldo a favor del cobrador');
		await expect(balance(page)).toContainText('$ 500,00');
		const sheet = page.locator('[data-testid="ledger-balance"]');
		await expect(sheet.locator('[data-kind="line"]')).toContainText([
			'Ajustes a favor del cobrador'
		]);
		// The sheet is above the movements; the manual adjustments are collapsed.
		const table = page.getByRole('table');
		await expect(table).toContainText('Ajuste a favor del cobrador');
		await expect(table).toContainText('Motivo: Premio por puntualidad');
		await expect(page.locator('#ledger-amount')).toBeHidden();
		await expect(page.locator('#commission-amount')).toBeHidden();
	});

	test('a manual adjustment against the collector turns the balance in favour of Bomberos', async ({
		page
	}) => {
		await open(page, ledger());
		await page.locator('summary', { hasText: 'Ajustar la cuenta corriente' }).click();
		await page.locator('#ledger-direction').selectOption('collector_debit');
		await page.locator('#ledger-amount').fill('800');
		await page.locator('#ledger-reason').fill('Faltante de caja');
		await page
			.locator('form[action="?/adjustLedger"]')
			.getByRole('button', { name: 'Registrar ajuste' })
			.click();
		await expect(page.getByText('Cuenta corriente ajustada.')).toBeVisible();
		await expect(balance(page)).toContainText('Saldo a favor de Bomberos');
		await expect(balance(page)).toContainText('$ 300,00');
		// Whom it favours is said in words: the balance carries no minus sign.
		await expect(balance(page)).not.toContainText(/[-−]/);
		const sheet = page.locator('[data-testid="ledger-balance"]');
		await expect(sheet.locator('[data-kind="deduction"]')).toContainText(
			'Ajustes a favor de Bomberos'
		);
		// The collector record says the same.
		await open(page, record());
		await expect(sentence(page)).toContainText(
			'Su cuenta corriente tiene $ 300 a favor de Bomberos.'
		);
	});

	test('annulling an adjustment names it, asks for the reason and restores the balance', async ({
		page
	}) => {
		await open(page, ledger());
		// The newest movement is first: the debit just recorded.
		await page.locator('[data-annul]').first().click();
		const dialog = page.getByRole('dialog');
		await expect(dialog).toContainText('¿Anular el movimiento «Ajuste a favor de Bomberos» del');
		await expect(dialog).toContainText('Es de $ 800,00.');
		const confirm = dialog.getByRole('button', { name: 'Anular movimiento' });
		await expect(confirm).toBeDisabled();
		await dialog.getByLabel('Motivo de la anulación').fill('Se cargó dos veces');
		await confirm.click();
		await expect(page.getByText('Movimiento anulado.')).toBeVisible();
		await expect(dialog).toBeHidden();
		await expect(balance(page)).toContainText('Saldo a favor del cobrador');
		await expect(balance(page)).toContainText('$ 500,00');
		await expect(page.getByRole('table')).toContainText(
			'Motivo de la anulación: Se cargó dos veces'
		);
	});

	for (const colorScheme of ['light', 'dark'] as const) {
		test(`375 px [${colorScheme}]: the three screens are clean, with the balance on the first screen`, async ({
			browser,
			page: signedIn
		}) => {
			test.setTimeout(180_000);
			const context = await browser.newContext({
				baseURL,
				locale: 'es-AR',
				viewport: { width: 375, height: 812 },
				hasTouch: true,
				isMobile: true,
				colorScheme,
				storageState: await signedIn.context().storageState()
			});
			const page = await context.newPage();
			const overflow = () =>
				page.evaluate(() => document.scrollingElement!.scrollWidth - window.innerWidth);
			/** Controls under 44 px; links inside running text are exempt (WCAG 2.5.8). */
			const small = () =>
				page.evaluate(() =>
					[
						...document.querySelectorAll<HTMLElement>(
							'main a[href], main button, main summary, main select, main input:not([type=hidden])'
						)
					]
						.filter((node) => {
							if (!node.getBoundingClientRect().width) return false;
							if (node.tagName === 'A' && getComputedStyle(node).display === 'inline') return false;
							const input = node as HTMLInputElement;
							const label = input.type === 'checkbox' ? node.closest('label') : null;
							return (label ?? node).getBoundingClientRect().height < 44;
						})
						.map((node) => `${node.tagName} ${node.textContent?.trim().slice(0, 30)}`)
				);
			const clean = async (label: string) => {
				expect(await overflow(), `${label}: sideways scroll`).toBeLessThanOrEqual(1);
				expect(await small(), `${label}: targets under 44 px`).toEqual([]);
				const result = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
				expect(result.violations, `${label}: axe`).toEqual([]);
			};
			const onFirstScreen = async (locator: ReturnType<Page['locator']>) => {
				const box = await locator.boundingBox();
				expect(box!.y + box!.height).toBeLessThanOrEqual(812);
			};

			// The collector record, closed and with every group opened.
			await open(page, record());
			await onFirstScreen(sentence(page));
			await expect(sentence(page)).toContainText('a su favor en la cuenta corriente');
			await clean('collector record');
			for (const summary of await page.locator('main summary').all()) await summary.tap();
			await clean('collector record, opened');
			const form = page.locator('[data-custody-form]');
			await form.getByLabel('0706', { exact: true }).check();
			await form.getByRole('button', { name: 'Devolver 1 bono' }).tap();
			const dialog = page.getByRole('dialog');
			await expect(dialog).toContainText(`¿Devolver el bono 0706 de ${collector}?`);
			const box = await dialog.boundingBox();
			expect(box!.x).toBeGreaterThanOrEqual(0);
			expect(box!.x + box!.width).toBeLessThanOrEqual(375);
			const opened = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
			expect(opened.violations, 'collector record, dialog: axe').toEqual([]);
			await dialog.getByRole('button', { name: 'Cancelar' }).tap();

			// The current account: the balance is on the first screen, rows are stacked.
			await open(page, ledger());
			await onFirstScreen(balance(page));
			await clean('current account');
			for (const summary of await page.locator('main summary').all()) await summary.tap();
			await clean('current account, opened');
			await page.locator('[data-annul]').first().tap();
			await expect(page.getByRole('dialog')).toBeVisible();
			const annul = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
			expect(annul.violations, 'current account, dialog: axe').toEqual([]);
			await page.getByRole('dialog').getByRole('button', { name: 'Cancelar' }).tap();

			// The buyer record.
			await open(page, buyerRecord());
			await onFirstScreen(page.locator('[data-buyer-sentence]'));
			await clean('buyer record');
			for (const summary of await page.locator('main summary').all()) await summary.tap();
			await clean('buyer record, opened');
			await context.close();
		});
	}
});
