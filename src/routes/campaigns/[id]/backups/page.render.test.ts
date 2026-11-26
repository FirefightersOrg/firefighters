import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import Page from './+page.svelte';

describe('backup exports', () => {
	it('keeps the same export destination and explains an unavailable export', () => {
		const body = render(Page, {
			props: {
				data: {
					campaign: { id: 'campaign', name: 'Bono 2026' },
					exports: [
						{ kind: 'payments', label: 'Pagos', hasPeriod: true, allowed: true },
						{ kind: 'bonds', label: 'Bonos', hasPeriod: false, allowed: false }
					]
				}
			} as never
		}).body;
		expect(body).toContain('Filtrar por período');
		expect(body).toContain('/campaigns/campaign/backups/export/payments');
		expect(body).not.toContain('/campaigns/campaign/backups/export/bonds');
		expect(body).toContain('Sin permiso de exportación');
	});
});
