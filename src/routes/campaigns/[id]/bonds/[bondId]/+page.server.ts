import { error } from '@sveltejs/kit';
import { z } from 'zod';
import type { Actions, PageServerLoad, RequestEvent } from './$types';
import {
	hasPermissionIn,
	permissionsUnavailable,
	requirePermissionIn
} from '$lib/server/auth/permissions';
import { buildBondRecord } from '$lib/server/bonds/record';
import {
	bondFormFailure,
	bondServiceFailure,
	bondValidationFailure,
	checkBondActionPermission,
	type BondFormResult
} from '$lib/server/bonds/route-helpers';
import { requireCampaignViewer } from '$lib/server/campaigns/route-helpers';
import {
	getBondById,
	getBondCampaignId,
	listBondBaseNumbers,
	listBondNumbersByBondIds,
	listMembershipsOfMember,
	listPataMemberships,
	type BondGroupHistoryEntry
} from '$lib/server/repositories/bonds';
import {
	AUDIT_ENTRIES_LIMIT,
	listAuditEntriesForEntities
} from '$lib/server/repositories/audit-log';
import type { RepositoryResult } from '$lib/server/repositories/campaigns';
import { getCampaignById } from '$lib/server/repositories/campaigns';
import { listBondAssignments } from '$lib/server/repositories/deliveries';
import { listActiveCollectorOptions } from '$lib/server/repositories/parties';
import {
	DeliveryServiceError,
	markBondLost,
	reassignBondsToCollector,
	returnBondsFromCollector
} from '$lib/server/services/deliveries';
import { requireActiveUser } from '$lib/server/auth/guards';
import { canDeliverBonds, canLoadBonds } from '$lib/domain/campaigns';
import { fail, redirect } from '@sveltejs/kit';
import { annulBond, BOND_MESSAGES, ungroupPata } from '$lib/server/services/bonds';
import { BOND_RECORD_ACTION_FIELDS, bondAnnulSchema, bondUngroupSchema } from '$lib/schemas/bond';
import { readFormFields } from '$lib/schemas/campaign';
import { getActiveSaleForBond, listInstallmentsForSale } from '$lib/server/repositories/sales';
import { listBondPayments } from '$lib/server/repositories/settlements';
import {
	correctBondCollector,
	SaleCorrectionServiceError
} from '$lib/server/services/sale-corrections';
import { listBondDrawRosterEntries } from '$lib/server/repositories/draws';
import { listBondPrizes } from '$lib/server/repositories/prizes';

const isUuid = (value: string) => z.guid().safeParse(value).success;

/**
 * /campaigns/[id]/bonds/[bondId]: the bond record, with the 14 sections of docs/screens.md
 * "Bond record". General data (with the manual pata composition and ungroup history),
 * participating numbers padded with the campaign's digit count, barcode and audit come from the
 * database; collector, buyer, sale, installments, payments, settlements, commissions, draws and
 * prizes show empty states until their phases. Audit needs `audit.view` (else a note).
 * Requires an active user with `campaign.view` and `bond.view` (else 403).
 *
 * Actions (the SQL functions re-check permission, status and campaign window). Both answer 404
 * without calling the database function unless the bond belongs to the URL's campaign:
 * - `?/ungroup`: an available manual pata (`bond.create`, reason required). The pata is annulled,
 *   its memberships are kept as history and its members are free again.
 * - `?/annul`: an available simple bond or printed pata that is not in a pata (`bond.annul`,
 *   reason required). Its numbers are released so they can be entered again.
 */
