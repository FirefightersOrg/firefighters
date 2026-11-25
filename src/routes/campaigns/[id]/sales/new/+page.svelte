<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import {
		Alert,
		Button,
		Card,
		Checkbox,
		Disclosure,
		EmptyState,
		Field,
		PageHeader,
		Select,
		TextInput
	} from '$lib/components/ui';
	import { PAYMENT_MODE_LABELS, buildInstallmentSchedule } from '$lib/domain/sales';
	import { formatDate, formatMoney } from '$lib/format';
	import { buyerDisplayName } from '$lib/domain/parties';
	import type { PageProps } from './$types';
	let { data, form }: PageProps = $props();
	let selectedBond = $state('');
	let selectedBuyer = $state('');
	let mode = $state('full_payment');
	let due = $state('');
	let saleDate = $state('');
	const soldOn = $derived(saleDate || data.today);
	/** Client mirror of the server bounds: [sale date, sale date + 365 days]. */
	const dueMax = $derived.by(() => {
		const [y, m, d] = soldOn.split('-').map(Number);
		return new Date(Date.UTC(y, m - 1, d + 365)).toISOString().slice(0, 10);
	});
	const errors = $derived((form?.errors ?? {}) as Record<string, string[]>);
	const selectedCandidate = $derived(
		form?.form === 'lookup' ? form.found?.find((bond) => bond.id === selectedBond) : undefined
	);
	$effect(() => {
		if (!due) due = data.today;
		if (!saleDate) saleDate = data.today;
	});
	$effect(() => {
		if (form?.form === 'buyer' && form.success && form.buyerId) selectedBuyer = form.buyerId;
	});
	const schedule = $derived.by(() =>
		selectedBond
			? buildInstallmentSchedule({
					paymentMode: mode as 'full_payment' | 'installments',
					firstDueDate: mode === 'full_payment' ? soldOn : due,
					totalAmount: selectedCandidate?.totalValue ?? data.campaign.simpleBondValue,
					installmentCount: data.campaign.installmentCount,
					installmentValue: data.campaign.installmentValue,
					commercialUnitCount: selectedCandidate?.commercialUnitCount ?? 1
				})
			: []
	);
	const saleError = (key: string) => (form?.form === 'sale' ? errors[key]?.[0] : undefined);
	const buyerOptions = $derived([
		{ value: '', label: 'Elegir comprador' },
		...(form?.form === 'buyer' &&
		form.success &&
		form.buyerId &&
		!data.buyers.some((b) => b.id === form.buyerId)
			? [{ value: form.buyerId as string, label: form.buyerName as string }]
			: []),
		...data.buyers.map((buyer) => ({ value: buyer.id, label: buyerDisplayName(buyer) }))
	]);
	const modeOptions = Object.entries(PAYMENT_MODE_LABELS).map(([value, label]) => ({
		value,
		label
	}));
	const typeOptions = [
		{ value: 'individual', label: 'Persona' },
		{ value: 'business', label: 'Empresa' }
	];
</script>

<svelte:head><title>Registrar venta - {data.campaign.name}</title></svelte:head>

<PageHeader
	title="Registrar venta"
	breadcrumbs={[
		{ label: 'Campañas', href: resolve('/campaigns') },
		{ label: data.campaign.name, href: resolve('/campaigns/[id]', { id: data.campaign.id }) },
		{ label: 'Ventas', href: resolve('/campaigns/[id]/sales', { id: data.campaign.id }) },
		{ label: 'Registrar venta' }
	]}
/>

