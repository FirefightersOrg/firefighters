import { describe, expect, it, vi, beforeEach } from 'vitest';
import { isHttpError, isRedirect } from '@sveltejs/kit';
import { defaultLandingPath, requireOwnCollector } from './own-collector';
import { mainNavItems } from '../../navigation';

const profile = { id: 'p-1', full_name: 'Cobradora' };

function locals(overrides: Record<string, unknown> = {}, rpcResult?: unknown) {
	const rpc = vi.fn().mockResolvedValue(rpcResult ?? { data: [], error: null });
	const value = {
		user: { id: 'u-1' },
		profile,
		permissions: ['campaign.view', 'bond.view_own'],
		requestId: 'req-1',
		supabase: { rpc },
		...overrides
	};
	return { locals: value as unknown as App.Locals, rpc };
}

async function failure(fn: () => Promise<unknown>) {
	try {
		await fn();
	} catch (err) {
		return err;
	}
	throw new Error('expected a failure');
}

describe('requireOwnCollector', () => {
	beforeEach(() => {
		vi.spyOn(console, 'error').mockImplementation(() => {});
	});

	it('resolves the collector from the session through portal_my_collector (no id argument)', async () => {
		const { locals: l, rpc } = locals(
			{},
			{ data: [{ id: 'c-1', display_name: 'Ana', status: 'active' }], error: null }
		);
		await expect(requireOwnCollector(l, '/portal')).resolves.toEqual({
			id: 'c-1',
			displayName: 'Ana',
			status: 'active'
		});
		expect(rpc).toHaveBeenCalledExactlyOnceWith('portal_my_collector');
	});

	it('returns null for a profile not linked to a collector', async () => {
		const { locals: l } = locals();
		await expect(requireOwnCollector(l, '/portal')).resolves.toBeNull();
	});

	it('redirects an anonymous visitor to the login page', async () => {
		const { locals: l, rpc } = locals({ user: null, profile: null });
		const err = await failure(() => requireOwnCollector(l, '/portal'));
		expect(isRedirect(err)).toBe(true);
		expect((err as { location: string }).location).toBe('/login?redirectTo=%2Fportal');
		expect(rpc).not.toHaveBeenCalled();
	});

	it('answers 403 without the own-scope permission, 500 when permissions did not load', async () => {
		const denied = await failure(() =>
			requireOwnCollector(locals({ permissions: ['campaign.view', 'bond.view'] }).locals, '/portal')
		);
		expect(isHttpError(denied) && denied.status).toBe(403);
		const unavailable = await failure(() =>
			requireOwnCollector(locals({ permissions: null }).locals, '/portal')
		);
		expect(isHttpError(unavailable) && unavailable.status).toBe(500);
	});

	it('answers 500 when the lookup fails', async () => {
		const { locals: l } = locals({}, { data: null, error: { message: 'boom' } });
		const err = await failure(() => requireOwnCollector(l, '/portal'));
		expect(isHttpError(err) && err.status).toBe(500);
	});

	it('checks the permission the screen asks for', async () => {
		const { locals: l } = locals({ permissions: ['bond.view_own'] });
		const err = await failure(() => requireOwnCollector(l, '/portal', 'sale.view_own'));
		expect(isHttpError(err) && err.status).toBe(403);
	});
});

describe('defaultLandingPath', () => {
	it('sends own-scope-only users to the portal and everyone else to the home page', () => {
		expect(defaultLandingPath(['campaign.view', 'bond.view_own'])).toBe('/portal');
		expect(defaultLandingPath(['campaign.view', 'bond.view'])).toBe('/');
		expect(defaultLandingPath(['bond.view', 'bond.view_own'])).toBe('/');
		expect(defaultLandingPath(null)).toBe('/');
		expect(defaultLandingPath([])).toBe('/');
	});
});

describe('main navigation for the portal', () => {
	it('shows only "Mi portal" plus campaigns to a collector, and no portal to staff', () => {
		expect(
			mainNavItems(['campaign.view', 'bond.view_own'], '/portal').map((i) => [i.label, i.current])
		).toEqual([
			['Campañas', false],
			['Mi portal', true]
		]);
		expect(mainNavItems(['campaign.view', 'bond.view'], '/campaigns').map((i) => i.label)).toEqual([
			'Campañas'
		]);
	});
});
