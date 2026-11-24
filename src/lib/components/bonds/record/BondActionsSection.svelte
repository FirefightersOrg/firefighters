<script lang="ts">
	import { Alert, Card } from '$lib/components/ui';
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
	<Card title="Acciones" id="actions">
		<div class="flex flex-col gap-4">
			{#if actions.lockedMessage}
				<Alert tone="warning">{actions.lockedMessage}</Alert>
			{/if}
			<div class="flex flex-wrap gap-4">
				{#if actions.ungroup}
					<BondReasonAction
						action="ungroup"
						label="Desagrupar pata"
						title="¿Desagrupar esta pata?"
						body="La pata se anula y sus bonos simples vuelven a estar disponibles por separado. La agrupación se conserva en el historial. No se puede deshacer."
						confirm="Desagrupar pata"
						errors={errors.ungroup}
					/>
				{/if}
				{#if actions.annul}
					<BondReasonAction
						action="annul"
						label={isPata ? 'Anular pata' : 'Anular bono'}
						title={isPata ? '¿Anular esta pata?' : '¿Anular este bono?'}
						body="Usar esta acción para un bono cargado por error. Se conserva como anulado y sus números quedan libres, de modo que se pueden ingresar de nuevo en otro bono. No se puede deshacer."
						confirm={isPata ? 'Anular pata' : 'Anular bono'}
						errors={errors.annul}
					/>
				{/if}
			</div>
		</div>
	</Card>
{/if}
