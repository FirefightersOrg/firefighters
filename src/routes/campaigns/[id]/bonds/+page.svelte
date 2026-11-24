<script lang="ts">
	import StatusBadge from '$lib/components/ui/StatusBadge.svelte';
	import { resolve } from '$app/paths';
	import type { ResolvedPathname } from '$app/types';
	import FieldError from '$lib/components/campaigns/FieldError.svelte';
	import {
		cardClass,
		hintClass,
		inputClass,
		labelClass,
		primaryButtonClass,
		secondaryButtonClass
	} from '$lib/components/campaigns/styles';
	import {
		BOND_COMMERCIAL_STATUSES,
		BOND_COMMERCIAL_STATUS_LABELS,
		BOND_FINANCIAL_STATUSES,
		BOND_FINANCIAL_STATUS_LABELS
	} from '$lib/domain/bonds';
	import { formatInteger, formatMoney } from '$lib/domain/money';
	import type { PageProps } from './$types';

	/**
	 * Bonds list: GET filters (they live in the query string, so the page works without
	 * JavaScript and can be bookmarked), server-side pages, quick actions and a link to each record.
	 */
	let { data }: PageProps = $props();

	const campaign = $derived(data.campaign);
	const values = $derived(data.query.values);
	const errors = $derived(data.query.errors);
	const pagination = $derived(data.pagination);
	const listHref = $derived(resolve('/campaigns/[id]/bonds', { id: campaign.id }));
	const firstRow = $derived((pagination.page - 1) * pagination.pageSize + 1);
	const lastRow = $derived(Math.min(pagination.total, pagination.page * pagination.pageSize));
	const showing = $derived(
		`Showing ${formatInteger(firstRow)}–${formatInteger(lastRow)} of ` +
			`${formatInteger(pagination.total)} ${pagination.total === 1 ? 'bond' : 'bonds'}`
	);

	/**
	 * This list at another page, keeping the filters. The pathname is `resolve()`d; only a search
	 * string is appended, which `ResolvedPathname` does not model (hence the cast).
	 */
	function pageLink(page: number): ResolvedPathname {
		const pairs = Object.entries(values).filter(([, value]) => value);
		if (page > 1) pairs.push(['page', String(page)]);
		const search = pairs.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
		return (search ? `${listHref}?${search}` : listHref) as ResolvedPathname;
	}
	const recordHref = (bondId: string) =>
		resolve('/campaigns/[id]/bonds/[bondId]', { id: campaign.id, bondId });
</script>

<svelte:head>
	<title>Bonds - {campaign.name} - Firefighters</title>
</svelte:head>

