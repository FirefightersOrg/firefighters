import { error } from '@sveltejs/kit';
import { z } from 'zod';
import type { Actions, PageServerLoad } from './$types';
import {
	availableCampaignTransitions,
	canEditCampaignDates,
	canEditCampaignName,
	canEditCampaignRules,
	canLoadBonds,
	CAMPAIGN_TRANSITION_PERMISSIONS,
	keepTimestampIfSameDay
} from '$lib/domain/campaigns';
import {
	AT_RISK_LIMIT,
	summarizeBalances,
	summarizeBonds,
	summarizeCash,
	summarizeCommissions,
	summarizeRevenue
} from '$lib/domain/dashboard';
import { todayInBuenosAires, type ReportFilters } from '$lib/domain/reports';
import type { FinancialFilters } from '$lib/domain/financial-reports';
import { hasPermissionIn } from '$lib/server/auth/permissions';
import { getAtRiskBonds, getNextDraw } from '$lib/server/repositories/dashboard';
import {
	getCollectorAccounts,
	getPaymentsByDate,
	getSettlementsByCollector
} from '$lib/server/repositories/financial-reports';
import { getBondsByStatus, getInstallmentsReport } from '$lib/server/repositories/reports';
import type { PermissionCode } from '$lib/server/auth/permission-codes';
import {
	campaignFormFailure,
	campaignFormSuccess,
	campaignServiceFailure,
	campaignValidationFailure,
	checkCampaignActionPermission,
	requireCampaignViewer
} from '$lib/server/campaigns/route-helpers';
import { campaignHasBonds } from '$lib/server/repositories/bonds';
import { getCampaignById } from '$lib/server/repositories/campaigns';
import {
	CAMPAIGN_MESSAGES,
	transitionCampaign,
	updateCampaignGeneral,
	updateCampaignRules
} from '$lib/server/services/campaigns';
import {
	CAMPAIGN_GENERAL_UPDATE_FIELDS,
	CAMPAIGN_RULES_UPDATE_FIELDS,
	CAMPAIGN_TRANSITION_FIELDS,
	campaignGeneralSchema,
	campaignRulesUpdateSchema,
	campaignTransitionSchema,
	readFormFields
} from '$lib/schemas/campaign';

/** Built per call: `month` is not used by the dashboard, but must not go stale in a long-lived server. */
const noReportFilters = (): ReportFilters => ({
	collectorId: null,
	kind: null,
	commercialStatus: null,
	financialStatus: null,
	month: todayInBuenosAires().slice(0, 7),
	from: null,
	to: null
});

const NO_FINANCIAL_FILTERS: FinancialFilters = {
	collectorId: null,
	method: null,
	settlementStatus: null,
	from: null,
	to: null,
	drawId: null,
	eligibility: null,
	prizeStatus: null
};

const isUuid = (value: string) => z.guid().safeParse(value).success;

const TRANSITION_SUCCESS = {
	active: 'Campaña activada. Sus reglas quedaron congeladas.',
	closing: 'La campaña pasó a cierre.',
	closed: 'Campaña cerrada.',
	annulled: 'Campaña anulada.'
} as const;

