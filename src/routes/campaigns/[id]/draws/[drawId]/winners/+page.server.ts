import { error, fail } from '@sveltejs/kit';
import type { Actions, PageServerLoad } from './$types';
import {
	hasPermissionIn,
	permissionsUnavailable,
	requirePermissionIn
} from '$lib/server/auth/permissions';
import { requireCampaignViewer } from '$lib/server/campaigns/route-helpers';
import { getCampaignById } from '$lib/server/repositories/campaigns';
import { getDraw } from '$lib/server/repositories/draws';
import {
	getPrizeInDraw,
	listDrawPrizes,
	type PrizeListItem
} from '$lib/server/repositories/prizes';
import {
	annulPrize,
	annulPrizeSchema,
	createPrize,
	createPrizeSchema,
	deliverPrize,
	deliverPrizeSchema,
	loadWinningNumber,
	loadWinningNumberSchema,
	PrizeServiceError,
	resolvePrize,
	resolvePrizeSchema,
	updatePrize,
	updatePrizeSchema
} from '$lib/server/services/prizes';
import { PRIZE_REASON_MAX } from '$lib/domain/prizes';
import { campaignNumberingConfig } from '$lib/domain/campaigns';
import { formatCampaignNumber } from '$lib/domain/numbering';
import { DRAW_INELIGIBILITY_REASON_LABELS } from '$lib/domain/draw-eligibility';
import { z } from 'zod';

const uuid = z.guid();
const READ_PERMISSIONS = [
	'draw.view',
	'draw.create',
	'draw.update',
	'draw.generate_roster',
	'draw.freeze_roster',
	'draw.load_winner',
	'prize.resolve',
	'prize.deliver',
	'prize.annul'
] as const;
type FormName = 'create' | 'update' | 'loadWinner' | 'resolve' | 'deliver' | 'annul';

const field = (data: FormData, name: string) => {
	const value = data.get(name);
	return typeof value === 'string' ? value.trim() : '';
};
const nullable = (value: string) => value || null;
const ctx = (locals: App.Locals) => ({
	requestId: locals.requestId ?? null,
	permissions: locals.permissions ?? null
});
const failure = (cause: unknown, form: FormName, values: Record<string, string> = {}) => {
	const service = cause instanceof PrizeServiceError ? cause : null;
	return fail(service?.status ?? 500, {
		form,
		values,
		errors: {},
		message: service?.message ?? 'Could not change the prize. Please try again.'
	});
};
const invalid = (form: FormName, values: Record<string, string>) =>
	fail(400, {
		form,
		values,
		errors: {},
		message: 'Please correct the highlighted fields.'
	});
const guard = (
	locals: App.Locals,
	permission: Parameters<typeof hasPermissionIn>[1],
	form: FormName
) => {
	if (permissionsUnavailable(locals.permissions))
		return fail(500, { form, errors: {}, message: 'Could not load permissions.' });
	if (!hasPermissionIn(locals.permissions, permission))
		return fail(403, {
			form,
			errors: {},
			message: 'You do not have permission to perform this action.'
		});
	return null;
};
async function scopedPrize(
	locals: App.Locals,
	params: { id: string; drawId: string },
	prizeId: string,
	form: FormName
) {
	if (
		!uuid.safeParse(params.id).success ||
		!uuid.safeParse(params.drawId).success ||
		!uuid.safeParse(prizeId).success
	)
		return { failure: fail(404, { form, errors: {}, message: 'Prize not found.' }) };
	const draw = await getDraw(locals.supabase, params.id, params.drawId);
	if (draw.error) return { failure: failure(draw.error, form) };
	if (!draw.data) return { failure: fail(404, { form, errors: {}, message: 'Draw not found.' }) };
	const prize = await getPrizeInDraw(locals.supabase, params.drawId, prizeId);
	if (prize.error) return { failure: failure(prize.error, form) };
	if (!prize.data) return { failure: fail(404, { form, errors: {}, message: 'Prize not found.' }) };
	return { draw: draw.data, prize: prize.data };
}
async function scopedDraw(
	locals: App.Locals,
	params: { id: string; drawId: string },
	form: FormName
) {
	if (!uuid.safeParse(params.id).success || !uuid.safeParse(params.drawId).success)
		return { failure: fail(404, { form, errors: {}, message: 'Draw not found.' }) };
	const draw = await getDraw(locals.supabase, params.id, params.drawId);
	if (draw.error) return { failure: failure(draw.error, form) };
	if (!draw.data) return { failure: fail(404, { form, errors: {}, message: 'Draw not found.' }) };
	return { draw: draw.data };
}

