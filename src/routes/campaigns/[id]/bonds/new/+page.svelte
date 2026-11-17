<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import BaseNumberPreview from '$lib/components/bonds/BaseNumberPreview.svelte';
	import CampaignStatusBadge from '$lib/components/campaigns/CampaignStatusBadge.svelte';
	import FieldError from '$lib/components/campaigns/FieldError.svelte';
	import FormAlert from '$lib/components/campaigns/FormAlert.svelte';
	import {
		cardClass,
		hintClass,
		inputClass,
		labelClass,
		primaryButtonClass,
		secondaryButtonClass
	} from '$lib/components/campaigns/styles';
	import { previewBaseNumber } from '$lib/domain/bond-preview';
	import { campaignNumberingConfig } from '$lib/domain/campaigns';
	import { formatInteger } from '$lib/domain/money';
	import { buildNumberingPreview } from '$lib/domain/numbering-preview';
	import { BOND_CODE_MAX_LENGTH, BOND_ENTRY_INTENT_FIELD } from '$lib/schemas/bond';
	import type { PageProps } from './$types';

	/**
	 * Manual entry of simple bonds. "Save & add another" (also what Enter does: it is the first
	 * submit button) keeps the operator on the form with the number cleared and focused, and
	 * confirms the bond just saved; "Save" opens the new bond's record.
	 */
	let { data, form }: PageProps = $props();

	const campaign = $derived(data.campaign);
	const config = $derived(campaignNumberingConfig(campaign));
	const numbering = $derived(buildNumberingPreview(config));
	const campaignHref = $derived(resolve('/campaigns/[id]', { id: campaign.id }));
	// The bond record is /campaigns/[id]/bonds/[bondId], built in SAN-26: switch these links to
	// `resolve('/campaigns/[id]/bonds/[bondId]', ...)` once that route exists.
	const bondHref = (bondId: string) => `${campaignHref}/bonds/${bondId}`;

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
	let baseNumberInput = $state<HTMLInputElement>();
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
	const showServerErrors = $derived(!!baseNumberErrors?.length);
	const baseNumberDescribedBy = $derived(
		showServerErrors ? 'baseNumber-preview baseNumber-error' : 'baseNumber-preview'
	);
</script>

<svelte:head>
	<title>Load bonds - {campaign.name} - Firefighters</title>
</svelte:head>

