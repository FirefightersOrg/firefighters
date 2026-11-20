<script lang="ts">
	import { resolve } from '$app/paths';
	import FormAlert from '$lib/components/campaigns/FormAlert.svelte';
	import {
		cardClass,
		inputClass,
		labelClass,
		primaryButtonClass
	} from '$lib/components/campaigns/styles';
	import { DRAW_TYPES, DRAW_TYPE_LABELS } from '$lib/domain/draws';
	import type { PageProps } from './$types';
	let { data, form }: PageProps = $props();
</script>

<svelte:head><title>New draw - {data.campaign.name}</title></svelte:head>
<div class="space-y-6">
	<header>
		<a
			class="text-sm text-blue-700 underline"
			href={resolve('/campaigns/[id]/draws', { id: data.campaign.id })}>← Draws</a
		>
		<h1 class="mt-2 text-2xl font-bold">New draw</h1>
	</header>
	{#if form?.message}<FormAlert message={form.message} />{/if}
	<form method="POST" action="?/create" class="{cardClass} space-y-4">
		<div>
			<label class={labelClass} for="drawType">Type</label><select
				class={inputClass}
				id="drawType"
				name="drawType"
				required
				>{#each DRAW_TYPES as type (type)}<option value={type}>{DRAW_TYPE_LABELS[type]}</option
					>{/each}</select
			>
		</div>
		<div>
			<label class={labelClass} for="name">Name</label><input
				class={inputClass}
				id="name"
				name="name"
				required
			/>
		</div>
		<div>
			<label class={labelClass} for="drawDate">Draw date</label><input
				class={inputClass}
				id="drawDate"
				name="drawDate"
				type="date"
				required
			/>
		</div>
		<div>
			<label class={labelClass} for="paymentCutoffLocal">Payment cutoff (Buenos Aires)</label><input
				class={inputClass}
				id="paymentCutoffLocal"
				name="paymentCutoffLocal"
				type="datetime-local"
				required
			/>
			<p class="mt-1 text-xs text-slate-500">Saved with the Buenos Aires UTC−03 offset.</p>
		</div>
		<div>
			<label class={labelClass} for="requiredInstallmentNumber"
				>Required installment (monthly)</label
			><input
				class={inputClass}
				id="requiredInstallmentNumber"
				name="requiredInstallmentNumber"
				type="number"
				min="1"
				max={data.campaign.installmentCount}
			/>
		</div>
		<div>
			<label class={labelClass} for="consolationRequiredInstallmentNumber"
				>Consolation required installment (optional)</label
			><input
				class={inputClass}
				id="consolationRequiredInstallmentNumber"
				name="consolationRequiredInstallmentNumber"
				type="number"
				min="1"
				max={data.campaign.installmentCount}
			/>
		</div>
		<button class={primaryButtonClass}>Create draw</button>
	</form>
</div>
