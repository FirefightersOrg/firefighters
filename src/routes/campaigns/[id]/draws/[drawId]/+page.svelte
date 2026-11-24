<script lang="ts">
	import { resolve } from '$app/paths';
	import FormAlert from '$lib/components/campaigns/FormAlert.svelte';
	import {
		cardClass,
		inputClass,
		labelClass,
		primaryButtonClass,
		secondaryButtonClass
	} from '$lib/components/campaigns/styles';
	import { DRAW_STATUS_LABELS, DRAW_TYPE_LABELS } from '$lib/domain/draws';
	import { buenosAiresDateTimeLocal } from '$lib/domain/draws-datetime';
	import type { PageProps } from './$types';
	let { data, form }: PageProps = $props();
	const localCutoff = $derived(buenosAiresDateTimeLocal(data.draw.paymentCutoffAt));
	const cutoffDisplay = $derived(localCutoff.replace('T', ' '));
</script>

<svelte:head><title>{data.draw.name} - {data.campaign.name}</title></svelte:head>
<div class="space-y-6">
	<header>
		<a
			class="text-sm text-blue-700 underline"
			href={resolve('/campaigns/[id]/draws', { id: data.campaign.id })}>← Draws</a
		>
		<div class="mt-2 flex items-center gap-3">
			<h1 class="text-2xl font-bold">{data.draw.name}</h1>
			<span class="rounded bg-slate-100 px-2 py-1 text-xs"
				>{DRAW_STATUS_LABELS[data.draw.status]}</span
			>
		</div>
		<p class="text-sm text-slate-600">
			{DRAW_TYPE_LABELS[data.draw.drawType]} · {data.draw.drawDate}
		</p>
	</header>
	{#if form?.message}<FormAlert
			kind={form.success ? 'success' : 'error'}
			message={form.message}
		/>{/if}
	<section class={cardClass}>
		<h2 class="font-semibold">Eligibility and cutoff</h2>
		<dl class="mt-3 grid gap-3 text-sm sm:grid-cols-2">
			<div>
				<dt class="text-slate-500">Payment cutoff</dt>
				<dd>{cutoffDisplay} (Buenos Aires)</dd>
			</div>
			<div>
				<dt class="text-slate-500">Required installment</dt>
				<dd>{data.draw.requiredInstallmentNumber ?? 'Not applicable'}</dd>
			</div>
		</dl>
	</section>
	{#if data.can.edit}<details class={cardClass}>
			<summary class="cursor-pointer font-semibold">Edit scheduled draw</summary>
			<form method="POST" action="?/update" class="mt-4 space-y-3">
				<label class={labelClass} for="name">Name</label><input
					class={inputClass}
					id="name"
					name="name"
					value={data.draw.name}
					required
				/>
				<label class={labelClass} for="drawDate">Draw date</label><input
					class={inputClass}
					id="drawDate"
					name="drawDate"
					type="date"
					value={data.draw.drawDate}
					required
				/>
				<label class={labelClass} for="paymentCutoffLocal">Payment cutoff (Buenos Aires)</label
				><input
					class={inputClass}
					id="paymentCutoffLocal"
					name="paymentCutoffLocal"
					type="datetime-local"
					value={localCutoff}
					required
				/>
				<label class={labelClass} for="requiredInstallmentNumber">Required installment</label><input
					class={inputClass}
					id="requiredInstallmentNumber"
					name="requiredInstallmentNumber"
					type="number"
					min="1"
					max={data.campaign.installmentCount}
					value={data.draw.requiredInstallmentNumber ?? ''}
				/>
				<label class={labelClass} for="consolationRequiredInstallmentNumber"
					>Consolation required installment</label
				><input
					class={inputClass}
					id="consolationRequiredInstallmentNumber"
					name="consolationRequiredInstallmentNumber"
					type="number"
					min="1"
					max={data.campaign.installmentCount}
					value={(
						data.draw.eligibilityRule?.consolation_rule as
							{ required_installment_number?: number } | undefined
					)?.required_installment_number ?? ''}
				/>
				<button class={primaryButtonClass}>Save changes</button>
			</form>
		</details>{/if}
	<section class={cardClass}>
		<h2 class="font-semibold">Roster</h2>
		{#if data.roster}<p class="mt-2 text-sm">
				Current roster: {data.roster.status}.
				<a
					class="text-blue-700 underline"
					href={resolve('/campaigns/[id]/draws/[drawId]/roster', {
						id: data.campaign.id,
						drawId: data.draw.id
					})}>View roster</a
				>
			</p>{:else}<p class="mt-2 text-sm text-slate-500">No roster has been generated.</p>{/if}
		{#if data.draw.drawType === 'consolation' && data.draw.status === 'scheduled'}<p
				class="mt-2 text-sm text-amber-700"
			>
				Generation is unavailable until draw results exist. The backend will reject generation until
				then.
			</p>{/if}
		<div class="mt-3 flex flex-wrap gap-3">
			{#if data.can.generate}<form method="POST" action="?/generate">
					<button class={primaryButtonClass}>Generate roster</button>
				</form>{/if}{#if data.can.regenerate}<form method="POST" action="?/generate">
					<button class={secondaryButtonClass}>Regenerate roster</button>
				</form>{/if}
		</div>
		{#if data.can.freeze}<form
				method="POST"
				action="?/freeze"
				class="mt-4 rounded border border-amber-200 bg-amber-50 p-3"
			>
				<label class="flex gap-2 text-sm"
					><input type="checkbox" name="confirm" value="yes" required /> I confirm this roster is final
					and must never be recalculated.</label
				><button class="{primaryButtonClass} mt-3">Freeze roster</button>
			</form>{/if}
	</section>
	<section class={cardClass}>
		<h2 class="font-semibold">Winners and prizes</h2>
		<p class="mt-2 text-sm">
			Configure prizes, load winning numbers and record delivery.
			<a
				class="text-blue-700 underline"
				href={resolve('/campaigns/[id]/draws/[drawId]/winners', {
					id: data.campaign.id,
					drawId: data.draw.id
				})}>Manage winners and prizes</a
			>
		</p>
	</section>
	{#if data.can.complete}<section class={cardClass}>
			<h2 class="font-semibold">Complete draw</h2>
			<p class="mt-1 text-sm text-slate-600">
				Every prize must be resolved (awarded or unawarded) first. Pending deliveries can still be
				recorded after completion.
			</p>
			<form method="POST" action="?/complete" class="mt-3">
				<button class={secondaryButtonClass}>Complete draw</button>
			</form>
		</section>{/if}
	{#if data.can.annul}<details class="{cardClass} border-red-200">
			<summary class="cursor-pointer font-semibold text-red-700">Annul draw</summary>
			{#if data.draw.drawType === 'extraordinary_full_payment' && data.draw.status === 'roster_generated'}
				<p class="mt-2 text-sm text-red-700">
					Annulling this draw releases its reserved extra numbers that no other active draw uses, so
					a later draw can assign them again. The generated roster is kept as history.
				</p>
			{/if}
			<form method="POST" action="?/annul" class="mt-3">
				<label class={labelClass} for="reason"
					>Reason (max. {data.reasonMax} Unicode characters)</label
				><textarea class={inputClass} id="reason" name="reason" required></textarea><button
					class="{secondaryButtonClass} mt-3">Annul draw</button
				>
			</form>
		</details>{/if}
</div>
