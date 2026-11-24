import { error } from '@sveltejs/kit';
import { z } from 'zod';
import type { Actions, PageServerLoad, RequestEvent } from './$types';
import { canManageCommissionRules, todayInArgentina } from '$lib/domain/commissions';
import { hasPermissionIn, requirePermissionIn } from '$lib/server/auth/permissions';
import { requireCampaignViewer } from '$lib/server/campaigns/route-helpers';
import {
	checkCommissionRuleManager,
	commissionRuleFormFailure,
	commissionRuleFormSuccess,
	commissionRuleServiceFailure,
	commissionRuleValidationFailure,
	type CommissionRuleFormName
} from '$lib/server/commissions/route-helpers';
import { getCampaignById } from '$lib/server/repositories/campaigns';
import {
	getCommissionRuleById,
	listCollectorCommissionRules,
	listGeneralCommissionRules
} from '$lib/server/repositories/commission-rules';
import { listActiveCollectorOptions } from '$lib/server/repositories/parties';
import { CAMPAIGN_MESSAGES } from '$lib/server/services/campaigns';
import {
	annulCommissionRule,
	COMMISSION_RULE_MESSAGES,
	createCommissionRule,
	updateCommissionRule
} from '$lib/server/services/commission-rules';
import { readFormFields } from '$lib/schemas/campaign';
import {
	COMMISSION_RULE_ANNUL_FIELDS,
	COMMISSION_RULE_FIELDS,
	COMMISSION_RULE_UPDATE_FIELDS,
	commissionRuleAnnulSchema,
	commissionRuleSchema,
	commissionRuleUpdateSchema
} from '$lib/schemas/commission-rule';

const isUuid = (value: string) => z.guid().safeParse(value).success;

/**
 * /campaigns/[id]/commissions: general commission rules of a campaign.
 * The /campaigns layout already requires an active user with `campaign.view`; this page also
 * requires `commission.view` (else 403). Actions require `commission.rule_manage`, which the
 * `commission_rule_*` SQL functions check again together with the campaign status.
 */
export const load: PageServerLoad = async ({ locals, params, url }) => {
	requireCampaignViewer(locals, url);
	requirePermissionIn(locals.permissions, 'commission.view');
	if (!isUuid(params.id)) {
		error(404, { message: CAMPAIGN_MESSAGES.notFound });
	}

	const [campaignResult, rulesResult, specialResult, collectorsResult] = await Promise.all([
		getCampaignById(locals.supabase, params.id),
		listGeneralCommissionRules(locals.supabase, params.id),
		listCollectorCommissionRules(locals.supabase, params.id),
		listActiveCollectorOptions(locals.supabase)
	]);
	if (campaignResult.error || rulesResult.error || specialResult.error || collectorsResult.error) {
		console.error('[commission-rules] load failed', {
			requestId: locals.requestId,
			campaignId: params.id,
			error:
				campaignResult.error ?? rulesResult.error ?? specialResult.error ?? collectorsResult.error
		});
		error(500, { message: 'Could not load the commission rules. Please try again.' });
	}
	if (!campaignResult.data) {
		error(404, { message: CAMPAIGN_MESSAGES.notFound });
	}

	const campaign = campaignResult.data;
	const rules = rulesResult.data ?? [];
	const canManage =
		hasPermissionIn(locals.permissions, 'commission.rule_manage') &&
		canManageCommissionRules(campaign.status);

	// `?edit=<rule id>` opens the edit form for an active rule (works without JavaScript).
	const editId = url.searchParams.get('edit');
	const editRule =
		canManage && editId
			? ([...rules, ...(specialResult.data ?? [])].find(
					(r) => r.id === editId && r.status === 'active'
				) ?? null)
			: null;

	const collectors = collectorsResult.data ?? [];
	const collectorNames = new Map(collectors.map((c) => [c.id, c.displayName]));
	return {
		campaign,
		rules,
		specialRules: (specialResult.data ?? []).map((rule) => ({
			...rule,
			collectorName: collectorNames.get(rule.appliesToCollectorId ?? '') ?? 'Cobrador'
		})),
		collectors: canManage ? collectors : [],
		today: todayInArgentina(),
		editRuleId: editRule?.id ?? null,
		editNotFound: canManage && !!editId && !editRule,
		can: { manage: canManage }
	};
};

