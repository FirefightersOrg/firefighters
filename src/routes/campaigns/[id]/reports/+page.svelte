<script lang="ts">
	import { resolve } from '$app/paths';
	import {
		cardClass,
		inputClass,
		labelClass,
		primaryButtonClass,
		secondaryButtonClass
	} from '$lib/components/campaigns/styles';
	import {
		BOND_COMMERCIAL_STATUSES,
		BOND_COMMERCIAL_STATUS_LABELS,
		BOND_FINANCIAL_STATUSES,
		BOND_FINANCIAL_STATUS_LABELS,
		BOND_KIND_LABELS,
		BOND_KINDS,
		type BondCommercialStatus,
		type BondFinancialStatus
	} from '$lib/domain/bonds';
	import { formatInteger, formatMoney } from '$lib/domain/money';
	import {
		formatMonthLabel,
		INSTALLMENT_BUCKET_LABELS,
		INSTALLMENT_BUCKETS
	} from '$lib/domain/reports';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
	const campaign = $derived(data.campaign);
	const filters = $derived(data.filters);
	const matrix = $derived(data.bondsByStatus);
	const commercialLabel = (s: string) =>
		BOND_COMMERCIAL_STATUS_LABELS[s as BondCommercialStatus] ?? s;
	const financialLabel = (s: string) => BOND_FINANCIAL_STATUS_LABELS[s as BondFinancialStatus] ?? s;

	const th = 'px-3 py-2 text-left font-semibold text-slate-700';
	const thRight = 'px-3 py-2 text-right font-semibold text-slate-700';
	const td = 'px-3 py-2 text-slate-800';
	const tdRight = 'px-3 py-2 text-right tabular-nums text-slate-800';
</script>

<svelte:head><title>Operational reports - {campaign.name} - Firefighters</title></svelte:head>