{#snippet conflictLinks(field: string)}
	{#each fieldConflicts(field) as conflict (conflict.bondId)}
		<p class="mt-1 text-xs">
			<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- bond record route: SAN-26 -->
			<a href={bondHref(conflict.bondId)} class="font-medium text-blue-700 hover:underline">
				{conflict.numbers.length > 0
					? `View the bond that uses ${conflict.numbers.join(', ')} →`
					: 'View the bond that uses it →'}
			</a>
		</p>
	{/each}
{/snippet}

<div class="space-y-6">
	<div>
		<a href={campaignHref} class="text-sm text-blue-700 hover:underline">← {campaign.name}</a>
		<div class="mt-2 flex flex-wrap items-center gap-3">
			<h1 class="text-2xl font-bold tracking-tight">Load bonds</h1>
			<CampaignStatusBadge status={campaign.status} />
		</div>
		<p class="text-sm text-slate-500">
			Simple bonds, one base number at a time. New bonds are available for sale.
		</p>
	</div>

	{#if !data.canLoad}
		<FormAlert kind="warning">
			<p><strong>Bonds cannot be loaded.</strong> {data.lockedMessage}</p>
		</FormAlert>
		<a href={campaignHref} class={secondaryButtonClass}>Back to the campaign</a>
	{:else}
		{#if form?.success && form.created}
			<FormAlert kind="success">
				<p>
					{form.message}
					<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- bond record route: SAN-26 -->
					<a href={bondHref(form.created.id)} class="font-medium underline">View bond</a>
				</p>
			</FormAlert>
		{:else if form?.message && !form.success}
			<FormAlert message={form.message} />
		{/if}

		<section class="{cardClass} space-y-4" aria-labelledby="entry-title">
			<h2 id="entry-title" class="text-base font-semibold">Simple bond</h2>
			<p class="text-sm text-slate-600">
				{campaign.numberDigits}-digit numbers up to
				<span class="font-mono tabular-nums">{campaign.maxNumber}</span>; associated number = base +
				<span class="tabular-nums">{campaign.associatedNumberOffset}</span>.
				{#if numbering.ok}
					Usable base numbers:
					<span class="font-mono tabular-nums"
						>{numbering.examples[0].baseFormatted}–{numbering.maxValidBase.baseFormatted}</span
					>
					({formatInteger(numbering.usableBaseCount)}).
				{/if}
			</p>
			{#if campaign.status === 'draft'}
				<FormAlert kind="warning">
					<p>
						This campaign is a draft. <strong>Saving the first bond freezes its rules</strong> (price,
						installments, numbering, overflow policy and barcode mode).
					</p>
				</FormAlert>
			{/if}

			<form
				method="POST"
				class="space-y-4"
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
							baseNumberInput?.focus();
						}
					};
				}}
			>
				<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
					<div>
						<label for="baseNumber" class={labelClass}>Base number</label>
						<!-- svelte-ignore a11y_autofocus -->
						<input
							bind:this={baseNumberInput}
							id="baseNumber"
							name="baseNumber"
							type="text"
							inputmode="numeric"
							autocomplete="off"
							required
							autofocus
							placeholder={'0'.repeat(campaign.numberDigits)}
							bind:value={values.baseNumber}
							aria-invalid={preview.state === 'invalid' || showServerErrors ? 'true' : undefined}
							aria-describedby={baseNumberDescribedBy}
							class="{inputClass} font-mono text-lg tabular-nums"
						/>
						<p class={hintClass}>With or without leading zeros (68 or 0068).</p>
						<FieldError id="baseNumber-error" errors={baseNumberErrors} />
						{@render conflictLinks('baseNumber')}
					</div>
					<div class="sm:pt-6">
						<BaseNumberPreview {preview} />
					</div>
				</div>

				<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
					<div>
						<label for="internalCode" class={labelClass}>Internal code (optional)</label>
						<input
							id="internalCode"
							name="internalCode"
							type="text"
							autocomplete="off"
							maxlength={BOND_CODE_MAX_LENGTH}
							bind:value={values.internalCode}
							aria-invalid={internalCodeErrors?.length ? 'true' : undefined}
							aria-describedby={internalCodeErrors?.length ? 'internalCode-error' : undefined}
							class={inputClass}
						/>
						<FieldError id="internalCode-error" errors={internalCodeErrors} />
						{@render conflictLinks('internalCode')}
					</div>
					<div>
						<label for="barcode" class={labelClass}>Barcode (optional)</label>
						<input
							id="barcode"
							name="barcode"
							type="text"
							autocomplete="off"
							maxlength={BOND_CODE_MAX_LENGTH}
							bind:value={values.barcode}
							aria-invalid={barcodeErrors?.length ? 'true' : undefined}
							aria-describedby={barcodeErrors?.length ? 'barcode-error' : undefined}
							class={inputClass}
						/>
						<FieldError id="barcode-error" errors={barcodeErrors} />
						{@render conflictLinks('barcode')}
					</div>
				</div>

				<!-- "Save & add another" comes first in the DOM, so Enter uses it; shown last. -->
				<div class="flex flex-row-reverse flex-wrap justify-start gap-2">
					<button
						type="submit"
						name={BOND_ENTRY_INTENT_FIELD}
						value="another"
						disabled={submitting || preview.state === 'invalid'}
						class={primaryButtonClass}
					>
						{submitting ? 'Saving…' : 'Save & add another'}
					</button>
					<button
						type="submit"
						name={BOND_ENTRY_INTENT_FIELD}
						value="save"
						disabled={submitting || preview.state === 'invalid'}
						class={secondaryButtonClass}
					>
						Save
					</button>
					<a href={campaignHref} class={secondaryButtonClass}>Done</a>
				</div>
			</form>
		</section>

		{#if saved.length > 0}
			<section class={cardClass} aria-labelledby="saved-title">
				<h2 id="saved-title" class="mb-3 text-base font-semibold">Saved from this page</h2>
				<ul class="divide-y divide-slate-100 text-sm">
					{#each saved as bond (bond.id)}
						<li class="flex items-center justify-between py-2">
							<span class="font-mono tabular-nums"
								>{bond.baseFormatted} <span aria-hidden="true">→</span><span class="sr-only"
									>associated</span
								>
								{bond.associatedFormatted}</span
							>
							<!-- eslint-disable-next-line svelte/no-navigation-without-resolve -- bond record route: SAN-26 -->
							<a href={bondHref(bond.id)} class="text-blue-700 hover:underline">View</a>
						</li>
					{/each}
				</ul>
			</section>
		{/if}
	{/if}
</div>
