/**
 * Accessibility matrix (SAN-166). The full matrix is light/dark x desktop (1280px) / phone (375px) on
 * every route. It is slow, so the default run uses a reduced one:
 * - every route: light + desktop (axe, no sideways scroll);
 * - the CORE routes of each spec (one per kind of screen: dense list, form, detail, print view,
 *   report, workflow stage): the whole matrix, so dark mode and the phone layout are still checked
 *   on every kind of screen;
 * - one open Dialog per area and the winning-number result: light only.
 * `E2E_FULL=1` (`pnpm test:e2e:full`) restores the full matrix everywhere. It is required before
 * merging, because a dark-only or phone-only regression on a non-core route only shows there.
 */
export const FULL = process.env.E2E_FULL === '1';
export const SCHEMES = ['light', 'dark'] as const;
export type Scheme = (typeof SCHEMES)[number];

/** Whether the cell (scheme, desktop or phone) of a route runs in this run. */
export const runCell = (core: boolean, scheme: Scheme, phone: boolean) =>
	FULL || core || (scheme === 'light' && !phone);

/** Schemes the single-screen checks (dialogs, validation result) run in. */
export const SCHEMES_FOR_DIALOGS: readonly Scheme[] = FULL ? SCHEMES : ['light'];
