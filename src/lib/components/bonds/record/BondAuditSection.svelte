<script lang="ts">
	import { resolve } from '$app/paths';
	import { Disclosure } from '$lib/components/ui';
	import RecordSection from './RecordSection.svelte';
	import { formatBondTimestamp, type BondRecordAudit } from './types';

	/**
	 * Bond record, 14. "Auditoría": the audit_log entries of this bond (and the grouping / ungrouping
	 * of manual patas it was in), newest first. Only with `audit.view`. Old and new values go in a
	 * `Disclosure`.
	 */
	let { campaignId, audit }: { campaignId: string; audit: BondRecordAudit } = $props();
</script>

<RecordSection id="audit">
	{#if !audit.allowed}
		<p class="m-0 text-body-sm text-muted">No hay permiso para ver el registro de auditoría.</p>
	{:else if audit.entries.length === 0}
		<p class="m-0 text-body-sm text-muted">Este bono no tiene entradas de auditoría.</p>
	{:else}
		{#if audit.truncated}
			<p class="m-0 mb-3 text-body-sm text-muted">
				Se muestran las {audit.entries.length} entradas más recientes.
			</p>
		{/if}
		<ol class="m-0 list-none divide-y divide-border p-0 text-body-sm">
			{#each audit.entries as entry (entry.id)}
				<li class="py-3" data-audit-action={entry.action}>
					<div class="flex flex-wrap items-baseline justify-between gap-2">
						<p class="m-0 font-medium">
							{entry.actionLabel}
							{#if entry.viaPata}
								<span class="font-normal text-muted">
									— pata
									<a
										href={resolve('/campaigns/[id]/bonds/[bondId]', {
											id: campaignId,
											bondId: entry.viaPata.pataId
										})}
										class="font-mono text-primary-text underline-offset-2 underline"
										>{entry.viaPata.label}</a
									>
								</span>
							{/if}
						</p>
						<p class="m-0 text-caption text-muted">
							<time datetime={entry.createdAt}>{formatBondTimestamp(entry.createdAt)}</time>
							· {entry.actorLabel}
						</p>
					</div>
					{#if entry.summary}
						<p class="m-0 mt-1">{entry.summary}</p>
					{/if}
					{#if entry.reason}
						<p class="m-0 mt-1 text-muted">Motivo: {entry.reason}</p>
					{/if}
					{#if entry.oldValue || entry.newValue}
						<div class="mt-2">
							<Disclosure summary="Detalle">
								<div class="grid gap-2 sm:grid-cols-2">
									{#if entry.oldValue}
										<div>
											<p class="m-0 text-caption text-muted">Antes</p>
											<pre
												class="m-0 overflow-x-auto rounded-md bg-surface-sunken p-2 font-mono text-caption">{entry.oldValue}</pre>
										</div>
									{/if}
									{#if entry.newValue}
										<div>
											<p class="m-0 text-caption text-muted">Después</p>
											<pre
												class="m-0 overflow-x-auto rounded-md bg-surface-sunken p-2 font-mono text-caption">{entry.newValue}</pre>
										</div>
									{/if}
								</div>
								{#if entry.requestId}
									<p class="m-0 mt-1 text-caption text-subtle">
										Solicitud <span class="font-mono">{entry.requestId}</span>
									</p>
								{/if}
							</Disclosure>
						</div>
					{/if}
				</li>
			{/each}
		</ol>
	{/if}
</RecordSection>
