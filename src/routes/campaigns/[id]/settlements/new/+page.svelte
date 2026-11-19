<script lang="ts">
	import { resolve } from '$app/paths';
	import FieldError from '$lib/components/campaigns/FieldError.svelte';
	import FormAlert from '$lib/components/campaigns/FormAlert.svelte';
	import {
		cardClass,
		inputClass,
		labelClass,
		primaryButtonClass
	} from '$lib/components/campaigns/styles';
	import type { PageProps } from './$types';
	let { data, form }: PageProps = $props();
	const result = $derived(
		form as {
			message?: string;
			errors?: Record<string, string[]>;
			values?: Record<string, string>;
		} | null
	);
</script>

<div class="space-y-6">
	<div>
		<a
			class="text-sm text-blue-700 hover:underline"
			href={resolve('/campaigns/[id]/settlements', { id: data.campaign.id })}>← Settlements</a
		>
		<h1 class="mt-2 text-2xl font-bold">Open settlement</h1>
	</div>
	{#if result?.message}<FormAlert kind="error" message={result.message} />{/if}
	<form method="POST" action="?/create" class="{cardClass} max-w-xl space-y-4">
		<div>
			<label class={labelClass} for="collectorId">Collector</label><select
				class={inputClass}
				id="collectorId"
				name="collectorId"
				><option value="">Choose…</option>{#each data.collectors as c (c.id)}<option
						value={c.id}
						selected={result?.values?.collectorId === c.id}>{c.displayName}</option
					>{/each}</select
			><FieldError id="collectorId-error" errors={result?.errors?.collectorId} />
		</div>
		<div>
			<label class={labelClass} for="notes">Notes (optional)</label><textarea
				class={inputClass}
				id="notes"
				name="notes"
				maxlength={data.notesMax}>{result?.values?.notes ?? ''}</textarea
			><FieldError id="notes-error" errors={result?.errors?.notes} />
		</div>
		<button class={primaryButtonClass}>Open settlement</button>
	</form>
</div>
