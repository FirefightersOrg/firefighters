<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import FieldError from '$lib/components/campaigns/FieldError.svelte';
	import FormAlert from '$lib/components/campaigns/FormAlert.svelte';
	import {
		cardClass,
		inputClass,
		labelClass,
		primaryButtonClass,
		secondaryButtonClass
	} from '$lib/components/campaigns/styles';
	import { BOND_COMMERCIAL_STATUS_LABELS } from '$lib/domain/bonds';
	import { deliveryNoteLabel } from '$lib/domain/deliveries';
	import { campaignNumberingConfig } from '$lib/domain/campaigns';
	import { formatCampaignNumber } from '$lib/domain/numbering';
	import { COLLECTOR_STATUSES, COLLECTOR_STATUS_LABELS } from '$lib/domain/parties';
	import { formatMoney } from '$lib/domain/money';
	import {
		formatCommissionRuleType,
		formatCommissionValue,
		formatValidity
	} from '$lib/domain/commissions';
	import type { PageProps } from './$types';
	let { data, form }: PageProps = $props();
	let submitting = $state(false);
	const numbering = $derived(campaignNumberingConfig(data.campaign));
	/** "0068 / 4939" for a simple bond, "Pata 0100, 0101" for a pata. */
	function bondLabel(bond: { kind: string; baseNumbers: number[]; associatedNumbers: number[] }) {
		const fmt = (numbers: number[]) =>
			numbers.map((n) => formatCampaignNumber(n, numbering)).join(', ');
		return bond.kind === 'simple'
			? `${fmt(bond.baseNumbers)} / ${fmt(bond.associatedNumbers)}`
			: `Pata ${fmt(bond.baseNumbers)}`;
	}
	const sections = [
		'General data',
		'Assigned bonds',
		'Associated buyers',
		'Pending installments',
		'Settlements',
		'Current account',
		'Monthly report',
		'Audit'
	];
	const canBulk = $derived(data.custody.can.returnBonds || data.custody.can.reassignBonds);
	/** A bulk return / reassignment result (its errors belong to section 2, not the edit form). */
	const custodyForm = $derived(
		form && 'form' in form && form.form === 'custody'
			? (form as { errors?: Record<string, string[]> })
			: null
	);
	const collectorForm = $derived(
		(custodyForm ? { message: form?.message, success: form?.success } : (form ?? {})) as {
			success?: boolean;
			message?: string;
			values?: Record<string, string>;
			errors?: Record<string, string[]>;
		}
	);
</script>

<svelte:head
	><title>{data.collector.displayName} - {data.campaign.name} - Firefighters</title></svelte:head
