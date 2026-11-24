<script lang="ts">
	import StatusBadge from '$lib/components/ui/StatusBadge.svelte';
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import type { ResolvedPathname } from '$app/types';
	import FieldError from '$lib/components/campaigns/FieldError.svelte';
	import FormAlert from '$lib/components/campaigns/FormAlert.svelte';
	import {
		cardClass,
		dangerButtonClass,
		inputClass,
		labelClass,
		primaryButtonClass,
		secondaryButtonClass
	} from '$lib/components/campaigns/styles';
	import RiskyOperationChecklist from '$lib/components/backups/RiskyOperationChecklist.svelte';
	import ImportSummaryPanel from '$lib/components/imports/ImportSummaryPanel.svelte';
	import {
		IMPORT_ITEM_FILTERS,
		IMPORT_SOURCE_LABELS,
		canConfirmImport,
		canValidateImport,
		formatImportNumber,
		type ImportItemFilter
	} from '$lib/domain/import-preview';
	import type { ImportItem } from '$lib/server/repositories/imports';
	import { formatInteger } from '$lib/domain/money';
	import type { PageProps } from './$types';

	/**
	 * Preview of an import: the seven metrics, the rows filtered by status, row correction and
	 * removal while the session is open, then validate → confirm. Confirm stays disabled while
	 * there is any blocking error (the database revalidates on confirmation anyway).
	 */
	let { data, form }: PageProps = $props();

	const campaign = $derived(data.campaign);
	const session = $derived(data.session);
	const summary = $derived(data.summary);
	const isScan = $derived(session.sourceType === 'barcode_scan');
	const backHref = $derived(
		isScan
			? resolve('/campaigns/[id]/bonds/scan', { id: campaign.id })
			: resolve('/campaigns/[id]/bonds/import', { id: campaign.id })
	);
	const scanHref = $derived(
		`${resolve('/campaigns/[id]/bonds/scan', { id: campaign.id })}?session=${session.id}` as ResolvedPathname
	);
	const bondsHref = $derived(resolve('/campaigns/[id]/bonds', { id: campaign.id }));
	const bondHref = (bondId: string) =>
		resolve('/campaigns/[id]/bonds/[bondId]', { id: campaign.id, bondId });

	const FILTER_LABELS: Record<ImportItemFilter, string> = {
		all: 'All rows',
		valid: 'Valid',
		warning: 'Warnings',
		error: 'Errors'
	};
	const previewHref = $derived(
		resolve('/campaigns/[id]/bonds/import/[sessionId]', { id: campaign.id, sessionId: session.id })
	);
	/**
	 * This preview with another filter or page. The pathname is `resolve()`d; only a search string
	 * is appended, which `ResolvedPathname` does not model (hence the cast).
	 */
	function previewLink(filter: ImportItemFilter, target = 1): ResolvedPathname {
		const pairs: string[] = [];
		if (filter !== 'all') pairs.push(`status=${filter}`);
		if (target > 1) pairs.push(`page=${target}`);
		return (pairs.length ? `${previewHref}?${pairs.join('&')}` : previewHref) as ResolvedPathname;
	}
	const pageCount = $derived(Math.max(1, Math.ceil(data.total / data.pageSize)));

	const number = (value: number | null) => formatImportNumber(value, campaign.numberDigits);
	const associated = (value: number | null) =>
		formatImportNumber(
			value === null ? null : value + campaign.associatedNumberOffset,
			campaign.numberDigits
		);

	let editing = $state<string | null>(null);
	let busy = $state<string | null>(null);
	const canConfirm = $derived(data.canEdit && canConfirmImport(summary));
	const canValidate = $derived(data.canEdit && canValidateImport(summary));
	const justConfirmed = $derived(data.justConfirmed);
	const dateTime = new Intl.DateTimeFormat('es-AR', { dateStyle: 'short', timeStyle: 'short' });

	/** The failed edit of this row, to keep its form open with the typed values. */
	const editFailure = (item: ImportItem) =>
		form && !form.success && form.form === 'update' && form.itemId === item.id ? form : null;

	function submitting(key: string) {
		return () => {
			busy = key;
			return async ({ update }: { update: (o?: { reset?: boolean }) => Promise<void> }) => {
				await update({ reset: false });
				busy = null;
			};
		};
	}
</script>

<svelte:head>
	<title>Import preview - {campaign.name} - Firefighters</title>
