<script lang="ts">
	import { institutionName } from '$lib/institution';
	import { resolve } from '$app/paths';
	import { Card, EmptyState, PageHeader, StatusBadge } from '$lib/components/ui';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<svelte:head>
	<title>Mi portal - {institutionName()}</title>
</svelte:head>

{#if data.collector}
	<PageHeader title="Mi portal" description={`Cobrador: ${data.collector.displayName}.`} />
	<Card title="Campañas">
		{#if data.campaigns.length === 0}
			<p class="m-0 text-muted">No hay campañas disponibles.</p>
		{:else}
			<ul class="m-0 flex list-none flex-col gap-2 p-0">
				{#each data.campaigns as campaign (campaign.id)}
					<li class="flex items-center gap-2">
						<a
							class="inline-flex min-h-11 items-center rounded-sm text-primary-text underline-offset-2 hover:underline"
							href={resolve('/portal/[campaignId]/bonos', { campaignId: campaign.id })}
							>{campaign.name}</a
						>
						<StatusBadge kind="campaign" status={campaign.status} />
					</li>
				{/each}
			</ul>
		{/if}
	</Card>
{:else}
	<PageHeader title="Mi portal" />
	<EmptyState title="El usuario todavía no está vinculado a un cobrador">
		Pedir a un administrador que vincule el usuario con la ficha de cobrador. Mientras tanto no hay
		datos para mostrar.
	</EmptyState>
{/if}
