<script lang="ts">
	import FormAlert from '$lib/components/campaigns/FormAlert.svelte';
	import { cardClass } from '$lib/components/campaigns/styles';
	import BondReasonAction from './BondReasonAction.svelte';
	import type { BondRecordActions } from './types';

	/** Bond record actions: ungroup (manual pata) and annul (simple bond / printed pata). */
	let {
		actions,
		isPata,
		errors
	}: {
		actions: BondRecordActions;
		isPata: boolean;
		/** Reason errors of the last ungroup / annul submit, by action. */
		errors: { ungroup?: string[]; annul?: string[] };
	} = $props();
</script>

{#if actions.ungroup || actions.annul || actions.lockedMessage}
	<section class={cardClass} aria-labelledby="actions-title">
		<h2 id="actions-title" class="mb-4 text-base font-semibold">Actions</h2>
		{#if actions.lockedMessage}
			<FormAlert kind="warning" message={actions.lockedMessage} />
		{/if}
		<div class="flex flex-wrap gap-4">
			{#if actions.ungroup}
				<BondReasonAction
					action="ungroup"
					label="Ungroup pata"
					title="Ungroup this pata?"
					body="The pata is annulled and its simple bonds are available on their own again. The grouping is kept in the history. This cannot be undone."
					confirm="Ungroup pata"
					errors={errors.ungroup}
				/>
			{/if}
			{#if actions.annul}
				<BondReasonAction
					action="annul"
					label={isPata ? 'Annul pata' : 'Annul bond'}
					title={isPata ? 'Annul this pata?' : 'Annul this bond?'}
					body="Use this for a bond loaded by mistake. It is kept as annulled and its numbers are freed, so they can be entered again in another bond. This cannot be undone."
					confirm={isPata ? 'Annul pata' : 'Annul bond'}
					errors={errors.annul}
				/>
			{/if}
		</div>
	</section>
{/if}
