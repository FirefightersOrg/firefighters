<script lang="ts">
	import { institutionName } from '$lib/institution';
	import { tick } from 'svelte';
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import {
		Alert,
		Button,
		Card,
		EmptyState,
		Field,
		PageHeader,
		Select,
		TextInput
	} from '$lib/components/ui';
	import { formatNumber } from '$lib/format';
	import { DELIVERY_MAX_BONDS } from '$lib/domain/deliveries';
	import type { DeliveryBondOption } from '$lib/server/deliveries/route-helpers';
	import type { PageProps } from './$types';

	/**
	 * New delivery: find available bonds (number, code or scan, or a base-number range), review the
	 * selection and deliver it to one collector in a single note.
	 */
	let { data, form }: PageProps = $props();
	const campaign = $derived(data.campaign);

	let selected = $state<DeliveryBondOption[]>([]);
	let lookupMessage = $state<string | null>(null);
	let busy = $state(false);
	const units = $derived(selected.reduce((total, b) => total + b.units, 0));

	function add(found: DeliveryBondOption[]) {
		const known = new Set(selected.map((b) => b.id));
		const fresh = found.filter((b) => !known.has(b.id));
		selected = [...selected, ...fresh].slice(0, DELIVERY_MAX_BONDS);
		lookupMessage =
			found.length === 0
				? 'Ningún bono disponible coincide.'
				: fresh.length === 0
					? 'Ya está en la lista.'
					: `${fresh.length} agregados.`;
	}
	const deliverErrors = $derived(form && 'errors' in form && !form.found ? form.errors : {});
	const collectorOptions = $derived([
		{ value: '', label: 'Elegir…' },
		...data.collectors.map((c) => ({ value: c.id, label: c.displayName }))
	]);
	/** Clears the scan field and gives it focus again after each lookup (barcode scanners). */
	async function resetQuery() {
		const input = document.getElementById('query') as HTMLInputElement | null;
		if (input) input.value = '';
		await tick();
		input?.focus();
	}
</script>

<svelte:head><title>Nueva entrega - {campaign.name} - {institutionName()}</title></svelte:head>

<PageHeader
	title="Nueva entrega"
	description="Bonos disponibles de {campaign.name} entregados a un cobrador, con su remito."
	breadcrumbs={[
		{ label: 'Campañas', href: resolve('/campaigns') },
		{ label: campaign.name, href: resolve('/campaigns/[id]', { id: campaign.id }) },
		{ label: 'Entregas', href: resolve('/campaigns/[id]/deliveries', { id: campaign.id }) },
		{ label: 'Nueva entrega' }
	]}
/>

<div class="space-y-6">
	{#if !data.canDeliver}
		<Alert tone="warning">{data.lockedMessage}</Alert>
	{:else}
		{#if form?.message && !form.success && !form.found}<Alert tone="danger">{form.message}</Alert
			>{/if}

		<Card title="Agregar bonos">
			<form
				method="POST"
				action="?/lookup"
				class="grid gap-4 sm:grid-cols-4 sm:items-end"
				use:enhance={() => {
					busy = true;
					return async ({ result }) => {
						busy = false;
						if (result.type === 'success' && result.data?.found) {
							add(result.data.found as DeliveryBondOption[]);
							if (result.data.truncated)
								lookupMessage = 'Se muestran las primeras 500 coincidencias; acotar el rango.';
						} else if (result.type === 'failure') {
							lookupMessage = (result.data?.message as string) ?? 'La búsqueda falló.';
						}
						await resetQuery();
					};
				}}
			>
				<div class="sm:col-span-2">
					<Field
						label="Número, código de barras o código"
						id="query"
						hint="Un número base o asociado, o escanear el código de barras (Enter lo agrega)."
					>
						<TextInput name="query" autocomplete="off" mono />
					</Field>
				</div>
				<Field label="O rango desde" id="from" optional>
					<TextInput name="from" inputmode="numeric" mono />
				</Field>
				<Field label="Hasta" id="to" optional>
					<TextInput name="to" inputmode="numeric" mono />
				</Field>
				<Button type="submit" disabled={busy}>{busy ? 'Buscando…' : 'Agregar'}</Button>
				<p aria-live="polite" class="text-body-sm text-muted sm:col-span-3">
					{lookupMessage ?? ''}
				</p>
			</form>
		</Card>

		<Card title="Entrega">
			<form method="POST" action="?/deliver" class="space-y-4" use:enhance>
				<Field
					label="Cobrador"
					id="collectorId"
					required
					hint={data.canSeeCollectors
						? undefined
						: 'Solo un administrador puede ver los cobradores.'}
					error={deliverErrors.collectorId?.[0]}
				>
					<Select
						name="collectorId"
						options={collectorOptions}
						value={form?.values?.collectorId ?? ''}
					/>
				</Field>

				<div id="bondIds">
					<p class="text-label">
						Bonos ({formatNumber(selected.length)} · {formatNumber(units)} unidades)
					</p>
					{#if deliverErrors.bondIds?.[0]}
						<p id="bondIds-error" class="mt-1 text-body-sm text-danger-text">
							{deliverErrors.bondIds[0]}
						</p>
					{/if}
					{#if selected.length === 0}
						<EmptyState title="Todavía no hay bonos en la lista" />
					{:else}
						<ul class="mt-2 divide-y divide-border text-body">
							{#each selected as bond (bond.id)}
								<li class="flex items-center justify-between py-1">
									<input type="hidden" name="bondIds" value={bond.id} />
									<span class="font-mono">{bond.label}</span>
									<Button
										variant="ghost"
										onclick={() => (selected = selected.filter((b) => b.id !== bond.id))}
										>Quitar</Button
									>
								</li>
							{/each}
						</ul>
					{/if}
				</div>

				<Field label="Observaciones" id="notes" optional error={deliverErrors.notes?.[0]}>
					<TextInput name="notes" value={form?.values?.notes ?? ''} />
				</Field>
				<Button type="submit" variant="primary" disabled={selected.length === 0}
					>Entregar y emitir remito</Button
				>
			</form>
		</Card>
	{/if}
</div>
