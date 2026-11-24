<script lang="ts">
	import { resolve } from '$app/paths';
	import type { ResolvedPathname } from '$app/types';
	import RiskyOperationChecklist from '$lib/components/backups/RiskyOperationChecklist.svelte';
	import { Button, Card, Field, PageHeader, TextInput } from '$lib/components/ui';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const campaign = $derived(data.campaign);
	let from = $state('');
	let to = $state('');
	const href = (kind: string, hasPeriod: boolean) => {
		const base = `/campaigns/${campaign.id}/backups/export/${kind}`;
		const q = [
			hasPeriod && from ? `from=${encodeURIComponent(from)}` : '',
			hasPeriod && to ? `to=${encodeURIComponent(to)}` : ''
		].filter(Boolean);
		return (q.length ? `${base}?${q.join('&')}` : base) as ResolvedPathname;
	};
</script>

<svelte:head><title>Exportaciones de respaldo - {campaign.name} - Firefighters</title></svelte:head>

<PageHeader
	title="Exportaciones de respaldo"
	description="Archivos CSV generados en el momento con los datos actuales. Descargalos antes de cualquier operación riesgosa."
	breadcrumbs={[
		{ label: 'Campañas', href: resolve('/campaigns') },
		{ label: campaign.name, href: resolve('/campaigns/[id]', { id: campaign.id }) },
		{ label: 'Exportaciones de respaldo' }
	]}
/>

<div class="space-y-6">
	<RiskyOperationChecklist
		campaignId={campaign.id}
		operation="una operación riesgosa (importación masiva, cambio de reglas, corrección masiva, cierre)"
		canExport={true}
	/>

	<Card
		title="Período"
		description="Opcional. Filtra los pagos (por fecha de pago) y las cuentas de cobradores (por fecha del movimiento), con los extremos incluidos."
	>
		<div class="grid gap-4 sm:grid-cols-2">
			<Field label="Desde" optional>
				<TextInput type="date" bind:value={from} />
			</Field>
			<Field label="Hasta" optional>
				<TextInput type="date" bind:value={to} />
			</Field>
		</div>
	</Card>

	<Card title="Exportaciones">
		<ul class="divide-y divide-border text-body">
			{#each data.exports as e (e.kind)}
				<li class="flex items-center justify-between gap-3 py-2">
					<span>{e.label}</span>
					{#if e.allowed}
						<Button href={href(e.kind, e.hasPeriod)} download icon="download">Descargar CSV</Button>
					{:else}
						<span class="text-body-sm text-muted">Tu rol no tiene permiso</span>
					{/if}
				</li>
			{/each}
			{#each data.pending as p (p)}
				<li class="flex items-center justify-between gap-3 py-2 text-muted">
					<span>{p === 'winners-prizes' ? 'Ganadores y premios' : p}</span>
					<span class="text-body-sm">Pendiente</span>
				</li>
			{/each}
		</ul>
	</Card>
</div>
