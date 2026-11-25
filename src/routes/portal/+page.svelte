<script lang="ts">
	import { resolve } from '$app/paths';
	import { Card, EmptyState, PageHeader, StatusBadge } from '$lib/components/ui';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const link = 'rounded-sm text-primary-text underline-offset-2 hover:underline';
</script>

<svelte:head>
	<title>Mi portal - Firefighters</title>
</svelte:head>

{#if data.collector}
	<PageHeader title="Mi portal" description={`Cobrador: ${data.collector.displayName}.`} />
	<!-- SAN-144: Mis bonos -->
	<Card title="Mis bonos">
		{#if data.campaigns.length === 0}
			<p class="m-0 text-muted">No hay campañas disponibles.</p>
		{:else}
			<ul class="m-0 flex list-none flex-col gap-2 p-0">
				{#each data.campaigns as campaign (campaign.id)}
					<li class="flex items-center gap-2">
						<a
							class={link}
							href={resolve('/portal/[campaignId]/bonos', { campaignId: campaign.id })}
							>Mis bonos: {campaign.name}</a
						>
						<StatusBadge kind="campaign" status={campaign.status} />
					</li>
				{/each}
			</ul>
		{/if}
	</Card>
	{#if data.canViewSales}
		<!-- SAN-145: ventas y cobranza -->
		<Card title="Ventas y cobranza">
			<ul class="m-0 flex list-none flex-col gap-2 p-0">
				<li><a class={link} href={resolve('/portal/ventas')}>Mis ventas</a></li>
				<li><a class={link} href={resolve('/portal/compradores')}>Mis compradores</a></li>
				<li><a class={link} href={resolve('/portal/por-cobrar')}>Por cobrar</a></li>
			</ul>
		</Card>
	{/if}
{:else}
	<PageHeader title="Mi portal" />
	<EmptyState title="El usuario todavía no está vinculado a un cobrador">
		Pedir a un administrador que vincule el usuario con la ficha de cobrador. Mientras tanto no hay
		datos para mostrar.
	</EmptyState>
{/if}
