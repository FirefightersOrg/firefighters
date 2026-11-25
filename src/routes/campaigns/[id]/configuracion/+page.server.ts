/**
 * /campaigns/[id]/configuracion (redesign): the campaign's data, rules and their forms, moved off the
 * daily workbench. Same load (without the dashboard queries) and the same audited actions as the campaign
 * page (`?/update`, `?/rules`, `?/transition`), so permissions, validation and versions are identical.
 */
import type { PageServerLoad } from './$types';
import { actions as campaignActions, _loadCampaignPage } from '../+page.server';

export const load: PageServerLoad = (event) => _loadCampaignPage(event, { dashboard: false });
export const actions = campaignActions;