</svelte:head>

<div class="space-y-6">
	<div>
		<a href={backHref} class="text-sm text-blue-700 hover:underline"
			>← {isScan ? 'Barcode scanner' : 'File imports'}</a
		>
		<div class="mt-2 flex flex-wrap items-center gap-3">
			<h1 class="text-2xl font-bold tracking-tight">
				{isScan ? 'Scan batch' : session.fileName}
			</h1>
			<StatusBadge
				kind="importSession"
				status={session.rolledBackAt !== null ? 'rolled_back' : session.status}
			/>
		</div>
		<p class="text-sm text-slate-500">
			{IMPORT_SOURCE_LABELS[session.sourceType]} · {campaign.name} · started {dateTime.format(
				new Date(session.createdAt)
			)}
			{#if session.notes}· {session.notes}{/if}
		</p>
	</div>

	{#if justConfirmed && session.status === 'confirmed'}
		<FormAlert kind="success">
			<p>
				Import confirmed: the bonds were created and are available.
				<a href={bondsHref} class="font-medium underline">View the bonds</a>
			</p>
		</FormAlert>
	{:else if form?.message}
		<FormAlert kind={form.success ? 'success' : 'error'} message={form.message} />
	{/if}

	{#if session.status === 'cancelled'}
		<FormAlert kind="warning">
			<p>
				This import was cancelled{session.cancelReason ? `: ${session.cancelReason}` : ''}. No bond
				was created.
			</p>
		</FormAlert>
	{:else if session.rolledBackAt}
		<FormAlert kind="warning">
			<p>
				This import was rolled back on {dateTime.format(new Date(session.rolledBackAt))}: its bonds
				were annulled ({session.rollbackReason}).
			</p>
		</FormAlert>
	{:else if data.lockedMessage}
		<FormAlert kind="warning"><p>{data.lockedMessage}</p></FormAlert>
	{/if}

	<section class="space-y-3" aria-labelledby="summary-title">
		<h2 id="summary-title" class="sr-only">Summary</h2>
		<ImportSummaryPanel {summary} />
	</section>

	{#if data.canEdit}
		<RiskyOperationChecklist
			campaignId={data.campaign.id}
			operation="confirmar una importación masiva"
			canExport={data.canExport}
		/>
		<section class="{cardClass} flex flex-wrap items-center gap-3" aria-label="Import actions">
			<form method="POST" action="?/validate" use:enhance={submitting('validate')}>
				<button
					type="submit"
					class={secondaryButtonClass}
					disabled={!canValidate || busy !== null}
					title={summary.status === 'validated' ? 'Already validated' : undefined}
				>
					{busy === 'validate' ? 'Validating…' : 'Validate'}
				</button>
			</form>
			<form method="POST" action="?/confirm" use:enhance={submitting('confirm')}>
				<button
					type="submit"
					class={primaryButtonClass}
					disabled={!canConfirm || busy !== null}
					aria-describedby="confirm-hint"
				>
					{busy === 'confirm'
						? 'Creating bonds…'
						: `Confirm and create ${formatInteger(summary.simpleItems + summary.pataGroups)} bonds`}
				</button>
			</form>
			{#if isScan}
				<a href={scanHref} class={secondaryButtonClass}>Keep scanning</a>
			{/if}
			<form
				method="POST"
				action="?/cancel"
				class="ml-auto"
				use:enhance={({ cancel }) => {
					if (
						!confirm('Cancel this import? Its rows are kept as history and no bond is created.')
					) {
						cancel();
						return;
					}
					return submitting('cancel')();
				}}
			>
				<button type="submit" class={secondaryButtonClass} disabled={busy !== null}>
					Cancel import
				</button>
			</form>
			<p id="confirm-hint" class="w-full text-xs text-slate-500">
				{#if summary.errors > 0}
					Confirm is disabled: correct or remove the {formatInteger(summary.errors)} rows with errors.
				{:else if summary.status !== 'validated'}
					Validate the import to enable Confirm.
				{:else}
					Confirming creates every bond in one step. A mistaken import can be rolled back later by
					an administrator.
				{/if}
			</p>
		</section>
	{/if}

	{#if data.canRollBack}
		<section class="{cardClass} space-y-3" aria-labelledby="rollback-title">
			<h2 id="rollback-title" class="text-base font-semibold">Roll back this import</h2>
			<p class="text-sm text-slate-600">
				Annuls the available bonds of this import and releases their numbers and codes. Bonds
				already annulled by hand are left as they are. Only possible while none of them was
				delivered, sold or grouped into a pata.
			</p>
			<form
				method="POST"
				action="?/rollback"
				class="space-y-3"
				use:enhance={submitting('rollback')}
			>
				<div>
					<label for="rollback-reason" class={labelClass}>Reason</label>
					<input
						id="rollback-reason"
						name="reason"
						required
						maxlength="2000"
						class={inputClass}
						value={form?.form === 'rollback' ? (form.values?.reason ?? '') : ''}
						aria-invalid={form?.form === 'rollback' && form.errors?.reason ? 'true' : undefined}
					/>
					<FieldError
						id="rollback-reason-error"
						errors={form?.form === 'rollback' ? form.errors?.reason : undefined}
					/>
				</div>
				<button type="submit" class={dangerButtonClass} disabled={busy !== null}>
					{busy === 'rollback' ? 'Rolling back…' : 'Roll back import'}
				</button>
			</form>
		</section>
	{/if}

	<section class="{cardClass} space-y-4" aria-labelledby="rows-title">
		<div class="flex flex-wrap items-center justify-between gap-3">
			<h2 id="rows-title" class="text-base font-semibold">Rows</h2>
			<nav aria-label="Filter rows by status" class="flex flex-wrap gap-1">
				{#each IMPORT_ITEM_FILTERS as filter (filter)}
					<a
						href={previewLink(filter)}
						aria-current={data.filter === filter ? 'page' : undefined}
						class="rounded-full px-3 py-1 text-sm {data.filter === filter
							? 'bg-blue-600 text-white'
							: 'bg-slate-100 text-slate-700 hover:bg-slate-200'}"
					>
						{FILTER_LABELS[filter]}
						{#if filter === 'error' && summary.errors > 0}({formatInteger(summary.errors)}){/if}
						{#if filter === 'warning' && summary.warnings > 0}({formatInteger(
								summary.warnings
							)}){/if}
					</a>
				{/each}
			</nav>
		</div>

		{#if data.items.length === 0}
			<p class="text-sm text-slate-500">No rows match this filter.</p>
		{:else}
			<div class="overflow-x-auto">
				<table class="min-w-full text-sm">
					<thead class="text-left text-xs text-slate-500 uppercase">
						<tr>
							<th class="py-2 pr-3 font-medium">Row</th>
							<th class="py-2 pr-3 font-medium">Status</th>
							<th class="py-2 pr-3 font-medium">Type</th>
							<th class="py-2 pr-3 font-medium">Pata</th>
							<th class="py-2 pr-3 font-medium">Base / associated</th>
							<th class="py-2 pr-3 font-medium">Barcode</th>
							<th class="py-2 pr-3 font-medium">Problem</th>
							<th class="py-2 font-medium"><span class="sr-only">Actions</span></th>
						</tr>
					</thead>
					<tbody class="divide-y divide-slate-100">
						{#each data.items as item (item.id)}
							{@const removed = item.removedAt !== null}
							{@const failure = editFailure(item)}
							<tr class={removed ? 'text-slate-400' : ''}>
								<td class="py-2 pr-3 tabular-nums">{item.rowNumber}</td>
								<td class="py-2 pr-3"
									><StatusBadge kind="importItem" status={removed ? 'removed' : item.status} /></td
								>
								<td class="py-2 pr-3">{item.itemType ?? '—'}</td>
								<td class="py-2 pr-3">{item.groupKey ?? '—'}</td>
								<td class="py-2 pr-3 font-mono tabular-nums">
									{number(item.baseNumber)} / {associated(item.baseNumber)}
								</td>
								<td class="py-2 pr-3 font-mono">{item.barcode ?? '—'}</td>
								<td class="py-2 pr-3 text-xs">
									{#if removed}
										Removed{item.removeReason ? `: ${item.removeReason}` : ''}
									{:else if item.errorMessage}
										<span class={item.status === 'error' ? 'text-red-700' : 'text-amber-800'}
											>{item.errorMessage}</span
										>
									{/if}
									{#if item.createdBondId}
										<a href={bondHref(item.createdBondId)} class="text-blue-700 hover:underline"
											>View bond →</a
										>
									{/if}
								</td>
								<td class="py-2 text-right whitespace-nowrap">
									{#if data.canEdit && !removed}
										<button
											type="button"
											class="text-sm text-blue-700 hover:underline"
											aria-expanded={editing === item.id || !!failure}
											onclick={() => (editing = editing === item.id ? null : item.id)}
										>
											Edit
										</button>
										<form
											method="POST"
											action="?/remove"
											class="ml-3 inline"
											use:enhance={({ cancel }) => {
												if (!confirm(`Remove row ${item.rowNumber} from this import?`)) {
													cancel();
													return;
												}
												return submitting(`remove-${item.id}`)();
											}}
										>
											<input type="hidden" name="itemId" value={item.id} />
											<button
												type="submit"
												class="text-sm text-red-700 hover:underline"
												disabled={busy !== null}
											>
												Remove
											</button>
										</form>
									{/if}
								</td>
							</tr>
							{#if data.canEdit && !removed && (editing === item.id || failure)}
								<tr>
									<td colspan="8" class="bg-slate-50 px-3 py-3">
										<form
											method="POST"
											action="?/update"
											class="grid gap-3 sm:grid-cols-5 sm:items-end"
											use:enhance={() => {
												busy = `update-${item.id}`;
												return async ({ result, update }) => {
													await update({ reset: false });
													busy = null;
													if (result.type === 'success') editing = null;
												};
											}}
										>
											<input type="hidden" name="itemId" value={item.id} />
											<div>
												<label for="type-{item.id}" class={labelClass}>Type</label>
												<select
													id="type-{item.id}"
													name="itemType"
													class={inputClass}
													value={failure?.values?.itemType ?? item.itemType ?? 'simple'}
												>
													<option value="simple">simple</option>
													<option value="pata">pata</option>
												</select>
												<FieldError id="type-{item.id}-error" errors={failure?.errors?.itemType} />
											</div>
											<div>
												<label for="group-{item.id}" class={labelClass}>grupo_pata</label>
												<input
													id="group-{item.id}"
													name="groupKey"
													maxlength="200"
													class={inputClass}
													value={failure?.values?.groupKey ?? item.groupKey ?? ''}
												/>
												<FieldError id="group-{item.id}-error" errors={failure?.errors?.groupKey} />
											</div>
											<div>
												<label for="base-{item.id}" class={labelClass}>Base number</label>
												<input
													id="base-{item.id}"
													name="baseNumber"
													inputmode="numeric"
													required
													class="{inputClass} font-mono"
													value={failure?.values?.baseNumber ??
														(item.baseNumber === null ? '' : number(item.baseNumber))}
												/>
												<FieldError
													id="base-{item.id}-error"
													errors={failure?.errors?.baseNumber}
												/>
											</div>
											<div>
												<label for="barcode-{item.id}" class={labelClass}>Barcode</label>
												<input
													id="barcode-{item.id}"
													name="barcode"
													maxlength="200"
													class="{inputClass} font-mono"
													value={failure?.values?.barcode ?? item.barcode ?? ''}
												/>
												<FieldError
													id="barcode-{item.id}-error"
													errors={failure?.errors?.barcode}
												/>
											</div>
											<div class="flex gap-2">
												<button type="submit" class={primaryButtonClass} disabled={busy !== null}>
													{busy === `update-${item.id}` ? 'Saving…' : 'Save'}
												</button>
												<button
													type="button"
													class={secondaryButtonClass}
													onclick={() => (editing = null)}>Close</button
												>
											</div>
											<p class="text-xs text-slate-500 sm:col-span-5">
												Source row: <code class="font-mono">{item.rawValue}</code>
											</p>
										</form>
									</td>
								</tr>
							{/if}
						{/each}
					</tbody>
				</table>
			</div>
			{#if pageCount > 1}
				<nav aria-label="Pages" class="flex items-center justify-between text-sm">
					<span class="text-slate-500"
						>Page {data.page} of {pageCount} · {formatInteger(data.total)} rows</span
					>
					<span class="flex gap-2">
						{#if data.page > 1}<a
								href={previewLink(data.filter, data.page - 1)}
								class={secondaryButtonClass}>Previous</a
							>{/if}
						{#if data.page < pageCount}<a
								href={previewLink(data.filter, data.page + 1)}
								class={secondaryButtonClass}>Next</a
							>{/if}
					</span>
				</nav>
			{/if}
		{/if}
	</section>
</div>
