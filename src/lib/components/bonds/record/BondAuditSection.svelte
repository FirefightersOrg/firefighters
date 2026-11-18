<script lang="ts">
	import { resolve } from '$app/paths';
	import RecordSection from './RecordSection.svelte';
	import { formatBondTimestamp, type BondRecordAudit } from './types';

	/**
	 * Bond record, 13. "Audit": the audit_log entries of this bond (and the grouping / ungrouping
	 * of manual patas it was in), newest first. Only with `audit.view`.
	 */
	let { campaignId, audit }: { campaignId: string; audit: BondRecordAudit } = $props();
</script>

<RecordSection id="audit">
	{#if !audit.allowed}
		<p class="text-sm text-slate-500">You do not have permission to view the audit log.</p>
	{:else if audit.entries.length === 0}
		<p class="text-sm text-slate-500">No audit entries for this bond.</p>
	{:else}
		{#if audit.truncated}
			<p class="mb-3 text-sm text-slate-600">Showing the newest {audit.entries.length} entries.</p>
		{/if}
		<ol class="divide-y divide-slate-100 text-sm">
			{#each audit.entries as entry (entry.id)}
				<li class="py-3" data-audit-action={entry.action}>
					<div class="flex flex-wrap items-baseline justify-between gap-2">
						<p class="font-medium">
							{entry.actionLabel}
							{#if entry.viaPata}
								<span class="font-normal text-slate-600">
									— pata
									<a
										href={resolve('/campaigns/[id]/bonds/[bondId]', {
											id: campaignId,
											bondId: entry.viaPata.pataId
										})}
										class="font-mono text-blue-700 hover:underline">{entry.viaPata.label}</a
									>
								</span>
							{/if}
						</p>
						<p class="text-xs text-slate-500">
							<time datetime={entry.createdAt}>{formatBondTimestamp(entry.createdAt)}</time>
							· {entry.actorLabel}
						</p>
					</div>
					{#if entry.summary}
						<p class="mt-1 text-slate-700">{entry.summary}</p>
					{/if}
					{#if entry.reason}
						<p class="mt-1 text-slate-600">Reason: {entry.reason}</p>
					{/if}
					{#if entry.oldValue || entry.newValue}
						<details class="mt-1">
							<summary class="cursor-pointer text-xs text-slate-500">Details</summary>
							<div class="mt-2 grid gap-2 sm:grid-cols-2">
								{#if entry.oldValue}
									<div>
										<p class="text-xs font-medium text-slate-500">Before</p>
										<pre
											class="overflow-x-auto rounded bg-slate-50 p-2 text-xs">{entry.oldValue}</pre>
									</div>
								{/if}
								{#if entry.newValue}
									<div>
										<p class="text-xs font-medium text-slate-500">After</p>
										<pre
											class="overflow-x-auto rounded bg-slate-50 p-2 text-xs">{entry.newValue}</pre>
									</div>
								{/if}
							</div>
							{#if entry.requestId}
								<p class="mt-1 text-xs text-slate-400">Request {entry.requestId}</p>
							{/if}
						</details>
					{/if}
				</li>
			{/each}
		</ol>
	{/if}
</RecordSection>
