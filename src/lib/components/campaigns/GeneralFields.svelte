<script lang="ts">
	import type { CampaignFieldErrors } from '$lib/schemas/campaign';
	import { CAMPAIGN_NAME_MAX_LENGTH } from '$lib/schemas/campaign';
	import FieldError from './FieldError.svelte';
	import { hintClass, inputClass, labelClass } from './styles';

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

<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
	<div class="sm:col-span-2">
		<label for="name" class={labelClass}>Name</label>
		<input
			id="name"
			name="name"
			type="text"
			required
			maxlength={CAMPAIGN_NAME_MAX_LENGTH}
			readonly={nameReadonly}
			bind:value={name}
			aria-invalid={errors.name ? 'true' : undefined}
			aria-describedby={errors.name ? 'name-error' : undefined}
			class={inputClass}
		/>
		<FieldError id="name-error" errors={errors.name} />
	</div>

	<div>
		<label for="startsOn" class={labelClass}>Start date</label>
		<input
			id="startsOn"
			name="startsOn"
			type="date"
			readonly={datesReadonly}
			bind:value={startsOn}
			aria-invalid={errors.startsOn ? 'true' : undefined}
			aria-describedby={errors.startsOn ? 'startsOn-error' : 'dates-hint'}
			class={inputClass}
		/>
		<FieldError id="startsOn-error" errors={errors.startsOn} />
	</div>

	<div>
		<label for="endsOn" class={labelClass}>End date</label>
		<input
			id="endsOn"
			name="endsOn"
			type="date"
			readonly={datesReadonly}
			min={startsOn || undefined}
			bind:value={endsOn}
			aria-invalid={errors.endsOn ? 'true' : undefined}
			aria-describedby={errors.endsOn ? 'endsOn-error' : 'dates-hint'}
			class={inputClass}
		/>
		<FieldError id="endsOn-error" errors={errors.endsOn} />
	</div>

	<p id="dates-hint" class="{hintClass} sm:col-span-2">
		Both dates are required to activate the campaign. Days are in Argentina time: the campaign
		starts at 00:00 of the start date and ends at 23:59 of the end date.
	</p>
</div>
