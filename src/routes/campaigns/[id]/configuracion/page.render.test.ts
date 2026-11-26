import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import Page from './+page.svelte';
import { mapCampaignRow } from '$lib/server/repositories/campaigns';
import { campaignRow } from '../../test-helpers';

const page = (editable: boolean) =>
	render(Page, {
		props: {
			data: {
				campaign: mapCampaignRow(
					campaignRow({ simple_bond_value: '60000.50', installment_value: '6000.05' })
				),
				hasBonds: false,
				can: {
					editName: editable,
					editDates: editable,
					editRules: editable,
					exportBackups: editable
				}
			},
			form: null
		} as never
	}).body;
describe('data and rules', () => {
	it('shows whole pesos and keeps the original action fields with explicit confirmation', () => {
		const body = page(true);
		expect(body).toContain('60.001');
		expect(body.slice(body.indexOf('id="summary"'), body.indexOf('id="general"'))).not.toContain(
			'60.000,50'
		);
		expect(body).toContain('¿Guardar los datos de la campaña?');
		expect(body).toContain('¿Guardar las reglas de la campaña?');
		expect(body).toContain('action="?/update"');
		expect(body).toContain('action="?/rules"');
		expect(body).toContain('name="expectedUpdatedAt"');
	});
	it('does not offer editing or confirmations without permissions', () => {
		const body = page(false);
		expect(body).not.toContain('action="?/update"');
		expect(body).not.toContain('action="?/rules"');
		expect(body).not.toContain('<dialog');
	});
});
