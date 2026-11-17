<script lang="ts">
	import { resolve } from '$app/paths';

	/**
	 * Links to the bonds a form error is about: the bond that already uses a number or code, or
	 * the pata a picked bond already belongs to (`kind = 'pata'`).
	 */
	let {
		campaignId,
		conflicts,
		kind = 'uses'
	}: {
		campaignId: string;
		conflicts: { bondId: string; numbers: string[] }[];
		kind?: 'uses' | 'pata';
	} = $props();

	function label(numbers: string[]) {
		if (kind === 'pata') {
			return numbers.length > 0
				? `View the pata that bond ${numbers.join(', ')} belongs to →`
				: 'View the pata →';
		}
		return numbers.length > 0
			? `View the bond that uses ${numbers.join(', ')} →`
			: 'View the bond that uses it →';
	}
</script>

{#each conflicts as conflict (conflict.bondId)}
	<p class="mt-1 text-xs">
		<a
			href={resolve('/campaigns/[id]/bonds/[bondId]', { id: campaignId, bondId: conflict.bondId })}
			class="font-medium text-blue-700 hover:underline"
		>
			{label(conflict.numbers)}
		</a>
	</p>
{/each}
