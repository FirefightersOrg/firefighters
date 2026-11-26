/* eslint-disable @typescript-eslint/no-explicit-any */
import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import Page from './+page.svelte';

const campaignId = 'f0000000-0000-4000-8000-000000000001';
const entry = {
	id: 'e0000000-0000-4000-8000-000000000001',
	action: 'payment.annul',
	entityType: 'payment',
	entityId: 'p0000000-0000-4000-8000-000000000001',
	actorUserId: 'a0000000-0000-4000-8000-000000000001',
	actorName: 'Treasurer',
	oldValue: { status: 'confirmed' },
	newValue: {
		status: 'annulled',
		collector_id: 'c0000000-0000-4000-8000-000000000001',
		generated_compensatory_movements: ['l0000000-0000-4000-8000-000000000001']
	},
	reason: 'Duplicate receipt',
	createdAt: '2026-11-19T15:00:00Z',
	requestId: 'request'
};
const data = (detail: typeof entry | null = null) => ({
	campaign: { id: campaignId, name: 'Campaign' },
	entries: { items: [entry], total: 1051, page: 1, pageSize: 50 },
	detail,
	filters: { actor: null, action: null, entityType: null, from: null, to: null, page: 1 }
});

describe('campaign audit render', () => {
	it('renders filters, rows and pagination beyond 1000 entries', () => {
		const body = render(Page, { props: { data: data(), params: { id: campaignId } } as any }).body;
		expect(body).toContain('1.051 registros');
		expect(body).toContain('Treasurer');
		expect(body).toContain('Registro anulado');
		expect(body).toContain('Pago');
		expect(body.replace(/<[^>]*>/g, '')).not.toContain('payment.annul');
		expect(body).not.toContain(entry.actorUserId);
		expect(body).toContain('name="person"');
		expect(body).toContain('name="entityType"');
		expect(body).toContain('Siguiente');
	});
	it('renders before/after diff, reason and compensating movement link', () => {
		const body = render(Page, {
			props: { data: data(entry), params: { id: campaignId } } as any
		}).body;
		expect(body).toContain('Detalle del cambio');
		expect(body).toContain('payment.annul');
		expect(body).toContain('Duplicate receipt');
		expect(body).toContain('confirmed');
		expect(body).toContain('annulled');
		expect(body).toContain('l0000000-0000-4000-8000-000000000001');
	});
});
