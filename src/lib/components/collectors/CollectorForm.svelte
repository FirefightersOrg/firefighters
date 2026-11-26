<script lang="ts">
	import { enhance } from '$app/forms';
	import { Button, Field, FormResult, Select, TextInput } from '$lib/components/ui';
	import { COLLECTOR_STATUSES, COLLECTOR_STATUS_LABELS, PARTY_LIMITS } from '$lib/domain/parties';
	import type { Collector } from '$lib/domain/parties';

	/**
	 * The collector fields shared by the create page and the record's "Datos generales" section.
	 * Without `collector` it is the create form; with it, the edit form for `?/update` (carrying
	 * the `updatedAt` stale-check token).
	 */
	let {
		collector = null,
		profiles,
		form,
		action,
		submitLabel,
		cancelHref
	}: {
		collector?: Collector | null;
		profiles: { id: string; fullName: string; email: string }[];
		form:
			| {
					success?: boolean;
					message?: string;
					values?: Record<string, string>;
					errors?: Record<string, string[]>;
			  }
			| null
			| undefined;
		action?: string;
		submitLabel: string;
		cancelHref?: string;
	} = $props();

	const FIELDS = [
		{ name: 'displayName', label: 'Nombre' },
		{ name: 'phone', label: 'Teléfono' },
		{ name: 'email', label: 'Correo electrónico' },
		{ name: 'address', label: 'Domicilio' },
		{ name: 'status', label: 'Estado' },
		{ name: 'userProfileId', label: 'Usuario vinculado' }
	];

	let submitting = $state(false);
	const errors = $derived(form?.errors ?? {});
	const value = (name: keyof Collector, fallback = '') =>
		form?.values?.[name] ?? (collector?.[name] as string | null | undefined) ?? fallback;
</script>

<form
	method="POST"
	{action}
	class="flex flex-col gap-5"
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
		result={form?.message ? { success: !!form.success, message: form.message, errors } : null}
		fields={FIELDS}
	/>
	{#if collector}<input type="hidden" name="updatedAt" value={collector.updatedAt} />{/if}
	<Field label="Nombre" id="displayName" error={errors.displayName?.[0]} required>
		<TextInput
			name="displayName"
			autocomplete="name"
			maxlength={PARTY_LIMITS.displayName}
			value={value('displayName')}
		/>
	</Field>
	<div class="grid gap-5 sm:grid-cols-2">
		<Field label="Teléfono" id="phone" error={errors.phone?.[0]} optional>
			<TextInput
				name="phone"
				type="tel"
				autocomplete="tel"
				inputmode="tel"
				maxlength={PARTY_LIMITS.phone}
				value={value('phone')}
			/>
		</Field>
		<Field label="Correo electrónico" id="email" error={errors.email?.[0]} optional>
			<TextInput
				name="email"
				type="email"
				autocomplete="email"
				inputmode="email"
				maxlength={PARTY_LIMITS.email}
				value={value('email')}
			/>
		</Field>
	</div>
	<Field label="Domicilio" id="address" error={errors.address?.[0]} optional>
		<TextInput
			name="address"
			autocomplete="street-address"
			maxlength={PARTY_LIMITS.address}
			value={value('address')}
		/>
	</Field>
	<div class="grid gap-5 sm:grid-cols-2">
		<Field label="Estado" id="status" error={errors.status?.[0]}>
			<Select
				name="status"
				value={value('status', 'active')}
				options={COLLECTOR_STATUSES.map((status) => ({
					value: status,
					label: COLLECTOR_STATUS_LABELS[status]
				}))}
			/>
		</Field>
		<Field label="Usuario vinculado" id="userProfileId" error={errors.userProfileId?.[0]} optional>
			<Select
				name="userProfileId"
				value={value('userProfileId')}
				options={[
					{ value: '', label: 'Ninguno' },
					...profiles.map((profile) => ({
						value: profile.id,
						label: profile.email ? `${profile.fullName} (${profile.email})` : profile.fullName
					}))
				]}
			/>
		</Field>
	</div>
	<div class="flex flex-wrap gap-2">
		<Button type="submit" variant="primary" loading={submitting}>
			{submitting ? 'Guardando…' : submitLabel}
		</Button>
		{#if cancelHref}<Button href={cancelHref}>Cancelar</Button>{/if}
	</div>
</form>
