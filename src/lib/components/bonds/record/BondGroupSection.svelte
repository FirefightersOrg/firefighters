<script lang="ts">
	import { resolve } from '$app/paths';
	import { formatBondTimestamp, type BondRecordGroup } from './types';

	/**
	 * Bond record, part of "General data": the composition of a manual pata (active members, then
	 * the ungrouped ones with when and why), or for a simple bond the pata it is in and the patas
	 * it was in before they were ungrouped.
	 */
	let {
		campaignId,
		group,
		isManualPata
	}: { campaignId: string; group: BondRecordGroup; isManualPata: boolean } = $props();

	const active = $derived(group.members.filter((m) => !m.ungroupedAt));
	const history = $derived(group.members.filter((m) => m.ungroupedAt));
	const bondHref = (bondId: string) =>
		resolve('/campaigns/[id]/bonds/[bondId]', { id: campaignId, bondId });
</script>

{#snippet memberNumbers(base: string | null, associated: string | null)}
	<span class="font-mono tabular-nums"
		>{base ?? '—'} <span aria-hidden="true">→</span><span class="sr-only">associated</span>
		{associated ?? '—'}</span
	>
{/snippet}

{#if isManualPata}
	<div class="mt-6 border-t border-slate-100 pt-4">
		<h3 id="members-title" class="mb-2 text-sm font-semibold">Members</h3>
		{#if active.length === 0}
			<p class="text-sm text-slate-500">This pata has no members: it was ungrouped.</p>
		{:else}
			<ul class="divide-y divide-slate-100 text-sm" aria-labelledby="members-title">
				{#each active as member (member.bondId)}
					<li class="flex items-center justify-between py-2">
						{@render memberNumbers(member.baseFormatted, member.associatedFormatted)}
						<a href={bondHref(member.bondId)} class="text-blue-700 hover:underline">View bond</a>
					</li>
				{/each}
			</ul>
		{/if}

		{#if history.length > 0}
			<h3 class="mt-4 mb-2 text-sm font-semibold">Ungroup history</h3>
			<ul class="divide-y divide-slate-100 text-sm">
				{#each history as member (member.bondId + member.groupedAt)}
					<li class="py-2">
						<div class="flex items-center justify-between">
							{@render memberNumbers(member.baseFormatted, member.associatedFormatted)}
							<a href={bondHref(member.bondId)} class="text-blue-700 hover:underline">View bond</a>
						</div>
						<p class="text-xs text-slate-500">
							Grouped {formatBondTimestamp(member.groupedAt)}; ungrouped {formatBondTimestamp(
								member.ungroupedAt
							)}{member.reason ? `: ${member.reason}` : ''}
						</p>
					</li>
				{/each}
			</ul>
		{/if}
	</div>
{:else if group.memberOf || group.pastPatas.length > 0}
	<div class="mt-6 border-t border-slate-100 pt-4">
		<h3 id="pata-title" class="mb-2 text-sm font-semibold">Pata</h3>
		{#if group.memberOf}
			<p class="text-sm">
				In pata <span class="font-mono tabular-nums">{group.memberOf.label}</span>.
				<a href={bondHref(group.memberOf.pataId)} class="font-medium text-blue-700 hover:underline"
					>View pata →</a
				>
			</p>
			<p class="mt-1 text-sm text-slate-500">
				While grouped, this bond is operated through its pata: it has no actions of its own.
			</p>
		{:else}
			<p class="text-sm text-slate-500">Not in a pata.</p>
		{/if}
		{#if group.pastPatas.length > 0}
			<h3 class="mt-4 mb-2 text-sm font-semibold">Previous patas</h3>
			<ul class="divide-y divide-slate-100 text-sm">
				{#each group.pastPatas as pata (pata.pataId)}
					<li class="py-2">
						<div class="flex items-center justify-between">
							<span class="font-mono tabular-nums">{pata.label}</span>
							<a href={bondHref(pata.pataId)} class="text-blue-700 hover:underline">View pata</a>
						</div>
						<p class="text-xs text-slate-500">
							Grouped {formatBondTimestamp(pata.groupedAt)}; ungrouped {formatBondTimestamp(
								pata.ungroupedAt
							)}{pata.reason ? `: ${pata.reason}` : ''}
						</p>
					</li>
				{/each}
			</ul>
		{/if}
	</div>
{/if}
