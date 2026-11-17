import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import { CAMPAIGN_REASON_MAX_LENGTH } from '$lib/schemas/campaign';
import TransitionAction from './TransitionAction.svelte';

function reasonField(toStatus: 'active' | 'closing' | 'closed' | 'annulled') {
	const { body } = render(TransitionAction, { props: { toStatus } });
	const textarea = body.match(/<textarea[^>]*>/)?.[0];
	const label = body.match(/<label[^>]*>([\s\S]*?)<\/label>/)?.[1].trim();
	return { textarea, label };
}

describe('TransitionAction', () => {
	it.each(['active', 'closing', 'closed'] as const)(
		'%s offers an optional reason (stored in the audit log)',
		(toStatus) => {
			const { textarea, label } = reasonField(toStatus);
			expect(textarea).toBeDefined();
			expect(textarea).toContain('name="reason"');
			expect(textarea).toContain(`maxlength="${CAMPAIGN_REASON_MAX_LENGTH}"`);
			expect(textarea).not.toMatch(/\brequired\b/);
			expect(label).toBe('Reason (optional)');
		}
	);

	it('annulment requires a reason', () => {
		const { textarea, label } = reasonField('annulled');
		expect(textarea).toContain('name="reason"');
		expect(textarea).toContain(`maxlength="${CAMPAIGN_REASON_MAX_LENGTH}"`);
		expect(textarea).toMatch(/\brequired\b/);
		expect(label).toBe('Reason (required)');
	});
});