export const load: PageServerLoad = async ({ locals, params, url }) => {
	if (permissionsUnavailable(locals.permissions))
		error(500, { message: 'No se pudieron cargar los permisos.' });
	requireCampaignViewer(locals, url);
	requirePermissionIn(locals.permissions, 'bond.view');
	if (!isUuid(params.id)) error(404, { message: BOND_MESSAGES.campaignNotFound });
	if (!isUuid(params.bondId)) error(404, { message: BOND_MESSAGES.bondNotFound });

	const fail500 = (cause: unknown): never => {
		console.error('[bonds] bond record load failed', {
			requestId: locals.requestId,
			bondId: params.bondId,
			error: cause
		});
		error(500, { message: 'No se pudo cargar el bono. Volver a intentar.' });
	};

	const [campaignResult, bondResult] = await Promise.all([
		getCampaignById(locals.supabase, params.id),
		getBondById(locals.supabase, params.bondId)
	]);
	if (campaignResult.error) fail500(campaignResult.error);
	if (bondResult.error) fail500(bondResult.error);
	const campaign = campaignResult.data;
	if (!campaign) error(404, { message: BOND_MESSAGES.campaignNotFound });
	const bond = bondResult.data;
	if (!bond || bond.campaignId !== campaign.id) {
		error(404, { message: BOND_MESSAGES.bondNotFound });
	}

	// Manual pata: all its memberships (history) and its members' numbers. Simple bond: every
	// pata it was a member of (active and ungrouped), named by their base numbers.
	const isManualPata = bond.origin === 'manual_grouping';
	const membershipsResult: RepositoryResult<BondGroupHistoryEntry[]> = isManualPata
		? await listPataMemberships(locals.supabase, bond.id)
		: bond.kind === 'simple'
			? await listMembershipsOfMember(locals.supabase, bond.id)
			: { data: [], error: null };
	if (membershipsResult.error) fail500(membershipsResult.error);
	const memberships = membershipsResult.data ?? [];
	const pataIds = isManualPata ? [] : [...new Set(memberships.map((m) => m.pataBondId))];

	const canViewAudit = hasPermissionIn(locals.permissions, 'audit.view');
	const [numbersResult, basesResult, auditResult] = await Promise.all([
		// No query when there are no members / patas (see the repository functions).
		listBondNumbersByBondIds(
			locals.supabase,
			isManualPata ? memberships.map((m) => m.memberBondId) : []
		),
		listBondBaseNumbers(locals.supabase, pataIds),
		canViewAudit
			? listAuditEntriesForEntities(locals.supabase, 'bond', [bond.id, ...pataIds], {
					limit: AUDIT_ENTRIES_LIMIT + 1
				})
			: Promise.resolve(null)
	]);
	if (numbersResult.error) fail500(numbersResult.error);
	if (basesResult.error) fail500(basesResult.error);
	if (auditResult?.error) fail500(auditResult.error);
	const auditEntries = auditResult?.data ?? [];

	// Custody (SAN-55): history, and which custody actions apply to this bond now.
	const status = bond.commercialStatus;
	const open = canLoadBonds(campaign.status);
	const canDeliver = canDeliverBonds(campaign.status);
	const isActiveManualPataMember = bond.activeGroup !== null;
	const can = {
		returnBond:
			open &&
			!isActiveManualPataMember &&
			status === 'delivered_to_collector' &&
			hasPermissionIn(locals.permissions, 'bond.return'),
		reassign:
			canDeliver &&
			!isActiveManualPataMember &&
			status === 'delivered_to_collector' &&
			hasPermissionIn(locals.permissions, 'bond.assign'),
		markLost:
			open &&
			!isActiveManualPataMember &&
			(status === 'available' || status === 'delivered_to_collector') &&
			hasPermissionIn(locals.permissions, 'bond.mark_lost'),
		correctCollector:
			(status === 'sold' && hasPermissionIn(locals.permissions, 'sale.correct')) ||
			(status === 'delivered_to_collector' &&
				canDeliver &&
				hasPermissionIn(locals.permissions, 'bond.assign'))
	};
	const canViewDraws = (
		[
			'draw.view',
			'draw.create',
			'draw.update',
			'draw.generate_roster',
			'draw.freeze_roster',
			'draw.load_winner'
		] as const
	).some((permission) => hasPermissionIn(locals.permissions, permission));
	const canViewPrizes = (
		['draw.view', 'draw.load_winner', 'prize.resolve', 'prize.deliver', 'prize.annul'] as const
	).some((permission) => hasPermissionIn(locals.permissions, permission));
	const [historyResult, collectorsResult, activeSaleResult, drawEntriesResult] = await Promise.all([
		listBondAssignments(locals.supabase, bond.id),
		can.reassign || can.correctCollector
			? listActiveCollectorOptions(locals.supabase)
			: Promise.resolve({ data: [], error: null }),
		getActiveSaleForBond(locals.supabase, bond.id),
		canViewDraws
			? listBondDrawRosterEntries(locals.supabase, campaign.id, bond.id)
			: Promise.resolve({ data: [], error: null })
	]);
	if (historyResult.error || activeSaleResult.error || drawEntriesResult.error)
		fail500(historyResult.error ?? activeSaleResult.error ?? drawEntriesResult.error);
	if (collectorsResult.error) fail500(collectorsResult.error);
	const installmentsResult = activeSaleResult.data
		? await listInstallmentsForSale(locals.supabase, activeSaleResult.data.sale.id)
		: { data: [], error: null };
	if (installmentsResult.error) fail500(installmentsResult.error);
	const paymentsResult = await listBondPayments(locals.supabase, bond.id);
	if (paymentsResult.error) fail500(paymentsResult.error);
	const prizesResult = canViewPrizes
		? await listBondPrizes(locals.supabase, campaign.id, bond.id)
		: { data: [], error: null };
	if (prizesResult.error) fail500(prizesResult.error);

	return {
		campaign,
		custody: {
			history: historyResult.data ?? [],
			collectors: (collectorsResult.data ?? []).filter((c) => c.id !== bond.currentCollectorId),
			fromCollectorId: bond.currentCollectorId,
			can
		},
		record: buildBondRecord({
			campaign,
			bond,
			memberships: isManualPata ? memberships : [],
			memberNumbers: numbersResult.data ?? [],
			membershipsAsMember: isManualPata ? [] : memberships,
			pataBaseNumbers: basesResult.data ?? new Map(),
			audit: canViewAudit
				? {
						entries: auditEntries.slice(0, AUDIT_ENTRIES_LIMIT),
						truncated: auditEntries.length > AUDIT_ENTRIES_LIMIT
					}
				: null,
			permissions: locals.permissions ?? []
		}),
		sale: activeSaleResult.data,
		installments: installmentsResult.data ?? [],
		payments: paymentsResult.data ?? [],
		drawRosterEntries: drawEntriesResult.data ?? [],
		canViewDraws,
		prizes: prizesResult.data ?? [],
		canViewPrizes
	};
};

