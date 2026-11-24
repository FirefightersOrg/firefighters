<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import { Alert, Button, Card, FormResult, PageHeader } from '$lib/components/ui';
	import { GENERAL_FIELDS, RULES_FIELDS } from '$lib/components/campaigns/fields';
	import GeneralFields from '$lib/components/campaigns/GeneralFields.svelte';
	import RulesFields from '$lib/components/campaigns/RulesFields.svelte';
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
	<title>Nueva campaña - Firefighters</title>
</svelte:head>

<PageHeader
	title="Nueva campaña"
	description="La campaña comienza como borrador."
	breadcrumbs={[{ label: 'Campañas', href: resolve('/campaigns') }, { label: 'Nueva campaña' }]}
/>

<form
	method="POST"
	class="flex flex-col gap-6"
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
	<FormResult
		result={form ? { success: false, message: form.message, errors } : null}
		fields={[...GENERAL_FIELDS, ...RULES_FIELDS]}
	/>

	<Card title="Datos generales" id="general">
		<GeneralFields
			bind:name={general.name}
			bind:startsOn={general.startsOn}
			bind:endsOn={general.endsOn}
			{errors}
		/>
	</Card>

	<Card title="Reglas" id="rules">
		<div class="flex flex-col gap-5">
			<Alert tone="warning">
				Las reglas se pueden cambiar mientras la campaña es un borrador.
				<strong>Activar la campaña las congela</strong>: después no se pueden editar.
			</Alert>
			<RulesFields bind:values={rules} {errors} />
		</div>
	</Card>

	<div class="flex flex-wrap gap-2">
		<Button type="submit" variant="primary" loading={submitting} disabled={installmentError}>
			{submitting ? 'Creando…' : 'Crear campaña'}
		</Button>
		<Button href={resolve('/campaigns')}>Cancelar</Button>
	</div>
</form>