const presentPrize = (
	prize: PrizeListItem,
	config: ReturnType<typeof campaignNumberingConfig>
) => ({
	...prize,
	winningNumber: prize.winningNumber
		? {
				...prize.winningNumber,
				formattedNumber: formatCampaignNumber(prize.winningNumber.numberValue, config),
				reasonLabel:
					prize.winningNumber.resultStatus === 'no_match'
						? 'Number not in the roster'
						: prize.winningNumber.ineligibilityReason
							? (DRAW_INELIGIBILITY_REASON_LABELS[
									prize.winningNumber
										.ineligibilityReason as keyof typeof DRAW_INELIGIBILITY_REASON_LABELS
								] ?? prize.winningNumber.ineligibilityReason)
							: null
			}
		: null
});

export const load: PageServerLoad = async ({ locals, params, url }) => {
	if (permissionsUnavailable(locals.permissions))
		error(500, { message: 'Could not load permissions.' });
	requireCampaignViewer(locals, url);
	if (!READ_PERMISSIONS.some((permission) => hasPermissionIn(locals.permissions, permission)))
		requirePermissionIn(locals.permissions, 'draw.view');
	if (!uuid.safeParse(params.drawId).success) error(404, { message: 'Draw not found.' });
	const [campaign, draw] = await Promise.all([
		getCampaignById(locals.supabase, params.id),
		getDraw(locals.supabase, params.id, params.drawId)
	]);
	if (campaign.error || draw.error) error(500, { message: 'Could not load prizes.' });
	if (!campaign.data) error(404, { message: 'Campaign not found.' });
	if (!draw.data) error(404, { message: 'Draw not found.' });
	const prizes = await listDrawPrizes(locals.supabase, draw.data.id);
	if (prizes.error) error(500, { message: 'Could not load prizes.' });
	const configurable = !['completed', 'closed', 'annulled'].includes(draw.data.status);
	const config = campaignNumberingConfig(campaign.data);
	return {
		campaign: campaign.data,
		draw: draw.data,
		prizes: (prizes.data ?? []).map((prize) => presentPrize(prize, config)),
		reasonMax: PRIZE_REASON_MAX,
		can: {
			create: configurable && hasPermissionIn(locals.permissions, 'draw.update'),
			edit: configurable && hasPermissionIn(locals.permissions, 'draw.update'),
			loadWinner:
				draw.data.status === 'roster_frozen' &&
				hasPermissionIn(locals.permissions, 'draw.load_winner'),
			resolve: hasPermissionIn(locals.permissions, 'prize.resolve'),
			deliver: hasPermissionIn(locals.permissions, 'prize.deliver'),
			annul: hasPermissionIn(locals.permissions, 'prize.annul')
		}
	};
};

