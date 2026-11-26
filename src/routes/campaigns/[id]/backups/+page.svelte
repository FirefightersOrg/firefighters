<script lang="ts">
	import { institutionName } from '$lib/institution';
	import { resolve } from '$app/paths';
	import type { ResolvedPathname } from '$app/types';
	import RiskyOperationChecklist from '$lib/components/backups/RiskyOperationChecklist.svelte';
	import { Button, Disclosure, Field, PageHeader, TextInput } from '$lib/components/ui';
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

<svelte:head
	><title>Exportaciones de respaldo - {campaign.name} - {institutionName()}</title></svelte:head
>

<PageHeader
	title="Exportaciones de respaldo"
	description="Archivos CSV generados en el momento con los datos actuales. Descargarlos antes de cualquier operación riesgosa."
	breadcrumbs={[
		{ label: 'Campañas', href: resolve('/campaigns') },
		{ label: campaign.name, href: resolve('/campaigns/[id]', { id: campaign.id }) },
		{ label: 'Exportaciones de respaldo' }
	]}
/>

<div class="space-y-6">
	<div class="[&_a]:inline-flex [&_a]:min-h-touch [&_a]:items-center">
		<RiskyOperationChecklist
			campaignId={campaign.id}
			operation="una operación riesgosa (importación masiva, cambio de reglas, corrección masiva, cierre)"
			canExport={true}
		/>
	</div>

	<Disclosure summary="Filtrar por período"
		><p class="mb-3 text-body-sm text-muted">
			Opcional. Filtra los pagos por su fecha y las cuentas por la fecha del movimiento. Incluye
			ambos extremos.
		</p>
		<div class="grid gap-4 sm:grid-cols-2">
			<Field label="Desde" optional>
				<TextInput type="date" bind:value={from} />
			</Field>
			<Field label="Hasta" optional>
				<TextInput type="date" bind:value={to} />
			</Field>
		</div>
	</Disclosure>

	<section aria-labelledby="exports-title">
		<h2 id="exports-title" class="mb-3 text-heading-2">Exportaciones</h2>
		<ul class="divide-y divide-border text-body">
			{#each data.exports as e (e.kind)}
				<li class="flex flex-wrap items-center justify-between gap-3 py-3">
					<span>{e.label}</span>
					{#if e.allowed}
						<Button href={href(e.kind, e.hasPeriod)} download icon="download">Descargar CSV</Button>
					{:else}
						<span class="text-body-sm text-muted">Sin permiso de exportación</span>
					{/if}
				</li>
			{/each}
		</ul>
	</section>
</div>
