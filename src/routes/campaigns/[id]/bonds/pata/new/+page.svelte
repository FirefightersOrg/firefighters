<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import BondConflictLinks from '$lib/components/bonds/BondConflictLinks.svelte';
	import PataNumbersPreview from '$lib/components/bonds/PataNumbersPreview.svelte';
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
	import { MIN_PATA_SIZE } from '$lib/domain/bonds';
	import { campaignNumberingConfig } from '$lib/domain/campaigns';
	import { formatInteger } from '$lib/domain/money';
	import { previewPata } from '$lib/domain/pata-preview';
	import { BOND_CODE_MAX_LENGTH } from '$lib/schemas/bond';
	import type { ResolvedPathname } from '$app/types';
	import type { PageProps } from './$types';

	/**
	 * Pata entry. "Printed pata": the N base numbers printed on the pata, typed at once.
	 * "Group simple bonds": pick N available simple bonds already loaded and join them in a manual
	 * pata (they keep their numbers). Both open the new pata's record when saved.
	 */
	let { data, form }: PageProps = $props();

	const campaign = $derived(data.campaign);
	const config = $derived(campaignNumberingConfig(campaign));
	const campaignHref = $derived(resolve('/campaigns/[id]', { id: campaign.id }));
	const pageHref = $derived(resolve('/campaigns/[id]/bonds/pata/new', { id: campaign.id }));
	const grouping = $derived(data.grouping);

	/** The query of this page in grouping mode, with the search and the picked bonds. */
	function groupingQuery(query: { q?: string; selected?: string[] }): string {
		const pairs = [['mode', 'grouping']];
		if (query.q) pairs.push(['q', query.q]);
		for (const id of query.selected ?? []) pairs.push(['selected', id]);
		return pairs.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
	}
	/**
	 * This page with a query. The pathname is `resolve()`d; only a search string is appended, which
	 * `ResolvedPathname` does not model (hence the cast).
	 */
	function pageWith(query: string): ResolvedPathname {
		return `${pageHref}?${query}` as ResolvedPathname;
	}
	const selectedIds = $derived(grouping?.selected.map((bond) => bond.id) ?? []);

	// Initial values only: afterwards the inputs own them (refilled from `form` without JS).
	function initialValues() {
		return {
			baseNumbers: form?.values?.baseNumbers ?? '',
			internalCode: form?.values?.internalCode ?? '',
			barcode: form?.values?.barcode ?? ''
		};
	}
	const values = $state(initialValues());
	let submitting = $state(false);

	const preview = $derived(previewPata(values.baseNumbers, config, campaign.simpleBondValue));
	const printedRows = $derived(
		preview.entries.map((entry, i) =>
			entry.preview.state === 'ok'
				? {
						key: `${i}`,
						baseFormatted: entry.preview.baseFormatted,
						associatedFormatted: entry.preview.associatedFormatted
					}
				: {
						key: `${i}`,
						baseFormatted: entry.typed,
						associatedFormatted: null,
						problem: entry.preview.message
					}
		)
	);

	const groupRows = $derived(
		(grouping?.selected ?? []).map((bond) => ({
			key: bond.id,
			baseFormatted: bond.baseFormatted,
			associatedFormatted: bond.associatedFormatted,
			problem: bond.problem
		}))
	);
	const groupProblems = $derived([
		...((grouping?.selected.length ?? 0) < MIN_PATA_SIZE
			? [`A pata needs at least ${MIN_PATA_SIZE} simple bonds`]
			: []),
		...(grouping?.selected.some((bond) => bond.problem)
			? ['Remove the bonds that cannot be grouped']
			: [])
	]);

	// Server errors describe what was submitted: hide them once the field is edited.
	const submitted = $derived(form && !form.success ? (form.values ?? null) : null);
	function fieldErrors(field: 'baseNumbers' | 'internalCode' | 'barcode') {
		if (!submitted || submitted[field] !== values[field]) return undefined;
		return form?.errors[field];
	}
	function fieldConflicts(field: string) {
		if (field !== 'memberBondIds') {
			if (!submitted || submitted[field] !== values[field as keyof typeof values]) return [];
		}
		return (form?.conflicts ?? []).filter((c) => c.field === field);
	}
	const formMessage = $derived(form && !form.success ? form.message : null);
