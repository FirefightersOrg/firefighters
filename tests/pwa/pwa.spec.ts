import { expect, test } from '@playwright/test';

/** Waits until the service worker controls the page (first visit installs it, a reload adopts it). */
async function controlledLogin(page: import('@playwright/test').Page) {
	await page.goto('/login');
	await page.evaluate(async () => {
		await navigator.serviceWorker.ready;
	});
	await page.reload();
	await expect
		.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null))
		.toBe(true);
}

/**
 * Cuts the network for the page AND for the service worker. Playwright's setOffline() does not reach
 * a Chromium service worker's own fetch(), so the worker target is put offline through browser CDP.
 */
async function goOffline(
	browser: import('@playwright/test').Browser,
	context: import('@playwright/test').BrowserContext,
	offline: boolean
) {
	await context.setOffline(offline);
	const cdp = await browser.newBrowserCDPSession();
	const { targetInfos } = (await cdp.send('Target.getTargets')) as {
		targetInfos: { targetId: string; type: string }[];
	};
	const workers = targetInfos.filter((t) => t.type === 'service_worker');
	expect(workers.length).toBeGreaterThan(0);
	for (const worker of workers) {
		const { sessionId } = (await cdp.send('Target.attachToTarget', {
			targetId: worker.targetId,
			flatten: false
		})) as { sessionId: string };
		const send = (method: string, params: Record<string, unknown> = {}) =>
			cdp.send(
				'Target.sendMessageToTarget' as never,
				{
					sessionId,
					message: JSON.stringify({ id: Math.floor(Math.random() * 1e9), method, params })
				} as never
			);
		await send('Network.enable');
		await send('Network.emulateNetworkConditions', {
			offline,
			latency: 0,
			downloadThroughput: -1,
			uploadThroughput: -1
		});
	}
}

test('the manifest is complete and every icon is served as PNG', async ({ request }) => {
	const res = await request.get('/manifest.webmanifest');
	expect(res.ok()).toBe(true);
	const manifest = await res.json();
	expect(manifest).toMatchObject({
		short_name: 'Firefighters',
		lang: 'es',
		start_url: '/',
		scope: '/',
		display: 'standalone'
	});
	const sizes = manifest.icons.map(
		(i: { sizes: string; purpose: string }) => `${i.sizes}:${i.purpose}`
	);
	expect(sizes).toEqual(expect.arrayContaining(['192x192:any', '512x512:any', '512x512:maskable']));
	for (const icon of [...manifest.icons, { src: '/icons/apple-touch-icon.png' }]) {
		const file = await request.get(icon.src);
		expect(file.ok(), icon.src).toBe(true);
		expect(file.headers()['content-type'], icon.src).toContain('image/png');
	}
});

test('Chrome reports the app as installable (no installability errors)', async ({ page }) => {
	await controlledLogin(page);
	const cdp = await page.context().newCDPSession(page);
	const { installabilityErrors } = (await cdp.send('Page.getInstallabilityErrors')) as {
		installabilityErrors: { errorId: string }[];
	};
	expect(installabilityErrors.map((e) => e.errorId)).toEqual([]);
});

test('offline, any page shows the friendly offline screen and Retry is there', async ({
	browser,
	page,
	context
}) => {
	await controlledLogin(page);
	await goOffline(browser, context, true);
	for (const path of [
		'/login',
		'/campaigns',
		'/campaigns/00000000-0000-4000-8000-000000000001/sales'
	]) {
		// Chromium may restart the worker between navigations; re-apply the cut to the current target.
		await goOffline(browser, context, true);
		await page.goto(path);
		expect(page.url(), path).toContain(path);
		await expect(page.getByRole('heading', { name: 'Sin conexión' }), path).toBeVisible();
		await expect(page.getByRole('button', { name: 'Reintentar' }), path).toBeVisible();
	}
	await expect(page).toHaveTitle('Sin conexión - Firefighters');
	await goOffline(browser, context, false);
	await page.getByRole('button', { name: 'Reintentar' }).click();
	await expect(page.getByRole('heading', { name: 'Sin conexión' })).toHaveCount(0);
});

test('the cache holds only the static shell: no HTML pages, no data, no API', async ({ page }) => {
	await controlledLogin(page);
	const cached = await page.evaluate(async () => {
		const out: string[] = [];
		for (const name of await caches.keys())
			for (const req of await (await caches.open(name)).keys()) out.push(new URL(req.url).pathname);
		return out;
	});
	expect(cached).toContain('/offline.html');
	expect(cached).toContain('/manifest.webmanifest');
	const pages = cached.filter(
		(p) =>
			p === '/' ||
			p === '/login' ||
			p.startsWith('/campaigns') ||
			p.startsWith('/portal') ||
			p.startsWith('/api') ||
			p.endsWith('__data.json')
	);
	expect(pages).toEqual([]);
	// The app shell itself is precached (build output), so a controlled page loads its assets offline.
	expect(cached.some((p) => p.startsWith('/_app/immutable/'))).toBe(true);
});
