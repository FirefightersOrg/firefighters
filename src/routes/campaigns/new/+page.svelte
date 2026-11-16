<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import FormAlert from '$lib/components/campaigns/FormAlert.svelte';
	import GeneralFields from '$lib/components/campaigns/GeneralFields.svelte';
	import RulesFields from '$lib/components/campaigns/RulesFields.svelte';
	import {
		cardClass,
		primaryButtonClass,
		secondaryButtonClass
	} from '$lib/components/campaigns/styles';
	import {
		defaultRulesValues,
		emptyGeneralValues,
		withSubmitted
	} from '$lib/components/campaigns/types';
	import { previewInstallmentValue } from '$lib/domain/installments';
	import type { PageProps } from './$types';

	let { form }: PageProps = $props();

	// Initial values only: afterwards the inputs own them (refilled from `form` without JS).
	function initialValues() {
		return {
			general: withSubmitted(emptyGeneralValues(), form?.values),
			rules: withSubmitted(defaultRulesValues(), form?.values)
		};
	}
	const initial = initialValues();
	let general = $state(initial.general);
	let rules = $state(initial.rules);
	let submitting = $state(false);

	const errors = $derived(form?.errors ?? {});
	const installmentError = $derived(
		previewInstallmentValue(rules.simpleBondValue, rules.installmentCount).state === 'error'
	);
</script>

<svelte:head>
	<title>New campaign - Firefighters</title>
</svelte:head>

<div class="space-y-6">
	<div>
		<a href={resolve('/campaigns')} class="text-sm text-blue-700 hover:underline">← Campaigns</a>
		<h1 class="mt-2 text-2xl font-bold tracking-tight">New campaign</h1>
		<p class="text-sm text-slate-500">The campaign starts as a draft.</p>
	</div>

	{#if form?.message}
		<FormAlert message={form.message} />
	{/if}

	<form
		method="POST"
		class="space-y-6"
		use:enhance={() => {
			submitting = true;
			return async ({ update }) => {
				try {
					await update({ reset: false });
				} finally {
					submitting = false;
				}
			};
		}}
	>
		<section class={cardClass}>
			<h2 class="mb-4 text-base font-semibold">General</h2>
			<GeneralFields
				bind:name={general.name}
				bind:startsOn={general.startsOn}
				bind:endsOn={general.endsOn}
				{errors}
			/>
		</section>

		<section class="{cardClass} space-y-4">
			<h2 class="text-base font-semibold">Rules</h2>
			<FormAlert kind="warning">
				<p>
					Rules can be changed while the campaign is a draft. <strong
						>Activating the campaign freezes them</strong
					>: they cannot be edited afterwards.
				</p>
			</FormAlert>
			<RulesFields bind:values={rules} {errors} />
		</section>

		<div class="flex justify-end gap-2">
			<a href={resolve('/campaigns')} class={secondaryButtonClass}>Cancel</a>
			<button type="submit" disabled={submitting || installmentError} class={primaryButtonClass}>
				{submitting ? 'Creating…' : 'Create campaign'}
			</button>
		</div>
	</form>
</div>