</script>

<svelte:head>
	<title>Load a pata - {campaign.name} - Firefighters</title>
</svelte:head>

{#snippet codeFields()}
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
				aria-invalid={fieldErrors('internalCode')?.length ? 'true' : undefined}
				aria-describedby={fieldErrors('internalCode')?.length ? 'internalCode-error' : undefined}
				class={inputClass}
			/>
			<FieldError id="internalCode-error" errors={fieldErrors('internalCode')} />
			<BondConflictLinks campaignId={campaign.id} conflicts={fieldConflicts('internalCode')} />
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
				aria-invalid={fieldErrors('barcode')?.length ? 'true' : undefined}
				aria-describedby={fieldErrors('barcode')?.length ? 'barcode-error' : undefined}
				class={inputClass}
			/>
			<FieldError id="barcode-error" errors={fieldErrors('barcode')} />
			<BondConflictLinks campaignId={campaign.id} conflicts={fieldConflicts('barcode')} />
		</div>
	</div>
{/snippet}

<div class="space-y-6">
	<div>
		<a href={campaignHref} class="text-sm text-blue-700 hover:underline">← {campaign.name}</a>
		<div class="mt-2 flex flex-wrap items-center gap-3">
			<h1 class="text-2xl font-bold tracking-tight">Load a pata</h1>
			<CampaignStatusBadge status={campaign.status} />
		</div>
		<p class="text-sm text-slate-500">
			A pata sells N base numbers together: it is worth N simple bonds. New patas are available for
			sale.
			<a
				href={resolve('/campaigns/[id]/bonds/new', { id: campaign.id })}
				class="text-blue-700 hover:underline">Load simple bonds →</a
			>
		</p>
	</div>

	{#if !data.canLoad}
		<FormAlert kind="warning">
			<p><strong>Patas cannot be loaded.</strong> {data.lockedMessage}</p>
		</FormAlert>
		<a href={campaignHref} class={secondaryButtonClass}>Back to the campaign</a>
	{:else}
		<nav aria-label="Pata type" class="flex gap-2 border-b border-slate-200 text-sm">
			<a
				href={pageWith('mode=printed')}
				aria-current={data.mode === 'printed' ? 'page' : undefined}
				class="-mb-px border-b-2 px-3 py-2 font-medium {data.mode === 'printed'
					? 'border-blue-600 text-blue-700'
					: 'border-transparent text-slate-600 hover:text-slate-900'}">Printed pata</a
			>
			<a
				href={pageWith(groupingQuery({}))}
				aria-current={data.mode === 'grouping' ? 'page' : undefined}
				class="-mb-px border-b-2 px-3 py-2 font-medium {data.mode === 'grouping'
					? 'border-blue-600 text-blue-700'
					: 'border-transparent text-slate-600 hover:text-slate-900'}">Group simple bonds</a
			>
		</nav>

		{#if formMessage && formMessage !== 'Please correct the highlighted fields.'}
			<FormAlert message={formMessage} />
		{/if}

		{#if data.mode === 'printed'}
			<section class="{cardClass} space-y-4" aria-labelledby="printed-title">
				<h2 id="printed-title" class="text-base font-semibold">Printed pata</h2>
				<p class="text-sm text-slate-600">
					Type the {MIN_PATA_SIZE} or more base numbers printed on the pata. Each one brings its associated
					number (base + <span class="tabular-nums">{campaign.associatedNumberOffset}</span>).
				</p>
				{#if campaign.status === 'draft'}
					<FormAlert kind="warning">
						<p>
							This campaign is a draft. <strong>Saving the first bond freezes its rules</strong>
							(price, installments, numbering, overflow policy and barcode mode).
						</p>
					</FormAlert>
				{/if}
				{#if formMessage === 'Please correct the highlighted fields.'}
					<FormAlert message={formMessage} />
				{/if}

				<form
					method="POST"
					action="?/printed"
					class="space-y-4"
					use:enhance={() => {
						submitting = true;
						return async ({ update }) => {
							try {
								await update({ reset: false });
							} finally {
								submitting = false;
							}
						};
					}}
				>
					<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
						<div>
							<label for="baseNumbers" class={labelClass}>Base numbers</label>
							<textarea
								id="baseNumbers"
								name="baseNumbers"
								rows="4"
								required
								autocomplete="off"
								placeholder="68, 69, 70"
								bind:value={values.baseNumbers}
								aria-invalid={fieldErrors('baseNumbers')?.length ? 'true' : undefined}
								aria-describedby={fieldErrors('baseNumbers')?.length
									? 'pata-preview baseNumbers-error'
									: 'pata-preview'}
								class="{inputClass} font-mono tabular-nums"></textarea>
							<p class={hintClass}>
								Separated by commas, spaces or new lines. With or without leading zeros.
							</p>
							<FieldError id="baseNumbers-error" errors={fieldErrors('baseNumbers')} />
							<BondConflictLinks
								campaignId={campaign.id}
								conflicts={fieldConflicts('baseNumbers')}
							/>
						</div>
						<PataNumbersPreview
							rows={printedRows}
							problems={values.baseNumbers.trim() === '' ? [] : preview.problems}
							unitCount={preview.unitCount}
							totalValue={preview.totalValue}
							simpleBondValue={campaign.simpleBondValue}
							emptyText="Type the base numbers to see their associated numbers."
						/>
					</div>

					{@render codeFields()}

					<div class="flex flex-wrap justify-end gap-2">
						<a href={campaignHref} class={secondaryButtonClass}>Cancel</a>
						<button type="submit" disabled={submitting || !preview.ok} class={primaryButtonClass}>
							{submitting ? 'Saving…' : 'Save pata'}
						</button>
					</div>
				</form>
			</section>
		{:else if grouping}
			<section class="{cardClass} space-y-4" aria-labelledby="search-title">
				<h2 id="search-title" class="text-base font-semibold">Find simple bonds</h2>
				<p class="text-sm text-slate-600">
					Only available simple bonds that are not in another pata can be grouped. They keep their
					numbers and cannot be operated on their own while grouped.
				</p>
				<form method="GET" class="flex flex-wrap items-end gap-2" data-sveltekit-keepfocus>
					<input type="hidden" name="mode" value="grouping" />
					{#each selectedIds as id (id)}
						<input type="hidden" name="selected" value={id} />
					{/each}
					<div class="grow">
						<label for="q" class={labelClass}>From base number</label>
						<input
							id="q"
							name="q"
							type="text"
							inputmode="numeric"
							autocomplete="off"
							value={grouping.query}
							placeholder={'0'.repeat(campaign.numberDigits)}
							aria-invalid={grouping.searchError ? 'true' : undefined}
							aria-describedby="q-hint"
							class="{inputClass} font-mono tabular-nums"
						/>
					</div>
					<button type="submit" class={secondaryButtonClass}>Search</button>
				</form>
				<p id="q-hint" class={grouping.searchError ? 'text-xs text-red-600' : hintClass}>
					{grouping.searchError ??
						`Shows the first ${grouping.searchLimit} by base number, from the one typed.`}
				</p>

				{#if grouping.results.length === 0}
					<p class="text-sm text-slate-500">No simple bonds available for grouping.</p>
				{:else}
					<ul
						class="divide-y divide-slate-100 text-sm"
						aria-label="Simple bonds available for grouping"
					>
						{#each grouping.results as bond (bond.id)}
							<li class="flex items-center justify-between gap-3 py-2">
								<span class="font-mono tabular-nums"
									>{bond.baseFormatted} <span aria-hidden="true">→</span><span class="sr-only"
										>associated</span
									>
									{bond.associatedFormatted}
									{#if bond.internalCode}<span class="ml-2 font-sans text-xs text-slate-500"
											>{bond.internalCode}</span
										>{/if}</span
								>
								<a
									href={pageWith(
										groupingQuery({ q: grouping.query, selected: [...selectedIds, bond.id] })
									)}
									data-sveltekit-noscroll
									class="font-medium text-blue-700 hover:underline"
									aria-label={`Add bond ${bond.baseFormatted}`}>Add</a
								>
							</li>
						{/each}
					</ul>
				{/if}
			</section>

			<section class="{cardClass} space-y-4" aria-labelledby="group-title">
				<h2 id="group-title" class="text-base font-semibold">
					New pata ({formatInteger(grouping.selected.length)}
					{grouping.selected.length === 1 ? 'bond' : 'bonds'})
				</h2>
				{#if formMessage === 'Please correct the highlighted fields.'}
					<FormAlert message={formMessage} />
				{/if}
				{#if form && !form.success && form.errors.memberBondIds?.length}
					<div
						role="alert"
						class="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800"
					>
						<ul class="list-disc space-y-1 pl-5">
							{#each form.errors.memberBondIds as message, i (i)}
								<li>{message}</li>
							{/each}
						</ul>
						<BondConflictLinks
							campaignId={campaign.id}
							conflicts={fieldConflicts('memberBondIds')}
							kind="pata"
						/>
					</div>
				{/if}

				{#if grouping.selected.length > 0}
					<ul class="divide-y divide-slate-100 text-sm" aria-label="Bonds of the new pata">
						{#each grouping.selected as bond (bond.id)}
							<li class="flex items-center justify-between gap-3 py-2">
								<span>
									<span class="font-mono tabular-nums">{bond.baseFormatted ?? 'Unknown bond'}</span>
									{#if bond.problem}
										<span class="ml-2 text-xs text-red-700">{bond.problem}</span>
										{#if bond.pataId}
											<a
												href={resolve('/campaigns/[id]/bonds/[bondId]', {
													id: campaign.id,
													bondId: bond.pataId
												})}
												class="ml-1 text-xs font-medium text-blue-700 hover:underline">View pata</a
											>
										{/if}
									{/if}
								</span>
								<a
									href={pageWith(
										groupingQuery({
											q: grouping.query,
											selected: selectedIds.filter((id) => id !== bond.id)
										})
									)}
									data-sveltekit-noscroll
									class="text-blue-700 hover:underline"
									aria-label={`Remove bond ${bond.baseFormatted ?? ''}`.trim()}>Remove</a
								>
							</li>
						{/each}
					</ul>
				{/if}

				<PataNumbersPreview
					id="group-preview"
					rows={groupRows}
					problems={groupProblems}
					unitCount={grouping.unitCount}
					totalValue={grouping.totalValue}
					simpleBondValue={campaign.simpleBondValue}
					emptyText={`Add at least ${MIN_PATA_SIZE} simple bonds from the list.`}
				/>

				<form
					method="POST"
					action={`?/group&${groupingQuery({ q: grouping.query, selected: selectedIds })}`}
					class="space-y-4"
					use:enhance={() => {
						submitting = true;
						return async ({ update }) => {
							try {
								await update({ reset: false });
							} finally {
								submitting = false;
							}
						};
					}}
				>
					{#each selectedIds as id (id)}
						<input type="hidden" name="memberBondIds" value={id} />
					{/each}
					{@render codeFields()}
					<div class="flex flex-wrap justify-end gap-2">
						<a href={campaignHref} class={secondaryButtonClass}>Cancel</a>
						<button
							type="submit"
							disabled={submitting || groupProblems.length > 0}
							class={primaryButtonClass}
						>
							{submitting ? 'Saving…' : 'Create pata'}
						</button>
					</div>
				</form>
			</section>
		{/if}
	{/if}
</div>
