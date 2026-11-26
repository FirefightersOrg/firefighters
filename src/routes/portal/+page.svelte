<script lang="ts">
	import { institutionName } from '$lib/institution';
	import { resolve } from '$app/paths';
	import { EmptyState, PageHeader, StatusBadge } from '$lib/components/ui';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<svelte:head>
	<title>Mi portal - {institutionName()}</title>
</svelte:head>

{#if data.collector}
	<PageHeader title="Mi portal" description={`Cobrador: ${data.collector.displayName}.`} />
	{#if data.campaigns.length === 0}
		<EmptyState title="No hay una campaña en curso">
			Cuando haya una campaña activa, acá van a estar sus cuotas por cobrar, bonos y ventas.
		</EmptyState>
	{:else}
		<h2 class="m-0 mb-1 text-heading-3 text-text">Elegir la campaña</h2>
		<ul class="m-0 list-none p-0">
			{#each data.campaigns as campaign (campaign.id)}
				<li class="flex items-center justify-between gap-3 border-b border-border">
					<a
						class="inline-flex min-h-14 flex-1 items-center rounded-sm text-body font-medium text-primary-text underline-offset-2 hover:underline"
						href={resolve('/portal/[campaignId]/por-cobrar', { campaignId: campaign.id })}
						>{campaign.name}</a
					>
					<StatusBadge kind="campaign" status={campaign.status} />
				</li>
			{/each}
		</ul>
	{/if}
{:else}
	<PageHeader title="Mi portal" />
	<EmptyState title="El usuario todavía no está vinculado a un cobrador">
		Pedir a un administrador que vincule el usuario con la ficha de cobrador. Mientras tanto no hay
		datos para mostrar.
	</EmptyState>
{/if}
