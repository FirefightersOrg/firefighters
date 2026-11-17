<script lang="ts">
	import { resolve } from '$app/paths';
	import { cardClass } from '$lib/components/campaigns/styles';
	import type { BondRecordNumber } from './types';

	/**
	 * Bond record, "Participating numbers", padded like the campaign shows them. A manual pata owns
	 * no numbers: its members' numbers are shown, each linking to its member bond.
	 */
	let {
		campaignId,
		bondId,
		numbers
	}: { campaignId: string; bondId: string; numbers: BondRecordNumber[] } = $props();

	const KIND_LABELS = { base: 'Base', associated: 'Associated', extraordinary: 'Extraordinary' };
	const released = $derived(numbers.some((n) => n.released));
</script>

<section class={cardClass} aria-labelledby="numbers-title">
	<h2 id="numbers-title" class="mb-4 text-base font-semibold">Participating numbers</h2>
	{#if numbers.length === 0}
		<p class="text-sm text-slate-500">This bond has no participating numbers.</p>
	{:else}
		{#if released}
			<p class="mb-3 text-sm text-slate-600">
				Released numbers no longer count for this bond and can be entered again.
			</p>
		{/if}
		<table class="w-full text-left text-sm">
			<thead class="text-xs text-slate-500">
				<tr>
					<th scope="col" class="py-1 font-medium">Number</th>
					<th scope="col" class="py-1 font-medium">Role</th>
					<th scope="col" class="py-1 font-medium"><span class="sr-only">Notes</span></th>
				</tr>
			</thead>
			<tbody class="divide-y divide-slate-100">
				{#each numbers as number, i (i)}
					<tr>
						<td class="py-1.5 font-mono text-base font-semibold tabular-nums">
							<span class={number.released ? 'text-slate-400 line-through' : ''}
								>{number.formatted}</span
							>
						</td>
						<td class="py-1.5">{KIND_LABELS[number.kind]}</td>
						<td class="py-1.5 text-xs text-slate-500">
							{#if number.released}Released{/if}
							{#if number.ownerBondId !== bondId}
								<a
									href={resolve('/campaigns/[id]/bonds/[bondId]', {
										id: campaignId,
										bondId: number.ownerBondId
									})}
									class="text-blue-700 hover:underline">Member bond</a
								>
							{/if}
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	{/if}
</section>
