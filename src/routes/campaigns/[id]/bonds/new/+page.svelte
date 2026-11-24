<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import BaseNumberPreview from '$lib/components/bonds/BaseNumberPreview.svelte';
	import BondConflictLinks from '$lib/components/bonds/BondConflictLinks.svelte';
	import {
		Alert,
		Button,
		Card,
		Field,
		FormResult,
		PageHeader,
		StatusBadge,
		TextInput
	} from '$lib/components/ui';
	import { previewBaseNumber } from '$lib/domain/bond-preview';
	import { campaignNumberingConfig } from '$lib/domain/campaigns';
	import { buildNumberingPreview } from '$lib/domain/numbering-preview';
	import { formatNumber } from '$lib/format';
	import { BOND_CODE_MAX_LENGTH, BOND_ENTRY_INTENT_FIELD } from '$lib/schemas/bond';
	import type { PageProps } from './$types';

	/**
	 * Manual entry of simple bonds. "Guardar y cargar otro" (also what Enter does: it is the first
	 * submit button) keeps the operator on the form with the number cleared and focused, and
	 * confirms the bond just saved; "Guardar" opens the new bond's record.
	 */
	let { data, form }: PageProps = $props();

	const campaign = $derived(data.campaign);
	const config = $derived(campaignNumberingConfig(campaign));
	const numbering = $derived(buildNumberingPreview(config));
	const campaignHref = $derived(resolve('/campaigns/[id]', { id: campaign.id }));
	const bondHref = (bondId: string) =>
		resolve('/campaigns/[id]/bonds/[bondId]', { id: campaign.id, bondId });

	// Initial values only: afterwards the inputs own them (refilled from `form` without JS).
	function initialValues() {
		return {
			baseNumber: form?.values?.baseNumber ?? '',
			internalCode: form?.values?.internalCode ?? '',
			barcode: form?.values?.barcode ?? ''
		};
	}
	const values = $state(initialValues());
	let submitting = $state(false);
	// Bonds saved from this page (newest first), for the operator's own check while loading.
	function initialSaved() {
		return form?.success && form.created ? [form.created] : [];
	}
	let saved = $state(initialSaved());

	const preview = $derived(previewBaseNumber(values.baseNumber, config));
	// Server errors describe what was submitted: hide them once the field is edited.
	const submitted = $derived(form && !form.success ? (form.values ?? null) : null);
	function fieldErrors(field: 'baseNumber' | 'internalCode' | 'barcode') {
		if (!submitted || submitted[field] !== values[field]) return undefined;
		return form?.errors[field];
	}
	function fieldConflicts(field: string) {
		if (!submitted || submitted[field] !== values[field as keyof typeof values]) return [];
		return (form?.conflicts ?? []).filter((c) => c.field === field);
	}
	const baseNumberErrors = $derived(fieldErrors('baseNumber'));
	const internalCodeErrors = $derived(fieldErrors('internalCode'));
	const barcodeErrors = $derived(fieldErrors('barcode'));
	// The summary only lists the errors that still describe what is typed.
	const summaryErrors = $derived({
		baseNumber: baseNumberErrors,
		internalCode: internalCodeErrors,
		barcode: barcodeErrors
	});
	const SUMMARY_FIELDS = [
		{ name: 'baseNumber', label: 'Número base' },
		{ name: 'internalCode', label: 'Código interno' },
		{ name: 'barcode', label: 'Código de barras' }
	];

	function focusBaseNumber() {
		document.getElementById('baseNumber')?.focus();
	}
</script>

<svelte:head>
	<title>Cargar bonos - {campaign.name} - Firefighters</title>
</svelte:head>

<PageHeader
	title="Cargar bonos"
	description="Bonos simples, un número base por vez. Los bonos nuevos quedan disponibles para la venta."
	breadcrumbs={[
		{ label: 'Campañas', href: resolve('/campaigns') },
		{ label: campaign.name, href: campaignHref },
		{ label: 'Bonos', href: resolve('/campaigns/[id]/bonds', { id: campaign.id }) },
		{ label: 'Cargar bonos' }
	]}
