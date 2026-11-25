<script lang="ts">
	import { resolve } from '$app/paths';
	import { Card, EmptyState, PageHeader, StatusBadge } from '$lib/components/ui';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<svelte:head>
	<title>Mi portal - Firefighters</title>
</svelte:head>

{#if data.collector}
	<PageHeader title="Mi portal" description={`Hola, ${data.collector.displayName}.`} />
	<Card title="Tu cartera">
		<p class="m-0 text-muted">
			Acá vas a ver tus bonos, tus ventas y tu cuenta corriente. Todavía no hay secciones
			disponibles.
		</p>
	</Card>
	<!-- SAN-144: Mis bonos -->
	<Card title="Mis bonos">
		{#if data.campaigns.length === 0}
			<p class="m-0 text-muted">No hay campañas disponibles.</p>
		{:else}
			<ul class="m-0 flex list-none flex-col gap-2 p-0">
				{#each data.campaigns as campaign (campaign.id)}
					<li class="flex items-center gap-2">
						<a
							href={resolve('/portal/[campaignId]/bonos', { campaignId: campaign.id })}
							class="rounded-sm text-primary underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
							>Mis bonos: {campaign.name}</a
						>
						<StatusBadge kind="campaign" status={campaign.status} />
					</li>
				{/each}
			</ul>
		{/if}
	</Card>
{:else}
	<PageHeader title="Mi portal" />
	<EmptyState title="Tu usuario todavía no está vinculado a un cobrador">
		Pedile a un administrador que vincule tu usuario con tu ficha de cobrador. Mientras tanto no hay
		datos para mostrar.
	</EmptyState>
{/if}
