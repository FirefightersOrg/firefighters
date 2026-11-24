<script lang="ts">
	import { resolve } from '$app/paths';
	import { Table, type TableColumn } from '$lib/components/ui';
	import RecordSection from './RecordSection.svelte';
	import type { BondRecordNumber } from './types';

	/**
	 * Bond record, 2. "Números participantes" (base, associated, extraordinary), padded like the
	 * campaign shows them. A manual pata owns no numbers: its members' numbers are shown, each
	 * linking to its member bond.
	 */
	let {
		campaignId,
		bondId,
		numbers
	}: { campaignId: string; bondId: string; numbers: BondRecordNumber[] } = $props();

	const KIND_LABELS = { base: 'Base', associated: 'Asociado', extraordinary: 'Extraordinario' };
	const released = $derived(numbers.some((n) => n.released));

	type NumberRow = BondRecordNumber & { id: number } & Record<string, unknown>;
	const columns: TableColumn<NumberRow>[] = [
		{ key: 'formatted', header: 'Número' },
		{ key: 'role', header: 'Rol' },
		{ key: 'notes', header: 'Observaciones' }
	];
	const rows = $derived(numbers.map((n, id) => ({ ...n, id })) as NumberRow[]);
</script>

<RecordSection id="numbers">
	{#if numbers.length === 0}
		<p class="m-0 text-body-sm text-muted">Este bono no tiene números participantes.</p>
	{:else}
		{#if released}
			<p class="m-0 mb-3 text-body-sm text-muted">
				Los números liberados ya no cuentan para este bono y se pueden ingresar de nuevo.
			</p>
		{/if}
		<Table {columns} {rows} caption="Números participantes" density="compact">
			{#snippet cell({ row, column })}
				{#if column.key === 'formatted'}
					<span
						class="font-mono text-body font-semibold tabular-nums {row.released
							? 'text-subtle line-through'
							: ''}">{row.formatted}</span
					>
				{:else if column.key === 'role'}
					{KIND_LABELS[row.kind]}
				{:else if column.key === 'notes'}
					<span class="text-caption text-muted">
						{#if row.released}Liberado{/if}
						{#if row.ownerBondId !== bondId}
							<a
								href={resolve('/campaigns/[id]/bonds/[bondId]', {
									id: campaignId,
									bondId: row.ownerBondId
								})}
								class="text-primary-text underline-offset-2 hover:underline">Bono miembro</a
							>
						{/if}
					</span>
				{/if}
			{/snippet}
		</Table>
	{/if}
</RecordSection>
