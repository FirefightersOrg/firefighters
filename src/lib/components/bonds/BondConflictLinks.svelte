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
				? `Ver la pata a la que pertenece el bono ${numbers.join(', ')} →`
				: 'Ver la pata →';
		}
		return numbers.length > 0
			? `Ver el bono que usa ${numbers.join(', ')} →`
			: 'Ver el bono que lo usa →';
	}
</script>

{#each conflicts as conflict (conflict.bondId)}
	<p class="m-0 mt-1 text-caption">
		<a
			href={resolve('/campaigns/[id]/bonds/[bondId]', { id: campaignId, bondId: conflict.bondId })}
			class="font-medium text-primary-text underline-offset-2 underline"
		>
			{label(conflict.numbers)}
		</a>
	</p>
{/each}