<div class="space-y-6">
	<div>
		<a
			href={resolve('/campaigns/[id]', { id: campaign.id })}
			class="text-sm text-blue-700 hover:underline">← {campaign.name}</a
		>
		<h1 class="mt-2 text-2xl font-bold tracking-tight">Operational reports</h1>
		<p class="mt-1 text-sm text-slate-600">
			Read-only views of the current data. Financial status is the bond's last recalculated status
			(updated when a settlement closes). Dates are Buenos Aires dates.
		</p>
	</div>

	<form method="GET" class="{cardClass} grid gap-3 sm:grid-cols-3 lg:grid-cols-4 sm:items-end">
		<div>
			<label class={labelClass} for="collector">Collector</label>
			<select class={inputClass} id="collector" name="collector">
				<option value="">All</option>
				{#each data.collectors as c (c.id)}
					<option value={c.id} selected={filters.collectorId === c.id}>{c.displayName}</option>
				{/each}
				{#if filters.collectorId && !data.collectors.some((c) => c.id === filters.collectorId)}
					<option value={filters.collectorId} selected>Selected collector</option>
				{/if}
			</select>
		</div>
		<div>
			<label class={labelClass} for="kind">Bond type</label>
			<select class={inputClass} id="kind" name="kind">
				<option value="">All</option>
				{#each BOND_KINDS as k (k)}
					<option value={k} selected={filters.kind === k}>{BOND_KIND_LABELS[k]}</option>
				{/each}
			</select>
		</div>
		<div>
			<label class={labelClass} for="status">Commercial status</label>
			<select class={inputClass} id="status" name="status">
				<option value="">All</option>
				{#each BOND_COMMERCIAL_STATUSES as s (s)}
					<option value={s} selected={filters.commercialStatus === s}
						>{BOND_COMMERCIAL_STATUS_LABELS[s]}</option
					>
				{/each}
			</select>
		</div>
		<div>
			<label class={labelClass} for="financial">Financial status</label>
			<select class={inputClass} id="financial" name="financial">
				<option value="">All</option>
				{#each BOND_FINANCIAL_STATUSES as s (s)}
					<option value={s} selected={filters.financialStatus === s}
						>{BOND_FINANCIAL_STATUS_LABELS[s]}</option
					>
				{/each}
			</select>
		</div>
		<div>
			<label class={labelClass} for="month">Month (monthly summary)</label>
			<input class={inputClass} id="month" name="month" type="month" value={filters.month} />
		</div>
		<div>
			<label class={labelClass} for="from">Installments due from</label>
			<input class={inputClass} id="from" name="from" type="date" value={filters.from ?? ''} />
		</div>
		<div>
			<label class={labelClass} for="to">Installments due to</label>
			<input class={inputClass} id="to" name="to" type="date" value={filters.to ?? ''} />
		</div>
		<div class="flex gap-2">
			<button type="submit" class={primaryButtonClass}>Apply</button>
			<a href={resolve('/campaigns/[id]/reports', { id: campaign.id })} class={secondaryButtonClass}
				>Clear</a
			>
		</div>
	</form>

	<section class={cardClass} aria-labelledby="by-status-title">
		<h2 id="by-status-title" class="mb-3 text-base font-semibold">
			Bonds by commercial and financial status
		</h2>
		{#if matrix.bondCount === 0}
			<p class="text-sm text-slate-500">No bonds match the filters.</p>
		{:else}
			<div class="overflow-x-auto">
				<table class="min-w-full divide-y divide-slate-200 text-sm">
					<thead>
						<tr>
							<th class={th}>Commercial status</th>
							{#each matrix.financialStatuses as f (f)}
								<th class={thRight}>{financialLabel(f)}</th>
							{/each}
							<th class={thRight}>Bonds</th>
							<th class={thRight}>Value</th>
						</tr>
					</thead>
					<tbody class="divide-y divide-slate-100">
						{#each matrix.commercialStatuses as c (c)}
							<tr>
								<td class={td}>{commercialLabel(c)}</td>
								{#each matrix.financialStatuses as f (f)}
									<td class={tdRight}>{formatInteger(matrix.cells[c]?.[f] ?? 0)}</td>
								{/each}
								<td class={tdRight}>{formatInteger(matrix.commercialTotals[c]!.bondCount)}</td>
								<td class={tdRight}>{formatMoney(matrix.commercialTotals[c]!.totalValue)}</td>
							</tr>
						{/each}
					</tbody>
					<tfoot>
						<tr class="font-semibold">
							<td class={td}>Total</td>
							{#each matrix.financialStatuses as f (f)}
								<td class={tdRight}>{formatInteger(matrix.financialTotals[f] ?? 0)}</td>
							{/each}
							<td class={tdRight}>{formatInteger(matrix.bondCount)}</td>
							<td class={tdRight}>{formatMoney(matrix.totalValue)}</td>
						</tr>
					</tfoot>
				</table>
			</div>
		{/if}
	</section>

	<section class={cardClass} aria-labelledby="by-collector-title">
		<h2 id="by-collector-title" class="mb-3 text-base font-semibold">Bonds by collector</h2>
		{#if data.bondsByCollector.rows.length === 0}
			<p class="text-sm text-slate-500">No bonds match the filters.</p>
		{:else}
			<div class="overflow-x-auto">
				<table class="min-w-full divide-y divide-slate-200 text-sm">
					<thead>
						<tr>
							<th class={th}>Collector</th>
							<th class={thRight}>Bonds</th>
							<th class={thRight}>Delivered</th>
							<th class={thRight}>Sold</th>
							<th class={thRight}>Returned</th>
							<th class={thRight}>Value</th>
							<th class={thRight}>Sold value</th>
						</tr>
					</thead>
					<tbody class="divide-y divide-slate-100">
						{#each data.bondsByCollector.rows as r (r.collectorId ?? 'unassigned')}
							<tr>
								<td class={td}>
									{#if r.collectorId}
										<a
											class="text-blue-700 hover:underline"
											href={resolve('/campaigns/[id]/collectors/[collectorId]', {
												id: campaign.id,
												collectorId: r.collectorId
											})}>{r.collectorName ?? 'Collector'}</a
										>
									{:else}
										<span class="text-slate-500">Unassigned</span>
									{/if}
								</td>
								<td class={tdRight}>{formatInteger(r.bondCount)}</td>
								<td class={tdRight}>{formatInteger(r.deliveredCount)}</td>
								<td class={tdRight}>{formatInteger(r.soldCount)}</td>
								<td class={tdRight}>{formatInteger(r.returnedCount)}</td>
								<td class={tdRight}>{formatMoney(r.totalValue)}</td>
								<td class={tdRight}>{formatMoney(r.soldValue)}</td>
							</tr>
						{/each}
					</tbody>
					<tfoot>
						<tr class="font-semibold">
							<td class={td}>Total</td>
							<td class={tdRight}>{formatInteger(data.bondsByCollector.totals.bondCount)}</td>
							<td class={tdRight}>{formatInteger(data.bondsByCollector.totals.deliveredCount)}</td>
							<td class={tdRight}>{formatInteger(data.bondsByCollector.totals.soldCount)}</td>
							<td class={tdRight}>{formatInteger(data.bondsByCollector.totals.returnedCount)}</td>
							<td class={tdRight}>{formatMoney(data.bondsByCollector.totals.totalValue)}</td>
							<td class={tdRight}>{formatMoney(data.bondsByCollector.totals.soldValue)}</td>
						</tr>
					</tfoot>
				</table>
			</div>
		{/if}
	</section>

	<section class={cardClass} aria-labelledby="installments-title">
		<h2 id="installments-title" class="mb-1 text-base font-semibold">
			Installments: pending, paid, advance and overdue
		</h2>
		<p class="mb-3 text-xs text-slate-500">
			Active sales only. Overdue includes pending installments past their due date. Each cell shows
			count and amount.
		</p>
		{#if data.installments.collectors.length === 0}
			<p class="text-sm text-slate-500">No installments match the filters.</p>
		{:else}
			<div class="overflow-x-auto">
				<table class="min-w-full divide-y divide-slate-200 text-sm">
					<thead>
						<tr>
							<th class={th}>Collector</th>
							{#each INSTALLMENT_BUCKETS as b (b)}
								<th class={thRight}>{INSTALLMENT_BUCKET_LABELS[b]}</th>
							{/each}
						</tr>
					</thead>
					<tbody class="divide-y divide-slate-100">
						{#each data.installments.collectors as c (c.collectorId)}
							<tr>
								<td class={td}>{c.collectorName}</td>
								{#each INSTALLMENT_BUCKETS as b (b)}
									<td class={tdRight}
										>{formatInteger(c.buckets[b].count)} · {formatMoney(c.buckets[b].amount)}</td
									>
								{/each}
							</tr>
						{/each}
					</tbody>
					<tfoot>
						<tr class="font-semibold">
							<td class={td}>Total</td>
							{#each INSTALLMENT_BUCKETS as b (b)}
								<td class={tdRight}
									>{formatInteger(data.installments.totals[b].count)} · {formatMoney(
										data.installments.totals[b].amount
									)}</td
								>
							{/each}
						</tr>
					</tfoot>
				</table>
			</div>
		{/if}
	</section>

	<section class={cardClass} aria-labelledby="monthly-title">
		<h2 id="monthly-title" class="mb-1 text-base font-semibold">
			Monthly summary per collector: {formatMonthLabel(filters.month)}
		</h2>
		<p class="mb-3 text-xs text-slate-500">
			Assigned bonds are those held today. Sold = sales registered in the month. Installments are
			those due in the month and still unpaid. Payments exclude drafts and annulled payments.
		</p>
		{#if data.monthly.rows.length === 0}
			<p class="text-sm text-slate-500">No collector activity in this month.</p>
		{:else}
			<div class="overflow-x-auto">
				<table class="min-w-full divide-y divide-slate-200 text-sm">
					<thead>
						<tr>
							<th class={th}>Collector</th>
							<th class={thRight}>Assigned</th>
							<th class={thRight}>Sold</th>
							<th class={thRight}>Sold value</th>
							<th class={thRight}>Pending inst.</th>
							<th class={thRight}>Overdue inst.</th>
							<th class={thRight}>Payments</th>
							<th class={thRight}>Cash</th>
							<th class={thRight}>Transfer</th>
							<th class={thRight}>Collected</th>
						</tr>
					</thead>
					<tbody class="divide-y divide-slate-100">
						{#each data.monthly.rows as r (r.collectorId)}
							<tr>
								<td class={td}>
									<a
										class="text-blue-700 hover:underline"
										href={resolve('/campaigns/[id]/collectors/[collectorId]', {
											id: campaign.id,
											collectorId: r.collectorId
										})}>{r.collectorName}</a
									>
								</td>
								<td class={tdRight}>{formatInteger(r.assignedBonds)}</td>
								<td class={tdRight}>{formatInteger(r.soldBonds)}</td>
								<td class={tdRight}>{formatMoney(r.soldValue)}</td>
								<td class={tdRight}
									>{formatInteger(r.pendingInstallments)} · {formatMoney(r.pendingAmount)}</td
								>
								<td class={tdRight}
									>{formatInteger(r.overdueInstallments)} · {formatMoney(r.overdueAmount)}</td
								>
								<td class={tdRight}>{formatInteger(r.paymentsCount)}</td>
								<td class={tdRight}>{formatMoney(r.paymentsCash)}</td>
								<td class={tdRight}>{formatMoney(r.paymentsTransfer)}</td>
								<td class={tdRight}>{formatMoney(r.paymentsTotal)}</td>
							</tr>
						{/each}
					</tbody>
					<tfoot>
						<tr class="font-semibold">
							<td class={td}>Total</td>
							<td class={tdRight}>{formatInteger(data.monthly.totals.assignedBonds)}</td>
							<td class={tdRight}>{formatInteger(data.monthly.totals.soldBonds)}</td>
							<td class={tdRight}>{formatMoney(data.monthly.totals.soldValue)}</td>
							<td class={tdRight}
								>{formatInteger(data.monthly.totals.pendingInstallments)} · {formatMoney(
									data.monthly.totals.pendingAmount
								)}</td
							>
							<td class={tdRight}
								>{formatInteger(data.monthly.totals.overdueInstallments)} · {formatMoney(
									data.monthly.totals.overdueAmount
								)}</td
							>
							<td class={tdRight}>{formatInteger(data.monthly.totals.paymentsCount)}</td>
							<td class={tdRight}>{formatMoney(data.monthly.totals.paymentsCash)}</td>
							<td class={tdRight}>{formatMoney(data.monthly.totals.paymentsTransfer)}</td>
							<td class={tdRight}>{formatMoney(data.monthly.totals.paymentsTotal)}</td>
						</tr>
					</tfoot>
				</table>
			</div>
		{/if}
	</section>
</div>