<div class="space-y-6">
	<div>
		<a
			href={resolve('/campaigns/[id]', { id: campaign.id })}
			class="text-sm text-blue-700 hover:underline">← {campaign.name}</a
		>
		<h1 class="mt-2 text-2xl font-bold tracking-tight">Bonds</h1>
	</div>

	<section aria-labelledby="quick-actions-title">
		<h2 id="quick-actions-title" class="sr-only">Quick actions</h2>
		<div class="flex flex-wrap items-center gap-3">
			{#if data.can.create}
				<a
					href={resolve('/campaigns/[id]/bonds/new', { id: campaign.id })}
					class={primaryButtonClass}>Create bond</a
				>
				<a
					href={resolve('/campaigns/[id]/bonds/pata/new', { id: campaign.id })}
					class={secondaryButtonClass}>Create pata</a
				>
			{/if}
			{#if data.can.scan}
				<a
					href={resolve('/campaigns/[id]/bonds/scan', { id: campaign.id })}
					class={secondaryButtonClass}>Scan bonds</a
				>
			{/if}
			{#if data.can.importFile}
				<a
					href={resolve('/campaigns/[id]/bonds/import', { id: campaign.id })}
					class={secondaryButtonClass}>Import file</a
				>
			{/if}
			<button
				type="button"
				class={secondaryButtonClass}
				disabled
				aria-describedby="assign-action-note">Assign to collector</button
			>
			<span id="assign-action-note" class="text-xs text-slate-500">Phase 6</span>
		</div>
	</section>

	<form method="GET" action={listHref} class={cardClass} aria-labelledby="filters-title">
		<h2 id="filters-title" class="mb-4 text-base font-semibold">Filters</h2>
		<div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
			<div>
				<label for="filter-base" class={labelClass}>Base number</label>
				<input
					id="filter-base"
					name="base"
					inputmode="numeric"
					autocomplete="off"
					class={inputClass}
					value={values.base}
					aria-invalid={errors.base ? 'true' : undefined}
					aria-describedby={errors.base ? 'filter-base-error' : undefined}
				/>
				<FieldError id="filter-base-error" errors={errors.base ? [errors.base] : undefined} />
			</div>
			<div>
				<label for="filter-associated" class={labelClass}>Associated number</label>
				<input
					id="filter-associated"
					name="associated"
					inputmode="numeric"
					autocomplete="off"
					class={inputClass}
					value={values.associated}
					aria-invalid={errors.associated ? 'true' : undefined}
					aria-describedby={errors.associated ? 'filter-associated-error' : undefined}
				/>
				<FieldError
					id="filter-associated-error"
					errors={errors.associated ? [errors.associated] : undefined}
				/>
			</div>
			<div>
				<label for="filter-code" class={labelClass}>Barcode or internal code</label>
				<input
					id="filter-code"
					name="code"
					autocomplete="off"
					class={inputClass}
					value={values.code}
					aria-invalid={errors.code ? 'true' : undefined}
					aria-describedby={errors.code ? 'filter-code-error' : 'filter-code-hint'}
				/>
				{#if errors.code}
					<FieldError id="filter-code-error" errors={[errors.code]} />
				{:else}
					<p id="filter-code-hint" class={hintClass}>Exact match.</p>
				{/if}
			</div>
			<div>
				<label for="filter-type" class={labelClass}>Type</label>
				<select id="filter-type" name="type" class={inputClass}>
					<option value="" selected={!values.type}>Any</option>
					<option value="simple" selected={values.type === 'simple'}>Simple bond</option>
					<option value="pata" selected={values.type === 'pata'}>Pata</option>
				</select>
				<FieldError id="filter-type-error" errors={errors.type ? [errors.type] : undefined} />
			</div>
			<div>
				<label for="filter-status" class={labelClass}>Commercial status</label>
				<select id="filter-status" name="status" class={inputClass}>
					<option value="" selected={!values.status}>Any</option>
					{#each BOND_COMMERCIAL_STATUSES as status (status)}
						<option value={status} selected={values.status === status}
							>{BOND_COMMERCIAL_STATUS_LABELS[status]}</option
						>
					{/each}
				</select>
				<FieldError id="filter-status-error" errors={errors.status ? [errors.status] : undefined} />
			</div>
			<div>
				<label for="filter-financial" class={labelClass}>Financial status</label>
				<select id="filter-financial" name="financial" class={inputClass}>
					<option value="" selected={!values.financial}>Any</option>
					{#each BOND_FINANCIAL_STATUSES as status (status)}
						<option value={status} selected={values.financial === status}
							>{BOND_FINANCIAL_STATUS_LABELS[status]}</option
						>
					{/each}
				</select>
				<FieldError
					id="filter-financial-error"
					errors={errors.financial ? [errors.financial] : undefined}
				/>
			</div>
			<div>
				<label for="filter-collector" class={labelClass}>Collector</label>
				<select id="filter-collector" class={inputClass} disabled aria-describedby="party-note">
					<option>Any</option>
				</select>
			</div>
			<div>
				<label for="filter-buyer" class={labelClass}>Buyer</label>
				<select id="filter-buyer" class={inputClass} disabled aria-describedby="party-note">
					<option>Any</option>
				</select>
			</div>
		</div>
		<p id="party-note" class={hintClass}>
			Collector and buyer filters arrive with collectors and buyers in Phase 5.
		</p>
		<div class="mt-4 flex flex-wrap gap-3">
			<button type="submit" class={primaryButtonClass}>Apply filters</button>
			{#if data.filtered}
				<a href={listHref} class={secondaryButtonClass}>Clear filters</a>
			{/if}
		</div>
	</form>

	<section aria-labelledby="results-title">
		<h2 id="results-title" class="sr-only">Results</h2>
		{#if Object.keys(errors).length > 0}
			<div class="{cardClass} text-sm text-red-700">Fix the highlighted filters to see bonds.</div>
		{:else if pagination.total === 0}
			<div class="{cardClass} text-center text-sm text-slate-500">
				{data.filtered ? 'No bonds match these filters.' : 'This campaign has no bonds yet.'}
			</div>
		{:else if data.bonds.length === 0}
			<div class="{cardClass} text-center text-sm text-slate-500">
				No bonds on this page. <a href={pageLink(1)} class="text-blue-700 hover:underline"
					>Go to the first page</a
				>
			</div>
		{:else}
			<p class="mb-2 text-sm text-slate-600" aria-live="polite">
				{showing}
			</p>
			<div class="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
				<table class="min-w-full divide-y divide-slate-200 text-sm">
					<thead
						class="bg-slate-50 text-left text-xs font-semibold tracking-wider text-slate-500 uppercase"
					>
						<tr>
							<th scope="col" class="px-4 py-3">Base</th>
							<th scope="col" class="px-4 py-3">Associated</th>
							<th scope="col" class="px-4 py-3">Type</th>
							<th scope="col" class="px-4 py-3">Codes</th>
							<th scope="col" class="px-4 py-3">Status</th>
							<th scope="col" class="px-4 py-3">Financial</th>
							<th scope="col" class="px-4 py-3 text-right">Value</th>
							<th scope="col" class="px-4 py-3"><span class="sr-only">Record</span></th>
						</tr>
					</thead>
					<tbody class="divide-y divide-slate-100">
						{#each data.bonds as bond (bond.id)}
							<tr class="hover:bg-slate-50" data-bond-id={bond.id}>
								<td class="px-4 py-3 font-mono font-semibold tabular-nums">
									{bond.baseFormatted.join(' + ') || '—'}
								</td>
								<td class="px-4 py-3 font-mono tabular-nums text-slate-600">
									{bond.associatedFormatted.join(' + ') || '—'}
								</td>
								<td class="px-4 py-3">
									{bond.typeLabel}{#if bond.kind === 'pata'}
										<span class="text-slate-500"> ({bond.unitCount})</span>{/if}
									{#if bond.inPata}
										<div class="text-xs text-slate-500">
											In pata
											<a
												href={recordHref(bond.inPata.pataId)}
												class="font-mono text-blue-700 hover:underline">{bond.inPata.label}</a
											>
										</div>
									{/if}
								</td>
								<td class="px-4 py-3 text-xs text-slate-600">
									{#if bond.barcode}<div>
											Barcode <span class="font-mono">{bond.barcode}</span>
										</div>{/if}
									{#if bond.internalCode}<div>
											Internal <span class="font-mono">{bond.internalCode}</span>
										</div>{/if}
									{#if !bond.barcode && !bond.internalCode}—{/if}
								</td>
								<td class="px-4 py-3"
									><StatusBadge kind="bondCommercial" status={bond.commercialStatus} /></td
								>
								<td class="px-4 py-3 text-slate-600">
									{BOND_FINANCIAL_STATUS_LABELS[bond.financialStatus]}
								</td>
								<td class="px-4 py-3 text-right whitespace-nowrap tabular-nums">
									{formatMoney(bond.totalValue)}
								</td>
								<td class="px-4 py-3 text-right">
									<a href={recordHref(bond.id)} class="font-medium text-blue-700 hover:underline"
										>View record</a
									>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}

		{#if pagination.pageCount > 1 || pagination.page > 1}
			<nav aria-label="Pagination" class="mt-4 flex items-center justify-between text-sm">
				{#if pagination.page > 1}
					<a href={pageLink(pagination.page - 1)} rel="prev" class={secondaryButtonClass}
						>← Previous</a
					>
				{:else}
					<span></span>
				{/if}
				<span class="text-slate-600"
					>Page {formatInteger(pagination.page)} of {formatInteger(pagination.pageCount)}</span
				>
				{#if pagination.page < pagination.pageCount}
					<a href={pageLink(pagination.page + 1)} rel="next" class={secondaryButtonClass}>Next →</a>
				{:else}
					<span></span>
				{/if}
			</nav>
		{/if}
	</section>
</div>