/**
 * Actions: the bond must exist and belong to the campaign of the URL, else a 404 result (the same
 * one for a malformed id, a missing bond and a bond of another campaign, so nothing leaks about
 * other campaigns). Returns null when the action may proceed. Runs after the permission check.
 */
async function checkBondInCampaign(
	locals: App.Locals,
	params: { id: string; bondId: string },
	form: 'ungroup' | 'annul'
) {
	if (!isUuid(params.id) || !isUuid(params.bondId)) {
		return bondFormFailure(form, 404, BOND_MESSAGES.bondNotFound);
	}
	const { data: campaignId, error: loadError } = await getBondCampaignId(
		locals.supabase,
		params.bondId
	);
	if (loadError) {
		console.error('[bonds] bond scope check failed', {
			requestId: locals.requestId,
			bondId: params.bondId,
			error: loadError
		});
		return bondFormFailure(form, 500, 'No se pudo cargar el bono. Volver a intentar.');
	}
	if (campaignId !== params.id) return bondFormFailure(form, 404, BOND_MESSAGES.bondNotFound);
	return null;
}

export const actions: Actions = {
	ungroup: async ({ request, locals, params, url }) => {
		const denied = checkBondActionPermission(locals, url, 'ungroup', 'bond.create');
		if (denied) return denied;
		const outOfScope = await checkBondInCampaign(locals, params, 'ungroup');
		if (outOfScope) return outOfScope;

		const values = readFormFields(await request.formData(), BOND_RECORD_ACTION_FIELDS);
		const parsed = bondUngroupSchema.safeParse({ ...values, pataBondId: params.bondId });
		if (!parsed.success) return bondValidationFailure('ungroup', parsed.error, values);

		try {
			await ungroupPata(locals.supabase, parsed.data, {
				requestId: locals.requestId,
				permissions: locals.permissions
			});
		} catch (err) {
			return bondServiceFailure('ungroup', err, values);
		}
		const result: BondFormResult = {
			form: 'ungroup',
			success: true,
			message:
				'Pata desagrupada. Quedó anulada y sus bonos vuelven a estar disponibles por separado.',
			errors: {}
		};
		return result;
	},

	annul: async ({ request, locals, params, url }) => {
		const denied = checkBondActionPermission(locals, url, 'annul', 'bond.annul');
		if (denied) return denied;
		const outOfScope = await checkBondInCampaign(locals, params, 'annul');
		if (outOfScope) return outOfScope;

		const values = readFormFields(await request.formData(), BOND_RECORD_ACTION_FIELDS);
		const parsed = bondAnnulSchema.safeParse({ ...values, bondId: params.bondId });
		if (!parsed.success) return bondValidationFailure('annul', parsed.error, values);

		try {
			await annulBond(locals.supabase, parsed.data, {
				requestId: locals.requestId,
				permissions: locals.permissions
			});
		} catch (err) {
			return bondServiceFailure('annul', err, values);
		}
		const result: BondFormResult = {
			form: 'annul',
			success: true,
			message: 'Bono anulado. Sus números quedaron libres y se pueden volver a ingresar.',
			errors: {}
		};
		return result;
	},
	return: returnAction,
	reassign: reassignAction,
	markLost: markLostAction,
	correctCollector: async ({ request, locals, params, url }) => {
		if (permissionsUnavailable(locals.permissions))
			return fail(500, {
				form: 'correctCollector',
				errors: {},
				message: 'No se pudieron cargar los permisos.'
			});
		requireActiveUser(locals, url.pathname);
		const data = await request.formData();
		const sold = field(data, 'sold') === 'true';
		const permission = sold ? 'sale.correct' : 'bond.assign';
		if (!hasPermissionIn(locals.permissions, permission))
			return fail(403, { form: 'correctCollector', errors: {}, message: BOND_MESSAGES.permission });
		const scoped = await getBondCampaignId(locals.supabase, params.bondId);
		if (scoped.error)
			return fail(500, {
				form: 'correctCollector',
				errors: {},
				message: 'No se pudo cargar el bono.'
			});
		if (scoped.data !== params.id)
			return fail(404, {
				form: 'correctCollector',
				errors: {},
				message: BOND_MESSAGES.bondNotFound
			});
		const values = { newCollectorId: field(data, 'newCollectorId'), reason: field(data, 'reason') };
		try {
			await correctBondCollector(
				locals.supabase,
				{ bondId: params.bondId, sold, ...values },
				{ requestId: locals.requestId ?? null, permissions: locals.permissions ?? null }
			);
			return {
				form: 'correctCollector',
				success: true,
				message: 'Cobrador corregido.',
				errors: {}
			};
		} catch (cause) {
			const service = cause instanceof SaleCorrectionServiceError ? cause : null;
			return fail(service?.status ?? 500, {
				form: 'correctCollector',
				values,
				errors: {},
				message: service?.message ?? 'No se pudo registrar la corrección.'
			});
		}
	}
};

