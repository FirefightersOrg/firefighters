import { describe, expect, it, vi } from 'vitest';
import { mapOverdueWarningRpcError, setOverdueWarningThreshold } from './overdue-warning';

const CAMPAIGN = 'a0000000-0000-4000-8000-000000000001';
const ctx = { requestId: 'req', permissions: ['campaign.update_rules'] };

describe('setOverdueWarningThreshold (SAN-142)', () => {
	it('checks permissions and input before the RPC', async () => {
		const rpc = vi.fn();
		const call = (
			input: { campaignId: string; threshold: unknown },
			c: typeof ctx | object = ctx
		) => setOverdueWarningThreshold({ rpc } as never, input as never, c as never);
		await expect(
			call({ campaignId: CAMPAIGN, threshold: 2 }, { permissions: null })
		).rejects.toMatchObject({
			kind: 'internal'
		});
		await expect(
			call({ campaignId: CAMPAIGN, threshold: 2 }, { permissions: [] })
		).rejects.toMatchObject({
			kind: 'permission'
		});
		for (const threshold of [0, 121, 2.5, 'x'])
			await expect(call({ campaignId: CAMPAIGN, threshold })).rejects.toMatchObject({
				kind: 'validation'
			});
		await expect(call({ campaignId: 'bad', threshold: 2 })).rejects.toMatchObject({
			kind: 'not_found'
		});
		expect(rpc).not.toHaveBeenCalled();
	});
	it('calls the RPC with the coerced integer and returns it', async () => {
		const rpc = vi.fn().mockResolvedValue({ error: null });
		await expect(
			setOverdueWarningThreshold({ rpc } as never, { campaignId: CAMPAIGN, threshold: '120' }, ctx)
		).resolves.toBe(120);
		expect(rpc).toHaveBeenCalledWith('campaign_set_overdue_warning_threshold', {
			p_campaign_id: CAMPAIGN,
			p_threshold: 120,
			p_request_id: 'req'
		});
	});
	it.each([
		['42501', 'permission'],
		['22023', 'validation'],
		['P0002', 'not_found'],
		['55000', 'conflict'],
		['XX000', 'internal']
	])('maps %s to %s', (code, kind) =>
		expect(mapOverdueWarningRpcError({ code, message: 'm' })).toMatchObject({ kind })
	);
	it('wraps transport failures', async () => {
		const rpc = vi.fn().mockRejectedValue(new Error('network'));
		await expect(
			setOverdueWarningThreshold({ rpc } as never, { campaignId: CAMPAIGN, threshold: 2 }, ctx)
		).rejects.toMatchObject({ kind: 'internal' });
	});
});
