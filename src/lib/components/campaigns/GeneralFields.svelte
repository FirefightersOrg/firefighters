<script lang="ts">
	import { Field, TextInput } from '$lib/components/ui';
	import type { CampaignFieldErrors } from '$lib/schemas/campaign';
	import { CAMPAIGN_NAME_MAX_LENGTH } from '$lib/schemas/campaign';

	/**
	 * Name, start date and end date. Values are the raw input strings (dates as YYYY-MM-DD).
	 * Read-only inputs are still submitted, so a locked field keeps its value on save.
	 */
	let {
		name = $bindable(''),
		startsOn = $bindable(''),
		endsOn = $bindable(''),
		errors = {},
		nameReadonly = false,
		datesReadonly = false
	}: {
		name?: string;
		startsOn?: string;
		endsOn?: string;
		errors?: CampaignFieldErrors;
		nameReadonly?: boolean;
		datesReadonly?: boolean;
	} = $props();
</script>

<div class="grid grid-cols-1 gap-5 sm:grid-cols-2">
	<div class="sm:col-span-2">
		<Field label="Nombre" id="name" error={errors.name?.[0]} required>
			<TextInput
				name="name"
				type="text"
				maxlength={CAMPAIGN_NAME_MAX_LENGTH}
				readonly={nameReadonly}
				bind:value={name}
			/>
		</Field>
	</div>

	<Field label="Fecha de inicio" id="startsOn" error={errors.startsOn?.[0]} optional>
		<TextInput
			name="startsOn"
			type="date"
			readonly={datesReadonly}
			aria-describedby="dates-hint"
			bind:value={startsOn}
		/>
	</Field>

	<Field label="Fecha de fin" id="endsOn" error={errors.endsOn?.[0]} optional>
		<TextInput
			name="endsOn"
			type="date"
			readonly={datesReadonly}
			min={startsOn || undefined}
			aria-describedby="dates-hint"
			bind:value={endsOn}
		/>
	</Field>

	<p id="dates-hint" class="m-0 max-w-prose text-body-sm text-muted sm:col-span-2">
		Ambas fechas son necesarias para activar la campaña. Los días se toman en hora de Argentina: la
		campaña empieza a las 00:00 de la fecha de inicio y termina a las 23:59 de la fecha de fin.
	</p>
</div>