export const load: PageServerLoad = async ({ locals, params, url }) => {
	requireCampaignViewer(locals, url);
	if (!isUuid(params.id)) {
		error(404, { message: CAMPAIGN_MESSAGES.notFound });
	}

	const [result, bondsResult] = await Promise.all([
		getCampaignById(locals.supabase, params.id),
		campaignHasBonds(locals.supabase, params.id)
	]);
	if (result.error) {
		console.error('[campaigns] load failed', {
			requestId: locals.requestId,
			campaignId: params.id,
			error: result.error
		});
		error(500, { message: 'No se pudo cargar la campaña. Volver a intentar.' });
	}
	if (!result.data) {
		error(404, { message: CAMPAIGN_MESSAGES.notFound });
	}
	// UI hint only (the database rejects a rules change once a bond exists): if the lookup fails
	// the page still renders, as if there were no bonds.
	if (bondsResult.error) {
		console.error('[campaigns] bond lookup failed', {
			requestId: locals.requestId,
			campaignId: params.id,
			error: bondsResult.error
		});
	}

	const campaign = result.data;
	const dashboard = await loadDashboard(locals, campaign.id);
	const hasBonds = bondsResult.data ?? false;
	const permissions = locals.permissions ?? [];
	const canUpdate = hasPermissionIn(permissions, 'campaign.update');

	// UI hints only: the SQL functions enforce permissions and edit windows.
	return {
		campaign,
		dashboard,
		/** Once a campaign has a bond (annulled ones included) its rules are frozen, even in draft. */
		hasBonds,
		can: {
			editName: canUpdate && canEditCampaignName(campaign.status),
			editDates: canUpdate && canEditCampaignDates(campaign.status),
			editRules:
				hasPermissionIn(permissions, 'campaign.update_rules') &&
				canEditCampaignRules(campaign.status) &&
				!hasBonds,
			transitions: availableCampaignTransitions(campaign.status, permissions),
			// Redesign workbench: the day's actions, only while the campaign is active.
			registerSale: campaign.status === 'active' && hasPermissionIn(permissions, 'sale.create'),
			deliverBonds: campaign.status === 'active' && hasPermissionIn(permissions, 'bond.assign'),
			openSettlement:
				campaign.status === 'active' && hasPermissionIn(permissions, 'settlement.create'),
			viewCommissions: hasPermissionIn(permissions, 'commission.view'),
			exportBackups: hasPermissionIn(permissions, 'report.export'),
			viewReports: hasPermissionIn(permissions, 'report.view_operational'),
			viewAudit: hasPermissionIn(permissions, 'audit.view'),
			viewBonds: hasPermissionIn(permissions, 'bond.view'),
			loadBonds: hasPermissionIn(permissions, 'bond.create') && canLoadBonds(campaign.status),
			// Reading needs X.view or X.manage (same rule as the RLS of collectors / buyers).
			viewCollectors:
				hasPermissionIn(permissions, 'collector.view') ||
				hasPermissionIn(permissions, 'collector.manage'),
			viewBuyers:
				hasPermissionIn(permissions, 'buyer.view') || hasPermissionIn(permissions, 'buyer.manage'),
			viewDeliveries:
				hasPermissionIn(permissions, 'bond.view') || hasPermissionIn(permissions, 'bond.assign'),
			viewSales:
				hasPermissionIn(permissions, 'sale.view') ||
				hasPermissionIn(permissions, 'sale.create') ||
				hasPermissionIn(permissions, 'bond.view'),
			viewSettlements: (
				[
					'settlement.view',
					'settlement.create',
					'settlement.update_open',
					'settlement.close',
					'settlement.correct'
				] as PermissionCode[]
			).some((permission) => hasPermissionIn(permissions, permission)),
			viewDraws: (
				[
					'draw.view',
					'draw.create',
					'draw.update',
					'draw.generate_roster',
					'draw.freeze_roster',
					'draw.load_winner'
				] as PermissionCode[]
			).some((permission) => hasPermissionIn(permissions, permission))
		}
	};
};

/**
 * Dashboard figures (SAN-85). The operational group (bonds, revenue, next draw and at-risk bonds)
 * needs `report.view_operational`; the financial group (cash, commissions, balances) needs
 * `report.view_financial`. A group the person may not see is null. The SQL functions check both
 * permissions again and aggregate server-side, so no row cap hides data.
 *
 * A failing group never takes the campaign page down (transitions, edits and links must keep
 * working): it is reported as `{ error: true }` and the page shows an alert in its place.
 */
type DashboardGroup<T> = T | { error: true } | null;

async function loadDashboard(locals: App.Locals, campaignId: string) {
	const permissions = locals.permissions ?? [];
	const supabase = locals.supabase;
	const fail = (what: string, cause: unknown): never => {
		console.error('[campaigns] dashboard load failed', {
			requestId: locals.requestId,
			campaignId,
			what,
			error: cause
		});
		throw new DashboardGroupError();
	};
	const group = async <T>(allowed: boolean, load: () => Promise<T>): Promise<DashboardGroup<T>> => {
		if (!allowed) return null;
		try {
			return await load();
		} catch (err) {
			if (!(err instanceof DashboardGroupError)) {
				console.error('[campaigns] dashboard load failed', {
					requestId: locals.requestId,
					campaignId,
					error: err
				});
			}
			return { error: true };
		}
	};

	const [operational, financial] = await Promise.all([
		group(hasPermissionIn(permissions, 'report.view_operational'), async () => {
			const filters = noReportFilters();
			const [bonds, installments, nextDraw] = await Promise.all([
				getBondsByStatus(supabase, campaignId, filters),
				getInstallmentsReport(supabase, campaignId, filters),
				getNextDraw(supabase, campaignId)
			]);
			if (bonds.error) fail('bonds', bonds.error);
			if (installments.error) fail('installments', installments.error);
			if (nextDraw.error) fail('next draw', nextDraw.error);
			const draw = nextDraw.data ?? null;
			const atRisk = draw
				? await getAtRiskBonds(supabase, campaignId, draw.id, AT_RISK_LIMIT)
				: null;
			if (atRisk?.error) fail('at-risk bonds', atRisk.error);
			return {
				bonds: summarizeBonds(bonds.data ?? []),
				revenue: summarizeRevenue(installments.data ?? []),
				nextDraw: draw,
				atRisk: atRisk?.data ?? []
			};
		}),
		group(hasPermissionIn(permissions, 'report.view_financial'), async () => {
			const [payments, settlements, accounts] = await Promise.all([
				getPaymentsByDate(supabase, campaignId, NO_FINANCIAL_FILTERS),
				getSettlementsByCollector(supabase, campaignId, NO_FINANCIAL_FILTERS),
				getCollectorAccounts(supabase, campaignId, NO_FINANCIAL_FILTERS)
			]);
			if (payments.error) fail('payments', payments.error);
			if (settlements.error) fail('settlements', settlements.error);
			if (accounts.error) fail('collector accounts', accounts.error);
			return {
				cash: summarizeCash(payments.data ?? []),
				commissions: summarizeCommissions(settlements.data ?? []),
				balances: summarizeBalances(accounts.data ?? [])
			};
		})
	]);

	return { operational, financial };
}

