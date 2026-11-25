import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import ListPage from './+page.svelte';
import DetailPage from './[bondId]/+page.svelte';

const CAMPAIGN = { id: 'f0000000-0000-0000-0000-000000000001', name: 'Campaña 2027' };
const bond = {
	id: 'b0000000-0000-0000-0000-000000000001',
	kind: 'simple' as const,
	typeLabel: 'Bono simple',
	baseNumbers: ['0068'],
	associatedNumbers: ['4939'],
	commercialStatus: 'delivered_to_collector' as const,
	financialStatus: 'overdue' as const,
	unitCount: 1,
	totalValue: '60000.00'
};
const collector = { id: 'c1', displayName: 'Ana', status: 'active' };
const filters = { status: '', financial: '', page: 1 };
const pagination = { page: 1, pageSize: 25, total: 1, pageCount: 1 };

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- minimal PageProps for SSR
const props = (data: unknown): any => ({ data, params: {} });

describe('Mis bonos list', () => {
	it('renders a semantic table with status badges and a detail link', () => {
		const body = render(ListPage, {
			props: props({ collector, campaign: CAMPAIGN, filters, bonds: [bond], pagination })
		}).body;
		expect(body).toContain('<table');
		expect(body).toContain('<caption');
		expect(body).toContain('scope="col"');
		expect(body).toContain('0068');
		expect(body).toContain('4939');
		expect(body).toContain('Entregado al cobrador');
		expect(body).toContain('En mora');
		expect(body).toContain(`/portal/${CAMPAIGN.id}/bonos/${bond.id}`);
		expect(body).toContain('Mis bonos');
	});

	it('renders the empty state, filtered and not', () => {
		const empty = {
			collector,
			campaign: CAMPAIGN,
			bonds: [],
			pagination: { ...pagination, total: 0 }
		};
		const none = render(ListPage, { props: props({ ...empty, filters }) }).body;
		expect(none).toContain('Todavía no hay bonos asignados');
		const filtered = render(ListPage, {
			props: props({ ...empty, filters: { ...filters, status: 'sold' } })
		}).body;
		expect(filtered).toContain('Ningún bono coincide con los filtros');
	});

	it('renders the unlinked state', () => {
		const body = render(ListPage, {
			props: props({ collector: null, campaign: CAMPAIGN, filters, bonds: [], pagination })
		}).body;
		expect(body).toContain('todavía no está vinculado');
	});
});

describe('Mis bonos detail', () => {
	const detail = {
		campaign: CAMPAIGN,
		bond,
		assignments: [
			{
				id: 'a1',
				assignmentType: 'delivery',
				status: 'active',
				assignedAt: '2026-11-02T15:00:00Z',
				returnedAt: null,
				noteNumber: 7
			}
		],
		notes: [
			{
				id: 'n1',
				noteNumber: 7,
				reason: 'delivery',
				status: 'issued',
				issuedAt: '2026-11-02T15:00:00Z'
			}
		]
	};

	it('shows history and notes, with the print link only when allowed', () => {
		const withLink = render(DetailPage, { props: props({ ...detail, canPrintNotes: true }) }).body;
		expect(withLink).toContain('Historial de asignaciones');
		expect(withLink).toContain('Entrega');
		expect(withLink).toContain('Vigente');
		expect(withLink).toContain('Remito 0007');
		expect(withLink).toContain(`/campaigns/${CAMPAIGN.id}/deliveries/n1/print`);
		const without = render(DetailPage, { props: props({ ...detail, canPrintNotes: false }) }).body;
		expect(without).not.toContain('/print');
	});

	it('shows empty states without history', () => {
		const body = render(DetailPage, {
			props: props({ ...detail, assignments: [], notes: [], canPrintNotes: false })
		}).body;
		expect(body).toContain('Sin movimientos');
		expect(body).toContain('Sin remitos');
	});
});