// ---------------------------------------------------------------------------
// Custody actions (SAN-55): return, reassign, mark lost
// ---------------------------------------------------------------------------

export interface CustodyFormResult {
	form: 'custody';
	action: 'return' | 'reassign' | 'markLost';
	success: boolean;
	message: string;
	errors: Record<string, string[]>;
	values?: Record<string, string>;
}

function custodyFailure(
	action: CustodyFormResult['action'],
	status: number,
	message: string,
	extra: { errors?: Record<string, string[]>; values?: Record<string, string> } = {}
) {
	const data: CustodyFormResult = {
		form: 'custody',
		action,
		success: false,
		message,
		errors: extra.errors ?? {},
		values: extra.values
	};
	return fail(status, data);
}

function custodyServiceFailure(
	action: CustodyFormResult['action'],
	err: unknown,
	values?: Record<string, string>
) {
	if (!(err instanceof DeliveryServiceError)) throw err;
	const field = err.field && err.field !== 'bondIds' ? err.field : undefined;
	return custodyFailure(action, err.status, err.message, {
		errors: field ? { [field]: [err.message] } : {},
		values
	});
}

/** Active user, permission, and a bond of this campaign (else a fail()). */
async function custodyPreflight(
	locals: App.Locals,
	url: URL,
	params: { id: string; bondId: string },
	action: CustodyFormResult['action'],
	permission: 'bond.return' | 'bond.assign' | 'bond.mark_lost'
) {
	requireActiveUser(locals, url.pathname);
	if (permissionsUnavailable(locals.permissions)) {
		return custodyFailure(action, 500, 'No se pudieron cargar los permisos.');
	}
	if (!hasPermissionIn(locals.permissions, permission)) {
		return custodyFailure(action, 403, BOND_MESSAGES.permission);
	}
	if (!isUuid(params.id) || !isUuid(params.bondId)) {
		return custodyFailure(action, 404, BOND_MESSAGES.bondNotFound);
	}
	const { data: campaignId, error: loadError } = await getBondCampaignId(
		locals.supabase,
		params.bondId
	);
	if (loadError) {
		console.error('[bonds] custody scope check failed', {
			requestId: locals.requestId,
			error: loadError
		});
		return custodyFailure(action, 500, 'No se pudo cargar el bono. Volver a intentar.');
	}
	if (campaignId !== params.id) return custodyFailure(action, 404, BOND_MESSAGES.bondNotFound);
	return null;
}

const field = (formData: FormData, name: string) => {
	const v = formData.get(name);
	return typeof v === 'string' ? v.trim() : '';
};