export const actions: Actions = {
	create: async ({ request, locals, params, url }) => {
		const denied = guard(locals, 'draw.update', 'create');
		if (denied) return denied;
		requireCampaignViewer(locals, url);
		const scoped = await scopedDraw(locals, params, 'create');
		if ('failure' in scoped) return scoped.failure;
		const data = await request.formData();
		const values = {
			name: field(data, 'name'),
			description: field(data, 'description'),
			position: field(data, 'position'),
			excludesFromConsolation: data.get('excludesFromConsolation') === 'on' ? 'true' : 'false'
		};
		const input = {
			drawId: params.drawId,
			name: values.name,
			description: nullable(values.description),
			position: Number(values.position),
			excludesFromConsolation: values.excludesFromConsolation === 'true'
		};
		if (!createPrizeSchema.safeParse(input).success) return invalid('create', values);
		try {
			await createPrize(locals.supabase, input, ctx(locals));
			return { form: 'create', success: true, errors: {}, message: 'Prize created.' };
		} catch (cause) {
			return failure(cause, 'create', values);
		}
	},
	update: async ({ request, locals, params, url }) => {
		const denied = guard(locals, 'draw.update', 'update');
		if (denied) return denied;
		requireCampaignViewer(locals, url);
		const data = await request.formData();
		const prizeId = field(data, 'prizeId');
		const scoped = await scopedPrize(locals, params, prizeId, 'update');
		if ('failure' in scoped) return scoped.failure;
		const values = {
			prizeId,
			name: field(data, 'name'),
			description: field(data, 'description'),
			position: field(data, 'position'),
			excludesFromConsolation: data.get('excludesFromConsolation') === 'on' ? 'true' : 'false'
		};
		const input = {
			prizeId,
			name: values.name,
			description: nullable(values.description),
			position: Number(values.position),
			excludesFromConsolation: values.excludesFromConsolation === 'true'
		};
		if (!updatePrizeSchema.safeParse(input).success) return invalid('update', values);
		try {
			await updatePrize(locals.supabase, input, ctx(locals));
			return { form: 'update', success: true, errors: {}, message: 'Prize updated.' };
		} catch (cause) {
			return failure(cause, 'update', values);
		}
	},
	loadWinner: async ({ request, locals, params, url }) => {
		const denied = guard(locals, 'draw.load_winner', 'loadWinner');
		if (denied) return denied;
		requireCampaignViewer(locals, url);
		const data = await request.formData();
		const prizeId = field(data, 'prizeId');
		const scoped = await scopedPrize(locals, params, prizeId, 'loadWinner');
		if ('failure' in scoped) return scoped.failure;
		const values = {
			prizeId,
			numberValue: field(data, 'numberValue'),
			notes: field(data, 'notes')
		};
		const input = {
			prizeId,
			numberValue: Number(values.numberValue),
			notes: nullable(values.notes)
		};
		if (!loadWinningNumberSchema.safeParse(input).success) return invalid('loadWinner', values);
		try {
			await loadWinningNumber(locals.supabase, input, ctx(locals));
			const refreshed = await getPrizeInDraw(locals.supabase, params.drawId, prizeId);
			if (refreshed.error || !refreshed.data)
				return failure(refreshed.error ?? new Error('Missing loaded result'), 'loadWinner', values);
			const campaign = await getCampaignById(locals.supabase, params.id);
			if (campaign.error || !campaign.data)
				return failure(campaign.error ?? new Error('Missing campaign'), 'loadWinner', values);
			return {
				form: 'loadWinner',
				success: true,
				errors: {},
				message: 'Winning number loaded.',
				result: presentPrize(refreshed.data, campaignNumberingConfig(campaign.data)).winningNumber
			};
		} catch (cause) {
			return failure(cause, 'loadWinner', values);
		}
	},
	resolve: async ({ request, locals, params, url }) => {
		const denied = guard(locals, 'prize.resolve', 'resolve');
		if (denied) return denied;
		requireCampaignViewer(locals, url);
		const data = await request.formData();
		const prizeId = field(data, 'prizeId');
		const scoped = await scopedPrize(locals, params, prizeId, 'resolve');
		if ('failure' in scoped) return scoped.failure;
		const values = { prizeId, decision: field(data, 'decision'), notes: field(data, 'notes') };
		const input = { prizeId, decision: values.decision, notes: nullable(values.notes) };
		const parsed = resolvePrizeSchema.safeParse(input);
		if (!parsed.success) return invalid('resolve', values);
		try {
			await resolvePrize(locals.supabase, parsed.data, ctx(locals));
			return { form: 'resolve', success: true, errors: {}, message: 'Prize resolved.' };
		} catch (cause) {
			return failure(cause, 'resolve', values);
		}
	},
	deliver: async ({ request, locals, params, url }) => {
		const denied = guard(locals, 'prize.deliver', 'deliver');
		if (denied) return denied;
		requireCampaignViewer(locals, url);
		const data = await request.formData();
		const prizeId = field(data, 'prizeId');
		const scoped = await scopedPrize(locals, params, prizeId, 'deliver');
		if ('failure' in scoped) return scoped.failure;
		const values = { prizeId, notes: field(data, 'notes') };
		if (!deliverPrizeSchema.safeParse(values).success) return invalid('deliver', values);
		try {
			await deliverPrize(locals.supabase, values, ctx(locals));
			return { form: 'deliver', success: true, errors: {}, message: 'Prize delivery recorded.' };
		} catch (cause) {
			return failure(cause, 'deliver', values);
		}
	},
	annul: async ({ request, locals, params, url }) => {
		const denied = guard(locals, 'prize.annul', 'annul');
		if (denied) return denied;
		requireCampaignViewer(locals, url);
		const data = await request.formData();
		const prizeId = field(data, 'prizeId');
		const scoped = await scopedPrize(locals, params, prizeId, 'annul');
		if ('failure' in scoped) return scoped.failure;
		const values = { prizeId, reason: field(data, 'reason') };
		if (!annulPrizeSchema.safeParse(values).success) return invalid('annul', values);
		try {
			await annulPrize(locals.supabase, values, ctx(locals));
			return { form: 'annul', success: true, errors: {}, message: 'Prize annulled.' };
		} catch (cause) {
			return failure(cause, 'annul', values);
		}
	}
};
