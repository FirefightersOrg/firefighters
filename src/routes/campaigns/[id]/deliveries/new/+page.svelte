<script lang="ts">
	import { tick } from 'svelte';
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import FieldError from '$lib/components/campaigns/FieldError.svelte';
	import FormAlert from '$lib/components/campaigns/FormAlert.svelte';
	import {
		cardClass,
		hintClass,
		inputClass,
		labelClass,
		primaryButtonClass,
		secondaryButtonClass
	} from '$lib/components/campaigns/styles';
	import { DELIVERY_MAX_BONDS, DELIVERY_NOTES_MAX_LENGTH } from '$lib/domain/deliveries';
	import type { DeliveryBondOption } from '$lib/server/deliveries/route-helpers';
	import type { PageProps } from './$types';

	/**
	 * New delivery: find available bonds (number, code or scan, or a base-number range), review the
	 * selection and deliver it to one collector in a single note.
	 */
	let { data, form }: PageProps = $props();
	const campaign = $derived(data.campaign);

	let selected = $state<DeliveryBondOption[]>([]);
	let lookupMessage = $state<string | null>(null);
	let queryInput = $state<HTMLInputElement>();
	let busy = $state(false);
	const units = $derived(selected.reduce((total, b) => total + b.units, 0));

	function add(found: DeliveryBondOption[]) {
		const known = new Set(selected.map((b) => b.id));
		const fresh = found.filter((b) => !known.has(b.id));
		selected = [...selected, ...fresh].slice(0, DELIVERY_MAX_BONDS);
		lookupMessage =
			found.length === 0
				? 'No available bond matches.'
				: fresh.length === 0
					? 'Already in the list.'
					: `${fresh.length} added.`;
	}
	const deliverErrors = $derived(form && 'errors' in form && !form.found ? form.errors : {});
</script>

<svelte:head>
	<title>New delivery - {campaign.name} - Firefighters</title>
</svelte:head>

<div class="space-y-6">
	<div>
		<a
			href={resolve('/campaigns/[id]/deliveries', { id: campaign.id })}
			class="text-sm text-blue-700 hover:underline">← Delivery notes</a
		>
		<h1 class="mt-2 text-2xl font-bold tracking-tight">New delivery</h1>
		<p class="text-sm text-slate-500">
			Available bonds of {campaign.name} handed to one collector, with a delivery note.
		</p>
	</div>

	{#if !data.canDeliver}
		<FormAlert kind="warning"><p>{data.lockedMessage}</p></FormAlert>
	{:else}
		{#if form?.message && !form.success && !form.found}<FormAlert message={form.message} />{/if}

		<section class="{cardClass} space-y-4" aria-labelledby="find-title">
			<h2 id="find-title" class="text-base font-semibold">Add bonds</h2>
			<form
				method="POST"
				action="?/lookup"
				class="grid gap-3 sm:grid-cols-4 sm:items-end"
				use:enhance={() => {
					busy = true;
					return async ({ result }) => {
						busy = false;
						if (result.type === 'success' && result.data?.found) {
							add(result.data.found as DeliveryBondOption[]);
							if (result.data.truncated)
								lookupMessage = 'Showing the first 500 matches; narrow the range.';
						} else if (result.type === 'failure') {
							lookupMessage = (result.data?.message as string) ?? 'Lookup failed.';
						}
						if (queryInput) queryInput.value = '';
						await tick();
						queryInput?.focus();
					};
				}}
			>
				<div class="sm:col-span-2">
					<label for="query" class={labelClass}>Number, barcode or code</label>
					<input
						id="query"
						name="query"
						bind:this={queryInput}
						autocomplete="off"
						class="{inputClass} font-mono"
						aria-describedby="query-hint"
					/>
					<p id="query-hint" class={hintClass}>
						A base or associated number, or scan the barcode (Enter adds it).
					</p>
				</div>
				<div>
					<label for="from" class={labelClass}>Or range from</label>
					<input id="from" name="from" inputmode="numeric" class="{inputClass} font-mono" />
				</div>
				<div>
					<label for="to" class={labelClass}>to</label>
					<input id="to" name="to" inputmode="numeric" class="{inputClass} font-mono" />
				</div>
				<button type="submit" class={secondaryButtonClass} disabled={busy}
					>{busy ? 'Searching…' : 'Add'}</button
				>
				<p aria-live="polite" class="text-sm text-slate-600 sm:col-span-3">{lookupMessage ?? ''}</p>
			</form>
		</section>

		<form method="POST" action="?/deliver" class="{cardClass} space-y-4" use:enhance>
			<h2 class="text-base font-semibold">Delivery</h2>
			<div>
				<label for="collectorId" class={labelClass}>Collector</label>
				{#if !data.canSeeCollectors}
					<p class={hintClass}>You cannot see collectors; ask an admin.</p>
				{/if}
				<select
					id="collectorId"
					name="collectorId"
					required
					class={inputClass}
					aria-invalid={deliverErrors.collectorId ? 'true' : undefined}
					value={form?.values?.collectorId ?? ''}
				>
					<option value="">Choose…</option>
					{#each data.collectors as c (c.id)}<option value={c.id}>{c.displayName}</option>{/each}
				</select>
				<FieldError id="collectorId-error" errors={deliverErrors.collectorId} />
			</div>

			<div>
				<p class={labelClass}>Bonds ({selected.length} · {units} units)</p>
				<FieldError id="bondIds-error" errors={deliverErrors.bondIds} />
				{#if selected.length === 0}
					<p class="text-sm text-slate-500">No bonds yet.</p>
				{:else}
					<ul class="mt-2 divide-y divide-slate-100 text-sm">
						{#each selected as bond (bond.id)}
							<li class="flex items-center justify-between py-1">
								<input type="hidden" name="bondIds" value={bond.id} />
								<span class="font-mono">{bond.label}</span>
								<button
									type="button"
									class="text-red-700 hover:underline"
									onclick={() => (selected = selected.filter((b) => b.id !== bond.id))}
									>Remove</button
								>
							</li>
						{/each}
					</ul>
				{/if}
			</div>

			<div>
				<label for="notes" class={labelClass}>Notes (optional)</label>
				<input
					id="notes"
					name="notes"
					maxlength={DELIVERY_NOTES_MAX_LENGTH}
					class={inputClass}
					value={form?.values?.notes ?? ''}
				/>
				<FieldError id="notes-error" errors={deliverErrors.notes} />
			</div>
			<button type="submit" class={primaryButtonClass} disabled={selected.length === 0}
				>Deliver and issue note</button
			>
		</form>
	{/if}
</div>
