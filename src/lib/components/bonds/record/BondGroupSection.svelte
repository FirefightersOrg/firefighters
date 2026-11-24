<script lang="ts">
	import { resolve } from '$app/paths';
	import { Disclosure } from '$lib/components/ui';
	import { formatBondTimestamp, type BondRecordGroup } from './types';

	/**
	 * Bond record, part of "Datos generales": the composition of a manual pata (active members, then
	 * the ungrouped ones with when and why), or for a simple bond the pata it is in and the patas
	 * it was in before they were ungrouped. The history goes in a `Disclosure`.
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
		>{base ?? '—'} <span aria-hidden="true">→</span><span class="sr-only">asociado</span>
		{associated ?? '—'}</span
	>
{/snippet}

{#if isManualPata}
	<div class="mt-6 border-t border-border pt-4">
		<h3 id="members-title" class="m-0 mb-2 text-heading-3">Miembros</h3>
		{#if active.length === 0}
			<p class="m-0 text-body-sm text-muted">Esta pata no tiene miembros: se desagrupó.</p>
		{:else}
			<ul
				class="m-0 list-none divide-y divide-border p-0 text-body-sm"
				aria-labelledby="members-title"
			>
				{#each active as member (member.bondId)}
					<li class="flex items-center justify-between py-2">
						{@render memberNumbers(member.baseFormatted, member.associatedFormatted)}
						<a
							href={bondHref(member.bondId)}
							class="text-primary-text underline-offset-2 hover:underline">Ver bono</a
						>
					</li>
				{/each}
			</ul>
		{/if}

		{#if history.length > 0}
			<div class="mt-4">
				<Disclosure summary="Historial de desagrupaciones" meta={String(history.length)}>
					<ul class="m-0 list-none divide-y divide-border p-0 text-body-sm">
						{#each history as member (member.bondId + member.groupedAt)}
							<li class="py-2">
								<div class="flex items-center justify-between">
									{@render memberNumbers(member.baseFormatted, member.associatedFormatted)}
									<a
										href={bondHref(member.bondId)}
										class="text-primary-text underline-offset-2 hover:underline">Ver bono</a
									>
								</div>
								<p class="m-0 text-caption text-muted">
									Agrupado el {formatBondTimestamp(member.groupedAt)}; desagrupado el {formatBondTimestamp(
										member.ungroupedAt
									)}{member.reason ? `: ${member.reason}` : ''}
								</p>
							</li>
						{/each}
					</ul>
				</Disclosure>
			</div>
		{/if}
	</div>
{:else if group.memberOf || group.pastPatas.length > 0}
	<div class="mt-6 border-t border-border pt-4">
		<h3 id="pata-title" class="m-0 mb-2 text-heading-3">Pata</h3>
		{#if group.memberOf}
			<p class="m-0 text-body-sm">
				En la pata <span class="font-mono tabular-nums">{group.memberOf.label}</span>.
				<a
					href={bondHref(group.memberOf.pataId)}
					class="font-medium text-primary-text underline-offset-2 hover:underline">Ver pata →</a
				>
			</p>
			<p class="m-0 mt-1 text-body-sm text-muted">
				Mientras está agrupado, este bono se opera a través de su pata: no tiene acciones propias.
			</p>
		{:else}
			<p class="m-0 text-body-sm text-muted">No está en ninguna pata.</p>
		{/if}
		{#if group.pastPatas.length > 0}
			<div class="mt-4">
				<Disclosure summary="Patas anteriores" meta={String(group.pastPatas.length)}>
					<ul class="m-0 list-none divide-y divide-border p-0 text-body-sm">
						{#each group.pastPatas as pata (pata.pataId)}
							<li class="py-2">
								<div class="flex items-center justify-between">
									<span class="font-mono tabular-nums">{pata.label}</span>
									<a
										href={bondHref(pata.pataId)}
										class="text-primary-text underline-offset-2 hover:underline">Ver pata</a
									>
								</div>
								<p class="m-0 text-caption text-muted">
									Agrupado el {formatBondTimestamp(pata.groupedAt)}; desagrupado el {formatBondTimestamp(
										pata.ungroupedAt
									)}{pata.reason ? `: ${pata.reason}` : ''}
								</p>
							</li>
						{/each}
					</ul>
				</Disclosure>
			</div>
		{/if}
	</div>
{/if}
