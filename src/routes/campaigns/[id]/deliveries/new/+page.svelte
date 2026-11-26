<script lang="ts">
	import { institutionName } from '$lib/institution';
	import { tick } from 'svelte';
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import {
		Alert,
		BondNumber,
		Button,
		Field,
		PageHeader,
		Select,
		TextInput
	} from '$lib/components/ui';
	import { campaignNumberingConfig } from '$lib/domain/campaigns';
	import { DELIVERY_MAX_BONDS } from '$lib/domain/deliveries';
	import {
		bondCountLabel,
		deliverLabel,
		groupBondRanges,
		lookupMessage as lookupText,
		rangeCountLabel,
		rangeLabel,
		removeRangeLabel,
		type BondRange
	} from '$lib/domain/delivery-summary';
	import { formatCampaignNumber, parseCampaignNumber } from '$lib/domain/numbering';
	import { formatNumber } from '$lib/format';
	import type { DeliveryBondOption } from '$lib/server/deliveries/route-helpers';
	import type { PageProps } from './$types';

	/**
	 * New delivery (UX plan PR 16, audit A15): who receives the bonds, then the bonds, found by
	 * number, code or scan, or by a base-number range. What was added is shown as the ranges the
	 * operator has in the hand («0211 a 0215, 5 bonos»), each with its own remove control, and the
	 * button says what is about to be recorded («Entregar 35 bonos a Jorge Medina»). The two actions
	 * and their fields are the same: `?/deliver` still gets one `bondIds` per bond.
	 */
	let { data, form }: PageProps = $props();
	const campaign = $derived(data.campaign);
	const numbering = $derived(campaignNumberingConfig(campaign));
	const fmt = (value: number) => formatCampaignNumber(value, numbering);

	let selected = $state<DeliveryBondOption[]>([]);
	let lookupMessage = $state<string | null>(null);
	let busy = $state(false);
	let sending = $state(false);
	// The initial value is intentional: a rejected delivery comes back with its collector.
	// svelte-ignore state_referenced_locally
	let collectorId = $state(form?.values?.collectorId ?? '');

	const ranges = $derived(groupBondRanges(selected));
	const units = $derived(selected.reduce((total, b) => total + b.units, 0));
	const collectorName = $derived(
		data.collectors.find((c) => c.id === collectorId)?.displayName ?? null
	);
	const submitLabel = $derived(deliverLabel(selected.length, collectorName));

	/** The range the lookup asked for, when it was one (to name the numbers that are not available). */
	function requestedRange(values: Record<string, string> | undefined) {
		if (!values?.from || !values?.to) return null;
		try {
			return {
				from: parseCampaignNumber(values.from, numbering),
				to: parseCampaignNumber(values.to, numbering)
			};
		} catch {
			return null;
		}
	}
	function add(
		found: DeliveryBondOption[],
		values: Record<string, string> | undefined,
		truncated: boolean
	) {
		const known = new Set(selected.map((b) => b.id));
		const fresh = found.filter((b) => !known.has(b.id));
		const room = Math.max(0, DELIVERY_MAX_BONDS - selected.length);
		selected = [...selected, ...fresh.slice(0, room)];
		lookupMessage = lookupText({
			found,
			added: Math.min(fresh.length, room),
			range: requestedRange(values),
			truncated,
			format: fmt
		});
	}
	function remove(range: BondRange) {
		const gone = new Set(range.bondIds);
		selected = selected.filter((b) => !gone.has(b.id));
		lookupMessage = null;
	}
	const deliverErrors = $derived(form && 'errors' in form && !form.found ? form.errors : {});
	const collectorOptions = $derived([
		{ value: '', label: 'Elegir…' },
		...data.collectors.map((c) => ({ value: c.id, label: c.displayName }))
	]);
	/**
	 * Clears the search and gives the scan field focus again after each lookup (barcode scanners).
	 * A range that was added is cleared too: left in place it would win over the next number typed.
	 */
	async function resetLookup(clearRange: boolean) {
		const field = (id: string) => document.getElementById(id) as HTMLInputElement | null;
		const input = field('query');
		if (input) input.value = '';
		if (clearRange)
			for (const id of ['from', 'to']) {
				const bound = field(id);
				if (bound) bound.value = '';
			}
		await tick();
		input?.focus();
	}
</script>

<svelte:head><title>Nueva entrega - {campaign.name} - {institutionName()}</title></svelte:head>

<PageHeader
	title="Nueva entrega"
	description="Los bonos disponibles que se lleva un cobrador. Al entregarlos se emite el remito."
	breadcrumbs={[
		{ label: 'Campañas', href: resolve('/campaigns') },
		{ label: campaign.name, href: resolve('/campaigns/[id]', { id: campaign.id }) },
		{ label: 'Entregas', href: resolve('/campaigns/[id]/deliveries', { id: campaign.id }) },
		{ label: 'Nueva entrega' }
	]}
/>

