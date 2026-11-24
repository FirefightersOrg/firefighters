import { expect, test } from '@playwright/test';
import { createActiveCampaign, createBond, createCollector, login, open, runId } from './helpers';

/** SAN-91 critical flow 1: create campaign → load bond → sell → pay → settle. */
test('create campaign, load a bond, deliver it, sell it, pay it and close the settlement', async ({
	page
}) => {
	const run = runId();
	await login(page);
	const campaignId = await createActiveCampaign(page, `E2E dinero ${run}`);
	await createCollector(page, campaignId, `Cobrador ${run}`);
	await createBond(page, campaignId, 100);

	// Deliver the bond to the collector.
	await open(page, `/campaigns/${campaignId}/deliveries/new`);
	await page.locator('#query').fill('100');
	await page.getByRole('button', { name: 'Agregar' }).click();
	await expect(page.getByText('1 agregados.')).toBeVisible();
	await page.locator('#collectorId').selectOption({ label: `Cobrador ${run}` });
	await page.getByRole('button', { name: 'Entregar y emitir remito' }).click();
	await expect(page).toHaveURL(/\/deliveries\/[0-9a-f-]{36}$/);
	await expect(page.getByRole('heading', { name: /Remito \d{4}/ })).toBeVisible();

	// Sell it to a buyer created inline.
	await open(page, `/campaigns/${campaignId}/sales/new`);
	await page.locator('#query').fill('100');
	await page.locator('form[action="?/lookup"] button[type="submit"]').click();
	await page.getByRole('radio').first().check();
	await page.getByText('Crear un comprador').click();
	await page.locator('#buyer-firstName').fill('Ana');
	await page.locator('#buyer-lastName').fill(`Comprador ${run}`);
	await page.getByRole('button', { name: 'Crear comprador' }).click();
	await expect(page.locator('#buyerId')).not.toHaveValue('');
	await page.getByRole('button', { name: 'Confirmar venta' }).click();
	await expect(page).toHaveURL(/\/sales\/[0-9a-f-]{36}$/);
	await expect(page.getByText('Pago total').first()).toBeVisible();

	// Open a settlement, add the cash payment and close it.
	await open(page, `/campaigns/${campaignId}/settlements/new`);
	await page.locator('#collectorId').selectOption({ label: `Cobrador ${run}` });
	await page.getByRole('button', { name: 'Abrir rendición' }).click();
	await expect(page).toHaveURL(/\/settlements\/[0-9a-f-]{36}$/);
	await page.waitForLoadState('networkidle');
	await page.locator('#sale').selectOption({ index: 1 });
	await page.locator('input[name="installmentId"]').first().check();
	await page.getByRole('button', { name: 'Agregar pago' }).click();
	await expect(page.getByText('Pago agregado.')).toBeVisible();
	await page.getByRole('button', { name: 'Cerrar rendición' }).first().click();
	const dialog = page.getByRole('dialog');
	await expect(dialog.getByText('$ 1.000,00').first()).toBeVisible();
	await dialog.getByRole('button', { name: 'Cerrar rendición' }).click();
	await expect(page.getByText('Rendición cerrada.')).toBeVisible();
	await expect(page.getByText('Cerrada', { exact: true }).first()).toBeVisible();
});
