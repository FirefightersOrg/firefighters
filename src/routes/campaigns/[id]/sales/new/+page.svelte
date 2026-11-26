<script lang="ts">
	import { enhance } from '$app/forms';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import {
		Alert,
		BondNumber,
		Button,
		Checkbox,
		Disclosure,
		EmptyState,
		Field,
		Money,
		PageHeader,
		SegmentedControl,
		Select,
		TextInput
	} from '$lib/components/ui';
	import { institutionName } from '$lib/institution';
	import { PAYMENT_MODE_LABELS, buildInstallmentSchedule } from '$lib/domain/sales';
	import { buyerDisplayName, buyerIdentification } from '$lib/domain/parties';
	import { formatDate, formatPaddedNumber } from '$lib/format';
	import type { PageProps } from './$types';

	/**
	 * Register a sale (UX plan PR 12, audit A6): which bond, to whom, how it is paid. What was
	 * answered is kept in the page while the rest is filled in (searching for the buyer no longer
	 * loses the bond), each answered step collapses to one line, and the button says what it is
	 * about to register. Same three actions (`lookup`, `createBuyer`, `register`) and fields. Without
	 * JavaScript the forms post as before: the radios belong to the sale's form by its id.
	 */
	let { data, form }: PageProps = $props();

	type Found = NonNullable<typeof data.found>[number];
	const digits = $derived(data.campaign.numberDigits);
	const numbers = (bond: Found) =>
		bond.baseNumbers.map((n) => formatPaddedNumber(n, digits)).join(' + ');

	// --- 1. The bond ----------------------------------------------------------------------------
	// What the server answered first (a lookup posted without JavaScript, or `?bond=` in the URL);
	// later lookups replace it without touching the rest of the page.
	// svelte-ignore state_referenced_locally
	let found = $state<Found[] | null>(
		form?.form === 'lookup' && form.found ? (form.found as Found[]) : data.found
	);
	// svelte-ignore state_referenced_locally
	let bondQuery = $state(
		form?.form === 'lookup' && typeof form.query === 'string' ? form.query : data.bondQuery
	);
	let lookupError = $state('');
	let looking = $state(false);
	const onlySellable = (list: Found[] | null) => {
		const sellable = (list ?? []).filter((bond) => bond.sellable);
		return sellable.length === 1 ? sellable[0].id : '';
	};
	// svelte-ignore state_referenced_locally
	let bondId = $state(
		(form?.form === 'sale' && (form.values?.bondId as string | undefined)) || onlySellable(found)
	);
	const bond = $derived(found?.find((item) => item.id === bondId && item.sellable) ?? null);

	const lookup: Parameters<typeof enhance>[1] = () => {
		looking = true;
		lookupError = '';
		return async ({ result }) => {
			looking = false;
			if (result.type === 'success' && result.data?.found) {
				found = result.data.found as Found[];
				bondId = onlySellable(found);
			} else if (result.type === 'failure') {
				const errors = result.data?.errors as Record<string, string[]> | undefined;
				lookupError = errors?.query?.[0] ?? (result.data?.message as string) ?? '';
			} else lookupError = 'No se pudieron buscar los bonos. Volver a intentar.';
		};
	};

	// --- 2. The buyer ---------------------------------------------------------------------------
	// svelte-ignore state_referenced_locally
	let buyerQuery = $state(data.buyerSearch);
	let created = $state<{ id: string; name: string } | null>(null);
	// svelte-ignore state_referenced_locally
	let buyerResult = $state<{
		message?: string;
		duplicates?: unknown;
		success?: boolean;
	} | null>(form?.form === 'buyer' ? form : null);
	// svelte-ignore state_referenced_locally
	let buyerId = $state(
		(form?.form === 'sale' && (form.values?.buyerId as string | undefined)) ||
			(form?.form === 'buyer' && form.success && form.buyerId ? (form.buyerId as string) : '') ||
			// A search that leaves one buyer chooses it.
			(data.buyerSearch && data.buyers.length === 1 ? data.buyers[0].id : '')
	);
	const buyerName = $derived(
		created?.id === buyerId
			? created.name
			: form?.form === 'buyer' && form.buyerId === buyerId
				? ((form.buyerName as string | undefined) ?? '')
				: (() => {
						const buyer = data.buyers.find((item) => item.id === buyerId);
						return buyer ? buyerDisplayName(buyer) : '';
					})()
	);
	let searching = $state(false);

	/** The existing `?buyer=` search, without leaving the page: what was answered stays. */
	async function searchBuyers(event: SubmitEvent) {
		event.preventDefault();
		searching = true;
		const url = new URL(page.url);
		if (buyerQuery.trim()) url.searchParams.set('buyer', buyerQuery.trim());
		else url.searchParams.delete('buyer');
		// eslint-disable-next-line svelte/no-navigation-without-resolve -- same page, only the search changes
		await goto(`${url.pathname}${url.search}`, {
			keepFocus: true,
			noScroll: true,
			replaceState: true
		});
		searching = false;
		if (buyerQuery.trim() && data.buyers.length === 1) buyerId = data.buyers[0].id;
	}

	const createBuyer: Parameters<typeof enhance>[1] = () => {
		return async ({ result }) => {
			if (result.type !== 'success' && result.type !== 'failure') return;
			const answer = (result.data ?? {}) as {
				success?: boolean;
				buyerId?: string;
				buyerName?: string;
				message?: string;
				duplicates?: unknown;
			};
			buyerResult = answer;
			if (answer.success && answer.buyerId) {
				created = { id: answer.buyerId, name: answer.buyerName ?? '' };
				buyerId = answer.buyerId;
			}
		};
	};

	// --- 3. Payment -----------------------------------------------------------------------------
	const saleValues = $derived(form?.form === 'sale' ? form.values : undefined);
	// svelte-ignore state_referenced_locally
	let mode = $state((saleValues?.paymentMode as string | undefined) || 'full_payment');
	// svelte-ignore state_referenced_locally
	let saleDate = $state((saleValues?.saleDate as string | undefined) || data.today);
	// svelte-ignore state_referenced_locally
	let due = $state((saleValues?.firstDueDate as string | undefined) || data.today);
	const soldOn = $derived(saleDate || data.today);
	/** Client mirror of the server bounds: [sale date, sale date + 365 days]. */
	const dueMax = $derived.by(() => {
		const [y, m, d] = soldOn.split('-').map(Number);
		return new Date(Date.UTC(y, m - 1, d + 365)).toISOString().slice(0, 10);
	});
	const errors = $derived((form?.errors ?? {}) as Record<string, string[]>);
	const saleError = (key: string) => (form?.form === 'sale' ? errors[key]?.[0] : undefined);
	const schedule = $derived.by(() =>
		bond
			? buildInstallmentSchedule({
					paymentMode: mode as 'full_payment' | 'installments',
					firstDueDate: mode === 'full_payment' ? soldOn : due,
					totalAmount: bond.totalValue,
					installmentCount: data.campaign.installmentCount,
					installmentValue: data.campaign.installmentValue,
					commercialUnitCount: bond.commercialUnitCount
				})
			: []
	);
	const modeOptions = Object.entries(PAYMENT_MODE_LABELS).map(([value, label]) => ({
		value,
		label
	}));
	const typeOptions = [
		{ value: 'individual', label: 'Persona' },
		{ value: 'business', label: 'Empresa' }
	];
	/** The button says what it is about to register. */
	const confirmLabel = $derived(
		bond && buyerName
			? `Confirmar venta del bono ${numbers(bond)} a ${buyerName}`
			: bond
				? `Confirmar venta del bono ${numbers(bond)}`
				: 'Confirmar venta'
	);
	const stepTitle = 'm-0 text-heading-3 text-text';
	const change =
		'inline-flex min-h-touch items-center rounded-sm text-body-sm text-primary-text underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus';