>
	{#snippet actions()}
		<StatusBadge kind="campaign" status={campaign.status} />
	{/snippet}
</PageHeader>

<div class="flex flex-col gap-6">
	<p class="m-0 text-body-sm">
		<a
			href={resolve('/campaigns/[id]/bonds/pata/new', { id: campaign.id })}
			class="text-primary-text underline-offset-2 underline">Cargar una pata →</a
		>
	</p>

	{#if !data.canLoad}
		<Alert tone="warning" title="No se pueden cargar bonos">{data.lockedMessage}</Alert>
		<div><Button href={campaignHref}>Volver a la campaña</Button></div>
	{:else}
		{#if form?.success && form.created}
			<Alert tone="success">
				{form.message}
				<a href={bondHref(form.created.id)} class="font-medium underline">Ver bono</a>
			</Alert>
		{:else if form}
			<FormResult
				result={{ success: false, message: form.message, errors: summaryErrors }}
				fields={SUMMARY_FIELDS}
			/>
		{/if}

		<Card title="Bono simple" id="entry">
			<div class="flex flex-col gap-5">
				<p class="m-0 text-body-sm text-muted">
					Números de {campaign.numberDigits} dígitos hasta
					<span class="font-mono tabular-nums">{campaign.maxNumber}</span>; número asociado = base +
					<span class="tabular-nums">{campaign.associatedNumberOffset}</span>.
					{#if numbering.ok}
						Números base utilizables:
						<span class="font-mono tabular-nums"
							>{numbering.examples[0].baseFormatted}–{numbering.maxValidBase.baseFormatted}</span
						>
						({formatNumber(numbering.usableBaseCount)}).
					{/if}
				</p>
				{#if campaign.status === 'draft'}
					<Alert tone="warning">
						Esta campaña es un borrador. <strong>Guardar el primer bono congela sus reglas</strong>
						(precio, cuotas, numeración, política de desborde y modo de código de barras).
					</Alert>
				{/if}

				<form
					method="POST"
					class="flex flex-col gap-5"
					use:enhance={() => {
						submitting = true;
						return async ({ update, result }) => {
							try {
								await update({ reset: false });
								if (result.type === 'success' && result.data?.created) {
									saved = [result.data.created as (typeof saved)[number], ...saved].slice(0, 20);
									values.baseNumber = '';
									values.internalCode = '';
									values.barcode = '';
								}
							} finally {
								submitting = false;
								focusBaseNumber();
							}
						};
					}}
				>
					<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
						<div>
							<Field
								label="Número base"
								id="baseNumber"
								required
								hint="Con o sin ceros a la izquierda (68 o 0068)."
								error={baseNumberErrors?.[0]}
							>
								<TextInput
									name="baseNumber"
									type="text"
									inputmode="numeric"
									autocomplete="off"
									autofocus
									mono
									placeholder={'0'.repeat(campaign.numberDigits)}
									bind:value={values.baseNumber}
									aria-describedby="baseNumber-preview"
								/>
							</Field>
							<BondConflictLinks
								campaignId={campaign.id}
								conflicts={fieldConflicts('baseNumber')}
							/>
						</div>
						<div class="sm:pt-6">
							<BaseNumberPreview {preview} />
						</div>
					</div>

					<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
						<div>
							<Field
								label="Código interno"
								id="internalCode"
								optional
								error={internalCodeErrors?.[0]}
							>
								<TextInput
									name="internalCode"
									type="text"
									autocomplete="off"
									mono
									maxlength={BOND_CODE_MAX_LENGTH}
									bind:value={values.internalCode}
								/>
							</Field>
							<BondConflictLinks
								campaignId={campaign.id}
								conflicts={fieldConflicts('internalCode')}
							/>
						</div>
						<div>
							<Field label="Código de barras" id="barcode" optional error={barcodeErrors?.[0]}>
								<TextInput
									name="barcode"
									type="text"
									autocomplete="off"
									mono
									maxlength={BOND_CODE_MAX_LENGTH}
									bind:value={values.barcode}
								/>
							</Field>
							<BondConflictLinks campaignId={campaign.id} conflicts={fieldConflicts('barcode')} />
						</div>
					</div>

					<!-- "Guardar y cargar otro" is the first submit button, so Enter uses it. -->
					<div class="flex flex-wrap gap-2">
						<Button
							type="submit"
							variant="primary"
							name={BOND_ENTRY_INTENT_FIELD}
							value="another"
							loading={submitting}
							disabled={preview.state === 'invalid'}
						>
							{submitting ? 'Guardando…' : 'Guardar y cargar otro'}
						</Button>
						<Button
							type="submit"
							name={BOND_ENTRY_INTENT_FIELD}
							value="save"
							disabled={submitting || preview.state === 'invalid'}
						>
							Guardar
						</Button>
						<Button href={campaignHref} variant="ghost">Listo</Button>
					</div>
				</form>
			</div>
		</Card>

		{#if saved.length > 0}
			<Card title="Guardados desde esta página" id="saved">
				<ul class="m-0 list-none divide-y divide-border p-0 text-body-sm">
					{#each saved as bond (bond.id)}
						<li class="flex items-center justify-between py-2">
							<span class="font-mono tabular-nums"
								>{bond.baseFormatted} <span aria-hidden="true">→</span><span class="sr-only"
									>asociado</span
								>
								{bond.associatedFormatted}</span
							>
							<a
								href={bondHref(bond.id)}
								class="text-primary-text underline-offset-2 hover:underline">Ver</a
							>
						</li>
					{/each}
				</ul>
			</Card>
		{/if}
	{/if}
</div>
