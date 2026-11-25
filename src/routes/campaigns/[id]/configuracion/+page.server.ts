/**
 * /campaigns/[id]/configuracion (redesign): the campaign's data, rules and their forms, moved off the
 * daily workbench. Same load and the same audited actions as the campaign page (`?/update`, `?/rules`,
 * `?/transition`), so permissions, validation and versions are identical.
 */
import { actions as campaignActions, load as campaignLoad } from '../+page.server';

export const load = campaignLoad;
export const actions = campaignActions;