/** Shared prelude of the three actions: permission, campaign id and campaign. */
async function prepare(event: RequestEvent, form: CommissionRuleFormName) {
	const denied = checkCommissionRuleManager(event.locals, event.url, form);
	if (denied) return { failure: denied } as const;
	if (!isUuid(event.params.id)) {
		return { failure: commissionRuleFormFailure(form, 404, CAMPAIGN_MESSAGES.notFound) } as const;
	}
	const campaign = await getCampaignById(event.locals.supabase, event.params.id);
	if (campaign.error) {
		console.error('[commission-rules] campaign lookup failed', {
			requestId: event.locals.requestId,
			error: campaign.error
		});
		return {
			failure: commissionRuleFormFailure(form, 500, COMMISSION_RULE_MESSAGES.internal)
		} as const;
	}
	if (!campaign.data) {
		return { failure: commissionRuleFormFailure(form, 404, CAMPAIGN_MESSAGES.notFound) } as const;
	}
	return { campaign: campaign.data } as const;
}

/** The rule must exist, be visible and belong to this page's campaign. */
async function checkRuleInCampaign(
	event: RequestEvent,
	form: CommissionRuleFormName,
	ruleId: string,
	values: Record<string, string>
) {
	const rule = await getCommissionRuleById(event.locals.supabase, ruleId);
	if (rule.error) {
		console.error('[commission-rules] rule lookup failed', {
			requestId: event.locals.requestId,
			error: rule.error
		});
		return commissionRuleFormFailure(form, 500, COMMISSION_RULE_MESSAGES.internal, { ruleId });
	}
	if (!rule.data || rule.data.campaignId !== event.params.id) {
		return commissionRuleFormFailure(form, 404, COMMISSION_RULE_MESSAGES.ruleNotFound, {
			ruleId,
			values
		});
	}
	return null;
}

export const actions: Actions = {
	create: async (event) => {
		const prepared = await prepare(event, 'create');
		if ('failure' in prepared) return prepared.failure;

		const formData = await event.request.formData();
		const values = readFormFields(formData, COMMISSION_RULE_FIELDS);
		const collectorField = formData.get('appliesToCollectorId');
		const appliesToCollectorId = typeof collectorField === 'string' ? collectorField.trim() : '';
		if (appliesToCollectorId && !isUuid(appliesToCollectorId)) {
			return commissionRuleFormFailure('create', 400, 'Choose a valid collector.', {
				values: { ...values, appliesToCollectorId },
				errors: { appliesToCollectorId: ['Choose a valid collector.'] }
			});
		}
		const parsed = commissionRuleSchema(prepared.campaign.installmentCount).safeParse(values);
		if (!parsed.success) return commissionRuleValidationFailure('create', parsed.error, values);

		try {
			const id = await createCommissionRule(
				event.locals.supabase,
				prepared.campaign.id,
				parsed.data,
				{ requestId: event.locals.requestId },
				appliesToCollectorId || null
			);
			return commissionRuleFormSuccess('create', 'Rule added.', id);
		} catch (err) {
			return commissionRuleServiceFailure('create', err, values);
		}
	},

	update: async (event) => {
		const prepared = await prepare(event, 'update');
		if ('failure' in prepared) return prepared.failure;

		const values = readFormFields(await event.request.formData(), COMMISSION_RULE_UPDATE_FIELDS);
		const ruleId = isUuid(values.ruleId) ? values.ruleId : undefined;
		const parsed = commissionRuleUpdateSchema(prepared.campaign.installmentCount).safeParse(values);
		if (!parsed.success) {
			return commissionRuleValidationFailure('update', parsed.error, values, ruleId);
		}

		const notInCampaign = await checkRuleInCampaign(event, 'update', parsed.data.ruleId, values);
		if (notInCampaign) return notInCampaign;

		try {
			const changed = await updateCommissionRule(event.locals.supabase, parsed.data, {
				requestId: event.locals.requestId
			});
			return commissionRuleFormSuccess(
				'update',
				changed ? 'Rule saved.' : 'No changes to save.',
				parsed.data.ruleId
			);
		} catch (err) {
			return commissionRuleServiceFailure('update', err, values, parsed.data.ruleId);
		}
	},

	annul: async (event) => {
		const prepared = await prepare(event, 'annul');
		if ('failure' in prepared) return prepared.failure;

		const values = readFormFields(await event.request.formData(), COMMISSION_RULE_ANNUL_FIELDS);
		const ruleId = isUuid(values.ruleId) ? values.ruleId : undefined;
		const parsed = commissionRuleAnnulSchema.safeParse(values);
		if (!parsed.success) {
			return commissionRuleValidationFailure('annul', parsed.error, values, ruleId);
		}

		const notInCampaign = await checkRuleInCampaign(event, 'annul', parsed.data.ruleId, values);
		if (notInCampaign) return notInCampaign;

		try {
			await annulCommissionRule(event.locals.supabase, parsed.data, {
				requestId: event.locals.requestId
			});
			return commissionRuleFormSuccess('annul', 'Rule annulled.', parsed.data.ruleId);
		} catch (err) {
			return commissionRuleServiceFailure('annul', err, values, parsed.data.ruleId);
		}
	}
};