class DashboardGroupError extends Error {}

export const actions: Actions = {
	update: async ({ request, locals, params, url }) => {
		const denied = checkCampaignActionPermission(locals, url, 'general', 'campaign.update');
		if (denied) return denied;
		if (!isUuid(params.id)) return campaignFormFailure('general', 404, CAMPAIGN_MESSAGES.notFound);

		const values = readFormFields(await request.formData(), CAMPAIGN_GENERAL_UPDATE_FIELDS);
		const parsed = campaignGeneralSchema.safeParse(values);
		if (!parsed.success) return campaignValidationFailure('general', parsed.error, values);

		// The form edits calendar days: keep a stored timestamp whose day did not change. If the
		// lookup fails, the submitted values are used as is (the SQL function still validates).
		const current = (await getCampaignById(locals.supabase, params.id)).data;
		const input = {
			...parsed.data,
			startsAt: keepTimestampIfSameDay(parsed.data.startsAt, current?.startsAt ?? null),
			endsAt: keepTimestampIfSameDay(parsed.data.endsAt, current?.endsAt ?? null)
		};

		try {
			const changed = await updateCampaignGeneral(locals.supabase, params.id, input, {
				requestId: locals.requestId
			});
			return campaignFormSuccess(
				'general',
				changed ? 'Cambios guardados.' : 'No hay cambios para guardar.'
			);
		} catch (err) {
			return campaignServiceFailure('general', err, values);
		}
	},

	rules: async ({ request, locals, params, url }) => {
		const denied = checkCampaignActionPermission(locals, url, 'rules', 'campaign.update_rules');
		if (denied) return denied;
		if (!isUuid(params.id)) return campaignFormFailure('rules', 404, CAMPAIGN_MESSAGES.notFound);

		// The rules form must be explicitly confirmed (`confirmRulesChange=yes`): every saved change
		// is audited (old and new values) by `campaign_update_rules`, which also enforces
		// `campaign.update_rules` and the draft-only edit window. It also carries the version it was
		// loaded at (`expectedUpdatedAt`): a stale form is rejected with a 409, nothing written.
		const values = readFormFields(await request.formData(), CAMPAIGN_RULES_UPDATE_FIELDS);
		const parsed = campaignRulesUpdateSchema.safeParse(values);
		if (!parsed.success) return campaignValidationFailure('rules', parsed.error, values);

		try {
			const changed = await updateCampaignRules(locals.supabase, params.id, parsed.data, {
				requestId: locals.requestId
			});
			return campaignFormSuccess(
				'rules',
				changed ? 'Reglas guardadas.' : 'No hay cambios para guardar.'
			);
		} catch (err) {
			return campaignServiceFailure('rules', err, values);
		}
	},

	transition: async ({ request, locals, params, url }) => {
		const values = readFormFields(await request.formData(), CAMPAIGN_TRANSITION_FIELDS);
		const parsed = campaignTransitionSchema.safeParse(values);
		// The permission depends on the target status. An unparseable target still requires a
		// signed-in campaign viewer before the validation error is returned.
		const permission = parsed.success
			? CAMPAIGN_TRANSITION_PERMISSIONS[parsed.data.toStatus]
			: 'campaign.view';
		const denied = checkCampaignActionPermission(locals, url, 'transition', permission);
		if (denied) return denied;
		if (!parsed.success) return campaignValidationFailure('transition', parsed.error, values);
		if (!isUuid(params.id)) {
			return campaignFormFailure('transition', 404, CAMPAIGN_MESSAGES.notFound);
		}

		try {
			await transitionCampaign(locals.supabase, params.id, parsed.data, {
				requestId: locals.requestId
			});
		} catch (err) {
			return campaignServiceFailure('transition', err, values);
		}
		return campaignFormSuccess('transition', TRANSITION_SUCCESS[parsed.data.toStatus]);
	}
};