</script>

<svelte:head
	><title>Registrar venta - {data.campaign.name} - {institutionName()}</title></svelte:head
>

<PageHeader
	title="Registrar venta"
	breadcrumbs={[
		{ label: 'Campañas', href: resolve('/campaigns') },
		{ label: data.campaign.name, href: resolve('/campaigns/[id]', { id: data.campaign.id }) },
		{ label: 'Ventas', href: resolve('/campaigns/[id]/sales', { id: data.campaign.id }) },
		{ label: 'Registrar venta' }
	]}
/>

<div class="max-w-[640px] space-y-8">
	<section aria-labelledby="step-bond" data-step="bond">
		<div class="border-b border-border-strong pb-2">
			<h2 id="step-bond" class={stepTitle}>Bono</h2>
		</div>
		{#if bond}
			<!-- Answered: one line, with the way to change it. -->
			<div class="flex flex-wrap items-center justify-between gap-x-4 py-2" data-chosen-bond>
				<p class="m-0 flex flex-wrap items-baseline gap-x-3 gap-y-1">
					<BondNumber number={numbers(bond)} size="md" />
					<span class="text-body">
						{bond.collectorName ? `Lo tiene ${bond.collectorName}` : 'Entregado a un cobrador'}
					</span>
				</p>
				<button type="button" class={change} onclick={() => (bondId = '')}>Cambiar el bono</button>
			</div>
		{:else}
			<form method="POST" action="?/lookup" use:enhance={lookup} class="mt-3 flex items-end gap-2">
				<div class="min-w-0 flex-1">
					<Field
						label="Número base, asociado o código"
						id="query"
						error={lookupError ||
							(form?.form === 'lookup' ? (errors.query?.[0] ?? form.message) : undefined)}
					>
						<TextInput name="query" mono bind:value={bondQuery} />
					</Field>
				</div>
				<Button type="submit" variant="primary" icon="search" loading={looking}>Buscar</Button>
			</form>
			{#if found}
				<fieldset class="m-0 mt-3 border-0 p-0">
					<legend class="sr-only">Bonos encontrados</legend>
					{#each found as item (item.id)}
						{#if item.sellable}
							<label
								class="flex min-h-touch cursor-pointer items-center gap-3 border-b border-border py-1 text-body"
							>
								<input
									type="radio"
									name="bondId"
									form="sale-form"
									bind:group={bondId}
									value={item.id}
									class="size-5 shrink-0 accent-primary"
								/>
								<BondNumber
									number={numbers(item)}
									associated={item.associatedNumbers.length
										? item.associatedNumbers.map((n) => formatPaddedNumber(n, digits)).join(' + ')
										: null}
									size="sm"
								/>
								<span class="text-body-sm text-muted">
									{item.collectorName ? `lo tiene ${item.collectorName}` : 'entregado'}, se puede
									vender
								</span>
							</label>
						{:else}
							<p class="m-0 border-b border-border py-3 text-body-sm text-muted">
								El bono <span class="font-medium text-text">{numbers(item)}</span> no se puede
								vender:
								{item.reason}
							</p>
						{/if}
					{:else}
						<EmptyState title="Ningún bono coincide">
							Revisar el número. Un bono disponible se tiene que entregar a un cobrador antes de
							venderlo.
						</EmptyState>
					{/each}
				</fieldset>
			{/if}
		{/if}
	</section>

	<section aria-labelledby="step-buyer" data-step="buyer">
		<div class="border-b border-border-strong pb-2">
			<h2 id="step-buyer" class={stepTitle}>Comprador</h2>
		</div>
		{#if buyerId && buyerName}
			<div class="flex flex-wrap items-center justify-between gap-x-4 py-2" data-chosen-buyer>
				<p class="m-0 text-body font-medium">{buyerName}</p>
				<button type="button" class={change} onclick={() => (buyerId = '')}
					>Cambiar el comprador</button
				>
			</div>
		{:else}
			<form method="GET" class="mt-3 flex items-end gap-2" onsubmit={searchBuyers} role="search">
				{#if data.bondQuery}<input type="hidden" name="bond" value={data.bondQuery} />{/if}
				<div class="min-w-0 flex-1">
					<Field label="Buscar por nombre, DNI o CUIT" id="buyer-search">
						<TextInput name="buyer" bind:value={buyerQuery} autocomplete="off" />
					</Field>
				</div>
				<Button type="submit" icon="search" loading={searching}>Buscar</Button>
			</form>
			{#if saleError('buyerId')}
				<p id="buyerId-error" class="m-0 mt-2 text-body-sm font-medium text-danger-text">
					{saleError('buyerId')}
				</p>
			{/if}
			<fieldset
				class="m-0 mt-3 border-0 p-0"
				aria-describedby={saleError('buyerId') ? 'buyerId-error' : undefined}
			>
				<legend class="sr-only">Compradores</legend>
				{#each data.buyers as buyer (buyer.id)}
					<label
						class="flex min-h-touch cursor-pointer items-center gap-3 border-b border-border py-1 text-body"
					>
						<input
							type="radio"
							name="buyerId"
							form="sale-form"
							bind:group={buyerId}
							value={buyer.id}
							class="size-5 shrink-0 accent-primary"
						/>
						<span class="min-w-0 flex-1">{buyerDisplayName(buyer)}</span>
						{#if buyerIdentification(buyer)}
							<span class="shrink-0 text-body-sm text-muted tabular-nums"
								>{buyerIdentification(buyer)}</span
							>
						{/if}
					</label>
				{:else}
					<p class="m-0 py-3 text-body-sm text-muted">
						{data.buyerSearch
							? `Ningún comprador coincide con «${data.buyerSearch}».`
							: 'Todavía no hay compradores.'}
					</p>
				{/each}
			</fieldset>
			{#if data.buyerTotal > data.buyers.length}
				<p class="m-0 mt-2 text-body-sm text-muted">
					Se muestran {data.buyers.length} de {data.buyerTotal}: buscar para acotar.
				</p>
			{/if}
			{#if data.canCreateBuyer}
				<div class="mt-4">
					<Disclosure summary="Crear un comprador" defaultOpen={!!buyerResult?.message}>
						<form
							method="POST"
							action="?/createBuyer"
							use:enhance={createBuyer}
							class="grid gap-4 sm:grid-cols-2"
						>
							<Field label="Tipo" id="buyer-type"
								><Select name="type" options={typeOptions} value="individual" /></Field
							>
							<Field label="Nombre" id="buyer-firstName" optional
								><TextInput name="firstName" /></Field
							>
							<Field label="Apellido" id="buyer-lastName" optional
								><TextInput name="lastName" /></Field
							>
							<Field label="Razón social" id="buyer-businessName" optional
								><TextInput name="businessName" /></Field
							>
							<Field label="DNI" id="buyer-documentNumber" optional
								><TextInput name="documentNumber" /></Field
							>
							<Field label="CUIT" id="buyer-taxId" optional><TextInput name="taxId" /></Field>
							<Field label="Teléfono" id="buyer-phone" optional
								><TextInput name="phone" type="tel" /></Field
							>
							<Field label="Dirección" id="buyer-address" optional
								><TextInput name="address" /></Field
							>
							<input type="hidden" name="usualCollectorId" value="" />
							<input type="hidden" name="notes" value="" />
							{#if buyerResult?.duplicates}
								<div class="sm:col-span-2">
									<Checkbox name="createAnyway" label={buyerResult.message ?? ''} />
								</div>
							{/if}
							<div><Button type="submit">Crear comprador</Button></div>
							{#if buyerResult?.message && !buyerResult.duplicates && !buyerResult.success}
								<div class="sm:col-span-2">
									<Alert tone="danger">{buyerResult.message}</Alert>
								</div>
							{/if}
						</form>
					</Disclosure>
				</div>
			{/if}
		{/if}
	</section>

	<section aria-labelledby="step-payment" data-step="payment">
		<div class="border-b border-border-strong pb-2">
			<h2 id="step-payment" class={stepTitle}>Pago</h2>
		</div>
		<form id="sale-form" method="POST" action="?/register" use:enhance class="mt-3 space-y-4">
			<!-- A collapsed step has no radio on the page: its answer travels here. -->
			{#if bond}<input type="hidden" name="bondId" value={bondId} />{/if}
			{#if buyerId && buyerName}<input
					type="hidden"
					name="buyerId"
					id="buyerId"
					value={buyerId}
				/>{/if}
			{#if saleError('bondId')}
				<div id="bondId-error"><Alert tone="danger">{saleError('bondId')}</Alert></div>
			{/if}
			<SegmentedControl
				legend="Modalidad"
				name="paymentMode"
				options={modeOptions}
				bind:value={mode}
			/>
			<div class="grid gap-4 sm:grid-cols-2">
				<Field
					label="Fecha de venta"
					id="saleDate"
					hint="Hoy, o la fecha original de una venta vieja."
					error={saleError('saleDate')}
				>
					<TextInput
						name="saleDate"
						type="date"
						bind:value={saleDate}
						min={data.saleDateBounds.min}
						max={data.saleDateBounds.max}
					/>
				</Field>
				{#if mode === 'installments'}
					<Field label="Primer vencimiento" id="firstDueDate" error={saleError('firstDueDate')}>
						<TextInput name="firstDueDate" type="date" bind:value={due} min={soldOn} max={dueMax} />
					</Field>
				{/if}
			</div>

			{#if schedule.length}
				<div>
					<h3 class="m-0 mb-1 text-label text-muted">
						{schedule.length === 1 ? 'Un pago' : `${schedule.length} cuotas`}
					</h3>
					<ol class="m-0 list-none p-0" aria-label="Plan de cuotas previsto">
						{#each schedule as installment (installment.number)}
							<li class="flex items-baseline justify-between gap-3 border-b border-border py-2">
								<span class="text-body">
									<span class="text-muted tabular-nums">{installment.number}.</span>
									Vence el {formatDate(installment.dueDate)}
								</span>
								<Money value={installment.amount} class="text-body font-medium" />
							</li>
						{/each}
					</ol>
				</div>
			{/if}
			{#if form?.form === 'sale' && form.message}<Alert tone="danger">{form.message}</Alert>{/if}
			<Button type="submit" variant="primary" size="lg" block data-confirm-sale
				>{confirmLabel}</Button
			>
		</form>
	</section>
</div>
