import { test } from '@playwright/test';
import {
	createActiveCampaign,
	createBond,
	createCollector,
	deliverSellAndSettle,
	login,
	runId
} from './helpers';

/** SAN-91 critical flow 1: create campaign → load bond → sell → pay → settle. */
test('create campaign, load a bond, deliver it, sell it, pay it and close the settlement', async ({
	page
}) => {
	const run = runId();
	await login(page);
	const campaignId = await createActiveCampaign(page, `E2E dinero ${run}`);
	await createCollector(page, campaignId, `Cobrador ${run}`);
	await createBond(page, campaignId, 100);

	await deliverSellAndSettle(page, campaignId, `Cobrador ${run}`, 100);
});