const custodyCtx = (locals: App.Locals) => ({
	requestId: locals.requestId,
	permissions: locals.permissions
});

async function returnAction({ request, locals, params, url }: RequestEvent) {
	const denied = await custodyPreflight(locals, url, params, 'return', 'bond.return');
	if (denied) return denied;
	const formData = await request.formData();
	const notes = field(formData, 'notes');
	const fromCollectorId = field(formData, 'fromCollectorId');
	if (!isUuid(fromCollectorId)) {
		return custodyFailure(
			'return',
			400,
			'La custodia del bono está desactualizada. Recargar la página y volver a intentar.',
			{
				errors: {
					fromCollectorId: [
						'La custodia del bono está desactualizada. Recargar la página y volver a intentar.'
					]
				}
			}
		);
	}
	if (notes.length > 2000) {
		return custodyFailure('return', 400, 'Las notas admiten hasta 2000 caracteres.', {
			errors: { notes: ['Las notas admiten hasta 2000 caracteres.'] }
		});
	}
	let noteId: string;
	try {
		noteId = await returnBondsFromCollector(
			locals.supabase,
			{ campaignId: params.id, bondIds: [params.bondId], notes: notes || null, fromCollectorId },
			custodyCtx(locals)
		);
	} catch (err) {
		return custodyServiceFailure('return', err, { notes });
	}
	redirect(303, `/campaigns/${params.id}/deliveries/${noteId}`);
}

async function reassignAction({ request, locals, params, url }: RequestEvent) {
	const denied = await custodyPreflight(locals, url, params, 'reassign', 'bond.assign');
	if (denied) return denied;
	const formData = await request.formData();
	const collectorId = field(formData, 'collectorId');
	const fromCollectorId = field(formData, 'fromCollectorId');
	const notes = field(formData, 'notes');
	const values = { collectorId, notes };
	if (!isUuid(collectorId)) {
		return custodyFailure('reassign', 400, 'Elegir el cobrador nuevo.', {
			errors: { collectorId: ['Elegir el cobrador nuevo.'] },
			values
		});
	}
	if (!isUuid(fromCollectorId)) {
		return custodyFailure(
			'reassign',
			400,
			'La custodia del bono está desactualizada. Recargar la página y volver a intentar.',
			{
				errors: {
					fromCollectorId: [
						'La custodia del bono está desactualizada. Recargar la página y volver a intentar.'
					]
				},
				values
			}
		);
	}
	let noteId: string;
	try {
		noteId = await reassignBondsToCollector(
			locals.supabase,
			{
				campaignId: params.id,
				collectorId,
				bondIds: [params.bondId],
				notes: notes || null,
				fromCollectorId
			},
			custodyCtx(locals)
		);
	} catch (err) {
		return custodyServiceFailure('reassign', err, values);
	}
	redirect(303, `/campaigns/${params.id}/deliveries/${noteId}`);
}

async function markLostAction({ request, locals, params, url }: RequestEvent) {
	const denied = await custodyPreflight(locals, url, params, 'markLost', 'bond.mark_lost');
	if (denied) return denied;
	const formData = await request.formData();
	const values = {
		responsibleParty: field(formData, 'responsibleParty'),
		lostOn: field(formData, 'lostOn'),
		reason: field(formData, 'reason')
	};
	const errors: Record<string, string[]> = {};
	if (!values.responsibleParty) errors.responsibleParty = ['Indicar quién fue responsable.'];
	else if (values.responsibleParty.length > 200)
		errors.responsibleParty = ['Hasta 200 caracteres.'];
	if (!z.iso.date().safeParse(values.lostOn).success)
		errors.lostOn = ['Elegir una fecha real del calendario.'];
	if (!values.reason) errors.reason = ['El motivo es obligatorio.'];
	else if (values.reason.length > 2000) errors.reason = ['Hasta 2000 caracteres.'];
	if (Object.keys(errors).length) {
		return custodyFailure('markLost', 400, 'Corregir los campos marcados.', {
			errors,
			values
		});
	}
	try {
		await markBondLost(
			locals.supabase,
			{ campaignId: params.id, bondId: params.bondId, ...values },
			custodyCtx(locals)
		);
	} catch (err) {
		return custodyServiceFailure('markLost', err, values);
	}
	const result: CustodyFormResult = {
		form: 'custody',
		action: 'markLost',
		success: true,
		message: 'Bono marcado como extraviado.',
		errors: {}
	};
	return result;
}