>
<div class="space-y-6">
	<div>
		<nav class="text-sm">
			<a
				href={resolve('/campaigns/[id]', { id: data.campaign.id })}
				class="text-blue-700 hover:underline">← {data.campaign.name}</a
			>
			/
			<a
				href={resolve('/campaigns/[id]/collectors', { id: data.campaign.id })}
				class="text-blue-700 hover:underline">Collectors</a
			>
		</nav>
		<h1 class="mt-2 text-2xl font-bold">{data.collector.displayName}</h1>
		<nav class="mt-3 text-xs">
			{#each sections as section, i (section)}<a
					href="#section-{i + 1}"
					class="mr-3 text-blue-700 hover:underline">{i + 1}. {section}</a
				>{/each}
		</nav>
	</div>
	{#if collectorForm.message}<FormAlert
			kind={collectorForm.success ? 'success' : 'error'}
			message={collectorForm.message}
		/>{/if}
	<section id="section-1" class={cardClass}>
		<h2 class="mb-4 text-base font-semibold">1. General data</h2>
		{#if data.can.manage}<form
				method="POST"
				action="?/update"
				use:enhance={() => {
					submitting = true;
					return async ({ update }) => {
						await update();
						submitting = false;
					};
				}}
				class="space-y-4"
			>
				<input type="hidden" name="updatedAt" value={data.collector.updatedAt} />
				<div>
					<label class={labelClass} for="displayName">Display name</label><input
						class={inputClass}
						id="displayName"
						name="displayName"
						value={collectorForm.values?.displayName ?? data.collector.displayName}
					/><FieldError id="displayName-error" errors={collectorForm.errors?.displayName} />
				</div>
				<div class="grid gap-4 sm:grid-cols-2">
					<div>
						<label class={labelClass} for="phone">Phone</label><input
							class={inputClass}
							id="phone"
							name="phone"
							value={collectorForm.values?.phone ?? data.collector.phone ?? ''}
						/><FieldError id="phone-error" errors={collectorForm.errors?.phone} />
					</div>
					<div>
						<label class={labelClass} for="email">Email</label><input
							class={inputClass}
							id="email"
							name="email"
							value={collectorForm.values?.email ?? data.collector.email ?? ''}
						/><FieldError id="email-error" errors={collectorForm.errors?.email} />
					</div>
				</div>
				<div>
					<label class={labelClass} for="address">Address</label><input
						class={inputClass}
						id="address"
						name="address"
						value={collectorForm.values?.address ?? data.collector.address ?? ''}
					/>
				</div>
				<div class="grid gap-4 sm:grid-cols-2">
					<div>
						<label class={labelClass} for="status">Status</label><select
							class={inputClass}
							id="status"
							name="status"
							>{#each COLLECTOR_STATUSES as status (status)}<option
									value={status}
									selected={(collectorForm.values?.status ?? data.collector.status) === status}
									>{COLLECTOR_STATUS_LABELS[status]}</option
								>{/each}</select
						>
					</div>
					<div>
						<label class={labelClass} for="userProfileId">Linked user</label><select
							class={inputClass}
							id="userProfileId"
							name="userProfileId"
							><option value="">None</option>{#each data.profiles as profile (profile.id)}<option
									value={profile.id}
									selected={(collectorForm.values?.userProfileId ??
										data.collector.userProfileId) === profile.id}
									>{profile.fullName}{profile.email ? ` — ${profile.email}` : ''}</option
								>{/each}</select
						>
					</div>
				</div>
				<button disabled={submitting} class={primaryButtonClass}
					>{submitting ? 'Saving…' : 'Save changes'}</button
				>
			</form>{:else}<dl class="grid gap-3 text-sm sm:grid-cols-2">
				<div>
					<dt class="text-slate-500">Phone</dt>
					<dd>{data.collector.phone ?? '—'}</dd>
				</div>
				<div>
					<dt class="text-slate-500">Email</dt>
					<dd>{data.collector.email ?? '—'}</dd>
				</div>
				<div>
					<dt class="text-slate-500">Address</dt>
					<dd>{data.collector.address ?? '—'}</dd>
				</div>
				<div>
					<dt class="text-slate-500">Status</dt>
					<dd>{COLLECTOR_STATUS_LABELS[data.collector.status]}</dd>
				</div>
			</dl>{/if}
	</section>
	<section id="section-2" class={cardClass}>
		<h2 class="mb-4 text-base font-semibold">2. Assigned bonds</h2>
		{#if data.bonds.length === 0}<p class="text-sm text-slate-500">
				No bonds are assigned in this campaign.
			</p>{:else}
			<p class="mb-2 text-sm text-slate-500">
				{data.bondsTotal} bond{data.bondsTotal === 1 ? '' : 's'}{data.bondsTotal > data.bonds.length
					? ` (showing the first ${data.bonds.length})`
					: ''}
			</p>
			<form method="POST" use:enhance>
				<table class="min-w-full text-sm">
					<thead class="text-left text-xs text-slate-500 uppercase">
						<tr>
							{#if canBulk}<th class="w-8 py-2"><span class="sr-only">Select</span></th>{/if}
							<th class="py-2 pr-3 font-medium">Bond</th>
							<th class="py-2 pr-3 font-medium">Status</th>
							<th class="py-2 font-medium">Delivery note</th>
						</tr>
					</thead>
					<tbody class="divide-y divide-slate-100">
						{#each data.bonds as bond (bond.id)}
							<tr>
								{#if canBulk}<td class="py-1">
										{#if bond.commercialStatus === 'delivered_to_collector'}<input
												type="checkbox"
												name="bondIds"
												value={bond.id}
												aria-label="Select {bondLabel(bond)}"
											/>{/if}
									</td>{/if}
								<td class="py-1 pr-3">
									<a
										class="font-mono text-blue-700 hover:underline"
										href={resolve('/campaigns/[id]/bonds/[bondId]', {
											id: data.campaign.id,
											bondId: bond.id
										})}>{bondLabel(bond)}</a
									>
								</td>
								<td class="py-1 pr-3">{BOND_COMMERCIAL_STATUS_LABELS[bond.commercialStatus]}</td>
								<td class="py-1">
									{#if bond.note}<a
											class="text-blue-700 hover:underline"
											href={resolve('/campaigns/[id]/deliveries/[noteId]', {
												id: data.campaign.id,
												noteId: bond.note.noteId
											})}>{deliveryNoteLabel(bond.note.noteNumber)}</a
										>{:else}—{/if}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
				<FieldError id="bondIds-error" errors={custodyForm?.errors?.bondIds} />
				{#if canBulk}
					<div class="mt-4 flex flex-wrap items-end gap-3">
						{#if data.custody.can.returnBonds}
							<button type="submit" formaction="?/returnBonds" class={secondaryButtonClass}
								>Return selected</button
							>
						{/if}
						{#if data.custody.can.reassignBonds}
							<div>
								<label for="targetCollectorId" class={labelClass}>Reassign selected to</label>
								<select id="targetCollectorId" name="targetCollectorId" class={inputClass}>
									<option value="">Choose…</option>
									{#each data.custody.collectors as c (c.id)}<option value={c.id}
											>{c.displayName}</option
										>{/each}
								</select>
								<FieldError
									id="targetCollectorId-error"
									errors={custodyForm?.errors?.targetCollectorId}
								/>
							</div>
							<button type="submit" formaction="?/reassignBonds" class={secondaryButtonClass}
								>Reassign</button
							>
						{/if}
					</div>
				{/if}
			</form>
		{/if}
	</section>
	<section id="section-3" class={cardClass}>
		<h2 class="mb-4 text-base font-semibold">3. Associated buyers</h2>
		{#if data.buyers.length === 0}<p class="text-sm text-slate-500">
				No associated buyers.
			</p>{:else}<ul>
				{#each data.buyers as buyer (buyer.id)}<li>
						<!-- eslint-disable svelte/no-navigation-without-resolve -->
						<a
							class="text-blue-700 hover:underline"
							href={`${resolve('/campaigns/[id]', { id: data.campaign.id })}/buyers/${buyer.id}`}
							>{buyer.businessName ??
								[buyer.lastName, buyer.firstName].filter(Boolean).join(', ')}</a
						>
						<!-- eslint-enable svelte/no-navigation-without-resolve -->
					</li>{/each}
			</ul>
			{#if data.buyersTotal > data.buyers.length}<p class="mt-2 text-sm text-slate-500">
					and {data.buyersTotal - data.buyers.length} more
				</p>{/if}{/if}
	</section>
	<section id="section-4" class={cardClass}>
		<h2 class="mb-4 text-base font-semibold">4. Pending installments</h2>
		<p class="mb-2 text-sm text-slate-500">
			{data.installmentsTotal ?? 0} pending or overdue installment{data.installmentsTotal === 1
				? ''
				: 's'}{(data.installmentsTotal ?? 0) > (data.installments ?? []).length
				? ` (showing the first ${(data.installments ?? []).length})`
				: ''}
		</p>
		<ul class="text-sm">
			{#each data.installments ?? [] as installment (installment.id)}<li class="border-t py-2">
					<a
						class="text-blue-700 underline"
						href={resolve('/campaigns/[id]/sales/[saleId]', {
							id: data.campaign.id,
							saleId: installment.saleId
						})}>Bond {installment.bondNumbers.join(', ')}</a
					>
					— {installment.buyerName} — {installment.dueDate} — {formatMoney(installment.amount)} — {installment.status}
				</li>{:else}<li class="text-slate-500">No pending installments.</li>{/each}
		</ul>
	</section>
	<section id="section-5" class={cardClass}>
		<h2 class="mb-4 text-base font-semibold">5. {sections[4]}</h2>
		<p class="text-sm text-slate-500">No data yet. Arrives with Phase 8: settlements.</p>
	</section>
	<section id="section-6" class={cardClass}>
		<h2 class="mb-4 text-base font-semibold">6. {sections[5]}</h2>
		{#if data.ledger}
			<p class="text-sm">
				Balance:
				<strong class="tabular-nums" data-testid="collector-balance"
					>{data.ledger.balance === null
						? '—'
						: formatMoney(data.ledger.balance.toFixed(2))}</strong
				>
				<a
					class="ml-3 text-blue-700 hover:underline"
					href={resolve('/campaigns/[id]/collectors/[collectorId]/ledger', {
						id: data.campaign.id,
						collectorId: data.collector.id
					})}>View current account</a
				>
			</p>
		{:else}
			<p class="text-sm text-slate-500">You do not have permission to view the current account.</p>
		{/if}
		{#if data.can.viewRules}
			<h3 class="mt-4 mb-2 text-sm font-semibold">Special commission rules</h3>
			{#if data.specialRules.length === 0}
				<p class="text-sm text-slate-500">No special rules for this collector.</p>
			{:else}
				<ul class="text-sm" data-testid="special-rules">
					{#each data.specialRules as rule (rule.id)}
						<li
							class={['border-t py-1', rule.status === 'annulled' && 'text-slate-500 line-through']}
						>
							{formatCommissionRuleType(rule)} — {formatCommissionValue(rule)} — {formatValidity(
								rule
							)}
						</li>
					{/each}
				</ul>
			{/if}
			{#if data.can.manageRules}
				<a
					class="mt-2 inline-block text-sm text-blue-700 hover:underline"
					href={resolve('/campaigns/[id]/commissions', { id: data.campaign.id })}
					>Manage special rules</a
				>
			{/if}
		{/if}
	</section>
	<section id="section-7" class={cardClass}>
		<h2 class="mb-4 text-base font-semibold">7. {sections[6]}</h2>
		<p class="text-sm text-slate-500">No data yet. Arrives with Phase 13: monthly report.</p>
	</section>
	<section id="section-8" class={cardClass}>
		<h2 class="mb-4 text-base font-semibold">8. Audit</h2>
		{#if !data.can.audit}<p class="text-sm text-slate-500">
				You do not have permission to view the audit log.
			</p>{:else if data.audit?.entries.length === 0}<p class="text-sm text-slate-500">
				No audit entries for this collector.
			</p>{:else}<ol class="divide-y divide-slate-100 text-sm">
				{#each data.audit?.entries ?? [] as entry (entry.id)}<li class="py-3">
						<strong>{entry.action}</strong>
						<span class="text-slate-500"
							>· {entry.actorName ?? 'Unknown user'} · {entry.createdAt}</span
						>
					</li>{/each}
			</ol>{/if}
	</section>
</div>
