<script lang="ts">
	import { resolve } from '$app/paths';
	import { cardClass } from '$lib/components/campaigns/styles';
	import { formatBondTimestamp, type BondRecordGroup } from './types';

	/**
	 * Bond record, manual grouping: the members of a manual pata (active ones, then the ungrouped
	 * ones with when and why), or the pata a simple bond belongs to.
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
	<section class={cardClass} aria-labelledby="members-title">
		<h2 id="members-title" class="mb-4 text-base font-semibold">Members</h2>
		{#if active.length === 0}
			<p class="text-sm text-slate-500">This pata has no members: it was ungrouped.</p>
		{:else}
			<ul class="divide-y divide-slate-100 text-sm">
				{#each active as member (member.bondId)}
					<li class="flex items-center justify-between py-2">
						{@render memberNumbers(member.baseFormatted, member.associatedFormatted)}
						<a href={bondHref(member.bondId)} class="text-blue-700 hover:underline">View bond</a>
					</li>
				{/each}
			</ul>
		{/if}

		{#if history.length > 0}
			<h3 class="mt-6 mb-2 text-sm font-semibold">Ungroup history</h3>
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
	</section>
{:else if group.memberOf}
	<section class={cardClass} aria-labelledby="pata-title">
		<h2 id="pata-title" class="mb-2 text-base font-semibold">Pata</h2>
		<p class="text-sm">
			In pata <span class="font-mono tabular-nums">{group.memberOf.label}</span>.
			<a href={bondHref(group.memberOf.pataId)} class="font-medium text-blue-700 hover:underline"
				>View pata →</a
			>
		</p>
		<p class="mt-1 text-sm text-slate-500">
			While grouped, this bond is operated through its pata: it has no actions of its own.
		</p>
	</section>
{/if}