<div class="flex max-w-[640px] flex-col gap-8">
	{#if !data.canDeliver}
		<Alert tone="warning">{data.lockedMessage}</Alert>
	{:else}
		{#if form?.message && !form.success && !form.found}<Alert tone="danger">{form.message}</Alert
			>{/if}

		<Field
			label="Cobrador"
			id="collectorId"
			required
			hint={data.canSeeCollectors ? undefined : 'Solo un administrador puede ver los cobradores.'}
			error={deliverErrors.collectorId?.[0]}
		>
			<Select
				name="collectorId"
				form="deliver-form"
				options={collectorOptions}
				bind:value={collectorId}
			/>
		</Field>

		<section aria-labelledby="bonds-title" class="flex flex-col gap-4" data-delivery-bonds>
			<h2 id="bonds-title" class="m-0 border-b border-border-strong pb-2 text-heading-3">Bonos</h2>
			<form
				method="POST"
				action="?/lookup"
				class="flex flex-col gap-4"
				use:enhance={() => {
					busy = true;
					return async ({ result }) => {
						busy = false;
						const values = (
							result.type === 'success' || result.type === 'failure'
								? result.data?.values
								: undefined
						) as Record<string, string> | undefined;
						if (result.type === 'success' && result.data?.found) {
							add(result.data.found as DeliveryBondOption[], values, !!result.data.truncated);
						} else if (result.type === 'failure') {
							lookupMessage = (result.data?.message as string) ?? 'La búsqueda falló.';
						}
						await resetLookup(result.type === 'success');
					};
				}}
			>
				<Field
					label="Número, código de barras o código"
					id="query"
					hint="Un número base o asociado, o escanear el código de barras (Enter lo agrega)."
				>
					<TextInput name="query" autocomplete="off" mono />
				</Field>
				<fieldset class="m-0 min-w-0 border-0 p-0">
					<legend class="p-0 text-label text-text">O un rango de números base</legend>
					<div class="mt-1 grid max-w-form grid-cols-2 gap-3">
						<Field label="Desde" id="from">
							<TextInput name="from" inputmode="numeric" autocomplete="off" mono />
						</Field>
						<Field label="Hasta" id="to">
							<TextInput name="to" inputmode="numeric" autocomplete="off" mono />
						</Field>
					</div>
				</fieldset>
				<div class="flex flex-wrap items-center gap-x-4 gap-y-2">
					<Button type="submit" disabled={busy}>{busy ? 'Buscando…' : 'Agregar'}</Button>
					<p
						aria-live="polite"
						class="m-0 min-w-0 flex-1 basis-48 text-body-sm text-text"
						data-lookup-message
					>
						{lookupMessage ?? ''}
					</p>
				</div>
			</form>

			<div id="bondIds" class="flex flex-col gap-2">
				{#if deliverErrors.bondIds?.[0]}
					<p id="bondIds-error" class="m-0 text-body-sm text-danger-text">
						{deliverErrors.bondIds[0]}
					</p>
				{/if}
				{#if ranges.length === 0}
					<p class="m-0 text-body text-muted" data-delivery-empty>
						Todavía no hay bonos en esta entrega.
					</p>
				{:else}
					<ul
						class="m-0 list-none border-y border-border p-0"
						aria-label="Bonos de esta entrega"
						data-delivery-ranges
					>
						{#each ranges as range (range.key)}
							<li
								class="flex min-h-14 items-center gap-3 border-b border-border py-1 last:border-b-0"
								data-range={rangeLabel(range, fmt)}
							>
								<span class="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-2">
									{#if range.kind === 'range' && range.from !== null && range.to !== null}
										<BondNumber number={fmt(range.from)} />
										<span class="text-body text-muted">a</span>
										<BondNumber number={fmt(range.to)} />
									{:else}
										<BondNumber number={rangeLabel(range, fmt)} />
									{/if}
								</span>
								<span class="shrink-0 text-body-sm text-muted tabular-nums"
									>{rangeCountLabel(range)}</span
								>
								<Button
									variant="ghost"
									aria-label={removeRangeLabel(range, fmt)}
									onclick={() => remove(range)}>Quitar</Button
								>
							</li>
						{/each}
					</ul>
					{#if ranges.length > 1 || units !== selected.length}
						<p class="m-0 text-body text-text" data-delivery-total>
							<span class="font-medium">{bondCountLabel(selected.length)}</span> en esta entrega{units !==
							selected.length
								? `, ${formatNumber(units)} unidades contando las patas`
								: ''}.
						</p>
					{/if}
				{/if}
			</div>
		</section>

		<form
			id="deliver-form"
			method="POST"
			action="?/deliver"
			class="flex flex-col gap-4"
			use:enhance={() => {
				sending = true;
				return async ({ update }) => {
					sending = false;
					await update({ reset: false });
				};
			}}
		>
			{#each selected as bond (bond.id)}
				<input type="hidden" name="bondIds" value={bond.id} />
			{/each}
			<Field label="Observaciones" id="notes" optional error={deliverErrors.notes?.[0]}>
				<TextInput name="notes" value={form?.values?.notes ?? ''} />
			</Field>
			<div>
				<Button
					type="submit"
					variant="primary"
					size="lg"
					class="h-auto! min-h-control-lg w-full py-2 text-center whitespace-normal! sm:w-auto"
					disabled={selected.length === 0}
					loading={sending}
					data-deliver-submit>{submitLabel}</Button
				>
			</div>
		</form>
	{/if}
</div>
