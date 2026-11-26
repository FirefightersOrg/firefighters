import { expect, test } from '@playwright/test';
import { apiActiveCampaign, apiBond, apiCollector, apiDeliverSellAndSettle } from './api';
import { baDay, open, runId } from './helpers';

/** SAN-91 critical flow 2: generate & freeze roster → load & validate winner. */
test('generate and freeze a roster, then load and validate the winning number', async ({
	page
}) => {
	const run = runId();
	// Setup through the API: the money flow has its own UI test; this one starts at the draw.
	const campaignId = await apiActiveCampaign(`E2E sorteo ${run}`);
	const collector = await apiCollector(`Cobrador ${run}`);
	const bond = await apiBond(campaignId, 100);
	await apiBond(campaignId, 200);
	await apiDeliverSellAndSettle(campaignId, collector, bond);

	// Final draw whose cutoff (today, Buenos Aires) covers today's confirmed payment.
	await open(page, `/campaigns/${campaignId}/draws/new`);
	await page.locator('#drawType').selectOption('final');
	await page.locator('#name').fill(`Final ${run}`);
	await page.locator('#drawDate').fill(baDay(1));
	await page.locator('#paymentCutoffLocal').fill(`${baDay(0)}T23:59`);
	await page.locator('#requiredInstallmentNumber').fill('1');
	await page.getByRole('button', { name: 'Crear sorteo' }).click();
	await expect(page).toHaveURL(/\/draws\/[0-9a-f-]{36}$/);
	await page.waitForLoadState('networkidle');

	await page.getByRole('button', { name: 'Generar padrón' }).click();
	await expect(page.getByText('Padrón generado.')).toBeVisible();
	await page.waitForLoadState('networkidle');
	await page.getByLabel('Confirmo que este padrón es el definitivo').check();
	await page.getByRole('button', { name: 'Congelar padrón' }).click();
	await expect(page.getByText('Padrón congelado.')).toBeVisible();

	// The frozen roster lists the sold, paid bond as eligible.
	await page.getByRole('link', { name: 'Ver padrón' }).click();
	await expect(page.getByRole('heading', { name: 'Padrón congelado', level: 1 })).toBeVisible();
	await expect(page.getByRole('row', { name: /0100.*Habilitado/ })).toBeVisible();

	// Configure a prize and load the winning number against the frozen roster.
	const drawUrl = page.url().replace(/\/roster$/, '');
	await open(page, `${drawUrl}/winners`);
	await page.getByText('Configurar un premio').click();
	await page.locator('#create-position').fill('1');
	await page.locator('#create-name').fill('Bicicleta');
	await page.getByRole('button', { name: 'Crear premio' }).click();
	await expect(page.getByText('Premio creado.')).toBeVisible();
	await page.waitForLoadState('networkidle');
	await page.getByLabel('Número ganador').fill('100');
	await page.getByRole('button', { name: 'Validar contra el padrón congelado' }).click();
	const result = page
		.getByText('Resultado de la validación del 0100')
		.locator('xpath=ancestor::section[1]');
	await expect(result).toBeVisible();
	await expect(result.getByText('Habilitado', { exact: true })).toBeVisible();
	await expect(result.getByText('Pendiente de resolución.')).toBeVisible();

	// Award it: the prize moves to pending delivery.
	await page.waitForLoadState('networkidle');
	await page.getByRole('button', { name: 'Registrar resolución' }).click();
	await expect(page.getByText('Premio resuelto.')).toBeVisible();
	await expect(page.getByText('Pendiente de entrega').first()).toBeVisible();
});
