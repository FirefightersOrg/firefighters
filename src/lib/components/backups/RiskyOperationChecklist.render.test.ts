import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import RiskyOperationChecklist from './RiskyOperationChecklist.svelte';
import { RISKY_OPERATION_STEPS } from '$lib/domain/backup-exports';

const base = { campaignId: 'c', operation: 'cerrar la campaña', canExport: true };

describe('RiskyOperationChecklist (SAN-136)', () => {
	it('renders every step as an unchecked checkbox and the progress', () => {
		const { body } = render(RiskyOperationChecklist, { props: base });
		expect(body.match(/type="checkbox"/g)).toHaveLength(RISKY_OPERATION_STEPS.length);
		expect(body).not.toMatch(/type="checkbox"[^>]*\schecked(=|\s|\/|>)/);
		for (const step of RISKY_OPERATION_STEPS) expect(body).toContain(step);
		expect(body).toContain('Antes de cerrar la campaña: lista de 6 pasos');
		expect(body).toContain('0 de 6 pasos marcados.');
	});
	it('links the backup exports only with the export permission', () => {
		expect(render(RiskyOperationChecklist, { props: base }).body).toContain('/campaigns/c/backups');
		const without = render(RiskyOperationChecklist, { props: { ...base, canExport: false } }).body;
		expect(without).not.toContain('/campaigns/c/backups');
		expect(without).toContain('permiso de exportación');
	});
	it('offers the danger confirmation only when a confirm label is given', () => {
		expect(render(RiskyOperationChecklist, { props: base }).body).not.toContain('Cerrar campaña');
		const confirmable = render(RiskyOperationChecklist, {
			props: { ...base, confirmLabel: 'Cerrar campaña', confirmAction: '?/close' }
		}).body;
		expect(confirmable).toContain('Cerrar campaña');
		const confirm = confirmable.match(/<button[^>]*data-dialog-confirm[^>]*>/)?.[0];
		expect(confirm).toBeDefined();
		expect(confirm).toContain('disabled');
	});
});