<div class="space-y-6">
	<Card title="1. Buscar un bono entregado">
		<form method="POST" action="?/lookup" use:enhance class="flex items-end gap-2">
			<Field
				label="Número base, asociado o código"
				id="query"
				error={form?.form === 'lookup' ? errors.query?.[0] : undefined}
			>
				<TextInput name="query" mono />
			</Field>
			<Button type="submit" variant="primary" icon="search">Buscar</Button>
		</form>
		{#if form?.form === 'lookup'}
			<fieldset class="mt-4 space-y-2">
				<legend class="sr-only">Bonos encontrados</legend>
				{#each form.found ?? [] as bond (bond.id)}
					{#if bond.sellable}
						<label class="flex items-center gap-2 text-body">
							<input
								type="radio"
								bind:group={selectedBond}
								value={bond.id}
								class="size-5 accent-primary"
							/>
							<span
								>Bono <span class="font-mono"
									>{bond.baseNumbers.join(', ')}{bond.associatedNumbers.length
										? ` / ${bond.associatedNumbers.join(', ')}`
										: ''}</span
								> — entregado, se puede vender</span
							>
						</label>
					{:else}
						<p class="text-body-sm text-muted">
							El bono <span class="font-mono">{bond.baseNumbers.join(', ')}</span> no se puede
							vender: {bond.reason}
						</p>
					{/if}
				{:else}
					<EmptyState title="Ningún bono entregado coincide">
						Los bonos disponibles se tienen que entregar primero; los vendidos, extraviados,
						anulados y los que integran una pata no se pueden vender.
					</EmptyState>
				{/each}
			</fieldset>
		{/if}
	</Card>

	<Card title="2. Comprador">
		<form method="GET" class="flex items-end gap-2">
			<Field label="Buscar compradores" id="buyer-search">
				<TextInput name="buyer" value={data.buyerSearch} />
			</Field>
			<Button type="submit" icon="search">Buscar</Button>
		</form>
		{#if data.buyerTotal > data.buyers.length}
			<p class="mt-2 text-body-sm text-muted">
				Se muestran los primeros {data.buyers.length} de {data.buyerTotal}; afinar la búsqueda.
			</p>
		{/if}
		<div class="mt-4">
			<Field label="Comprador" id="buyerId" required error={saleError('buyerId')}>
				<Select options={buyerOptions} bind:value={selectedBuyer} />
			</Field>
		</div>
		{#if data.canCreateBuyer}
			<div class="mt-4">
				<Disclosure summary="Crear un comprador">
					<form method="POST" action="?/createBuyer" use:enhance class="grid gap-4 sm:grid-cols-2">
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
						<Field label="Dirección" id="buyer-address" optional><TextInput name="address" /></Field
						>
						<input type="hidden" name="usualCollectorId" value="" />
						<input type="hidden" name="notes" value="" />
						{#if form?.form === 'buyer' && form.duplicates}
							<div class="sm:col-span-2">
								<Checkbox name="createAnyway" label={form.message ?? ''} />
							</div>
						{/if}
						<div><Button type="submit">Crear comprador</Button></div>
						{#if form?.form === 'buyer' && form.message && !form.duplicates}
							<div class="sm:col-span-2">
								<Alert tone={form.success ? 'success' : 'danger'}>{form.message}</Alert>
							</div>
						{/if}
					</form>
				</Disclosure>
			</div>
		{/if}
	</Card>

	<Card title="3. Modalidad y plan">
		<form method="POST" action="?/register" use:enhance class="space-y-4">
			<input type="hidden" name="bondId" value={selectedBond} />
			<input type="hidden" name="buyerId" value={selectedBuyer} />
			{#if saleError('bondId')}<div id="bondId-error">
					<Alert tone="danger">{saleError('bondId')}</Alert>
				</div>{/if}
			<p class="text-body-sm text-muted">
				Cobrador: {selectedCandidate?.collectorName ?? 'elegir un bono para ver quién lo tiene.'}
			</p>
			<Field
				label="Fecha de venta"
				id="saleDate"
				hint="Para cargar una venta vieja con su fecha original. No puede ser futura."
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
			<Field label="Modalidad" id="paymentMode" error={saleError('paymentMode')}>
				<Select name="paymentMode" options={modeOptions} bind:value={mode} />
			</Field>
			{#if mode === 'installments'}
				<Field label="Primer vencimiento" id="firstDueDate" error={saleError('firstDueDate')}>
					<TextInput name="firstDueDate" type="date" bind:value={due} min={soldOn} max={dueMax} />
				</Field>
			{/if}
			<h3 class="text-heading-3">4. Vista previa del plan</h3>
			{#if schedule.length}
				<div class="overflow-x-auto">
					<table class="w-full max-w-md border-collapse text-body-sm">
						<caption class="sr-only">Plan de cuotas previsto</caption>
						<thead>
							<tr class="border-b border-border text-left text-label text-muted">
								<th scope="col" class="px-3 py-2 text-right">N.º</th>
								<th scope="col" class="px-3 py-2">Vencimiento</th>
								<th scope="col" class="px-3 py-2 text-right">Importe</th>
							</tr>
						</thead>
						<tbody>
							{#each schedule as installment (installment.number)}
								<tr class="border-b border-border last:border-b-0">
									<td class="px-3 py-2 text-right tabular-nums">{installment.number}</td>
									<td class="px-3 py-2">{formatDate(installment.dueDate)}</td>
									<td class="px-3 py-2 text-right tabular-nums"
										>{formatMoney(installment.amount, { decimals: 'always' })}</td
									>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{:else}
				<p class="text-body-sm text-muted">Elegir un bono para ver el plan.</p>
			{/if}
			{#if form?.form === 'sale' && form.message}<Alert tone="danger">{form.message}</Alert>{/if}
			<Button type="submit" variant="primary">Confirmar venta</Button>
		</form>
	</Card>
</div>
