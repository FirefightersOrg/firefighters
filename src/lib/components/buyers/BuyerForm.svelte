<script lang="ts">
	import { resolve } from '$app/paths';
	import {
		Alert,
		Button,
		Checkbox,
		Field,
		FormResult,
		Select,
		Textarea,
		TextInput
	} from '$lib/components/ui';
	import { BUYER_TYPE_LABELS, PARTY_LIMITS, type Buyer } from '$lib/domain/parties';

	let {
		buyer = null,
		campaignId,
		collectors,
		usualCollectorNotVisible = false,
		canViewCollectors = true,
		form,
		cancelHref
	}: {
		buyer?: Buyer | null;
		campaignId: string;
		collectors: { id: string; displayName: string }[];
		usualCollectorNotVisible?: boolean;
		canViewCollectors?: boolean;
		form:
			| {
					success?: boolean;
					message?: string;
					values?: Record<string, unknown>;
					errors?: Record<string, string[]>;
					duplicates?: { id: string; name: string }[];
			  }
			| null
			| undefined;
		cancelHref?: string;
	} = $props();

	const FIELDS = [
		{ name: 'type', label: 'Tipo' },
		{ name: 'firstName', label: 'Nombre' },
		{ name: 'lastName', label: 'Apellido' },
		{ name: 'documentNumber', label: 'Número de documento' },
		{ name: 'businessName', label: 'Razón social' },
		{ name: 'taxId', label: 'CUIT' },
		{ name: 'phone', label: 'Teléfono' },
		{ name: 'usualCollectorId', label: 'Cobrador habitual' },
		{ name: 'address', label: 'Domicilio' },
		{ name: 'notes', label: 'Notas' }
	];

	function initialType() {
		const submitted = form?.values?.type;
		return typeof submitted === 'string' && submitted !== ''
			? submitted
			: (buyer?.type ?? 'individual');
	}
	let type = $state(initialType());
	const value = (name: string, fallback = '') => {
		const candidate = form?.values?.[name];
		return typeof candidate === 'string' ? candidate : fallback;
	};
	const errors = $derived(form?.errors ?? {});
	const collectorValue = () => {
		const selected = value('usualCollectorId', buyer?.usualCollectorId ?? '');
		return usualCollectorNotVisible && selected === buyer?.usualCollectorId ? '__keep__' : selected;
	};
	const collectorOptions = $derived([
		{ value: '', label: 'Ninguno' },
		...(usualCollectorNotVisible
			? [{ value: '__keep__', label: 'Cobrador habitual actual (no visible)' }]
			: []),
		...collectors.map((collector) => ({ value: collector.id, label: collector.displayName }))
	]);
</script>

<form method="POST" action={buyer ? '?/update' : '?/default'} class="flex flex-col gap-5">
	<FormResult
		result={form?.message ? { success: !!form.success, message: form.message, errors } : null}
		fields={FIELDS}
	/>
	{#if buyer}<input type="hidden" name="updatedAt" value={buyer.updatedAt} />{/if}
	<Field label="Tipo" id="type" error={errors.type?.[0]}>
		<Select
			name="type"
			bind:value={type}
			options={[
				{ value: 'individual', label: BUYER_TYPE_LABELS.individual },
				{ value: 'business', label: BUYER_TYPE_LABELS.business }
			]}
		/>
	</Field>
	{#if type === 'individual'}
		<div class="grid gap-5 sm:grid-cols-2">
			<Field label="Nombre" id="firstName" error={errors.firstName?.[0]} optional>
				<TextInput
					name="firstName"
					autocomplete="given-name"
					maxlength={PARTY_LIMITS.firstName}
					value={value('firstName', buyer?.firstName ?? '')}
				/>
			</Field>
			<Field label="Apellido" id="lastName" error={errors.lastName?.[0]} optional>
				<TextInput
					name="lastName"
					autocomplete="family-name"
					maxlength={PARTY_LIMITS.lastName}
					value={value('lastName', buyer?.lastName ?? '')}
				/>
			</Field>
		</div>
		<Field
			label="Número de documento"
			id="documentNumber"
			hint="DNI u otro documento, tal como figura."
			error={errors.documentNumber?.[0]}
			optional
		>
			<TextInput
				name="documentNumber"
				mono
				autocomplete="off"
				maxlength={PARTY_LIMITS.documentNumber}
				value={value('documentNumber', buyer?.documentNumber ?? '')}
			/>
		</Field>
	{:else}
		<Field label="Razón social" id="businessName" error={errors.businessName?.[0]} required>
			<TextInput
				name="businessName"
				autocomplete="organization"
				maxlength={PARTY_LIMITS.businessName}
				value={value('businessName', buyer?.businessName ?? '')}
			/>
		</Field>
		<Field label="CUIT" id="taxId" error={errors.taxId?.[0]} optional>
			<TextInput
				name="taxId"
				mono
				autocomplete="off"
				maxlength={PARTY_LIMITS.taxId}
				value={value('taxId', buyer?.taxId ?? '')}
			/>
		</Field>
	{/if}
	<div class="grid gap-5 sm:grid-cols-2">
		<Field label="Teléfono" id="phone" error={errors.phone?.[0]} optional>
			<TextInput
				name="phone"
				type="tel"
				autocomplete="tel"
				inputmode="tel"
				maxlength={PARTY_LIMITS.phone}
				value={value('phone', buyer?.phone ?? '')}
			/>
		</Field>
		<Field
			label="Cobrador habitual"
			id="usualCollectorId"
			hint={!canViewCollectors && !buyer?.usualCollectorId
				? 'No se pueden ver los cobradores. Pedir a un administrador que lo asigne.'
				: undefined}
			error={errors.usualCollectorId?.[0]}
			optional
		>
			<Select name="usualCollectorId" value={collectorValue()} options={collectorOptions} />
		</Field>
	</div>
	<Field label="Domicilio" id="address" error={errors.address?.[0]} optional>
		<TextInput
			name="address"
			autocomplete="street-address"
			maxlength={PARTY_LIMITS.address}
			value={value('address', buyer?.address ?? '')}
		/>
	</Field>
	<Field label="Notas" id="notes" error={errors.notes?.[0]} optional>
		<Textarea
			name="notes"
			maxlength={PARTY_LIMITS.notes}
			value={value('notes', buyer?.notes ?? '')}
		/>
	</Field>
	{#if form?.duplicates?.length}
		<Alert tone="warning" title="Posibles compradores duplicados">
			<ul class="m-0 list-disc pl-5">
				{#each form.duplicates as duplicate (duplicate.id)}
					<li>
						<a
							class="rounded-sm text-primary-text underline underline-offset-2"
							href={resolve('/campaigns/[id]/buyers/[buyerId]', {
								id: campaignId,
								buyerId: duplicate.id
							})}>{duplicate.name}</a
						>
					</li>
				{/each}
			</ul>
			<div class="mt-3">
				<Checkbox
					name="createAnyway"
					label={buyer ? 'Guardar de todos modos' : 'Crear de todos modos'}
				/>
			</div>
		</Alert>
	{/if}
	<div class="flex flex-wrap gap-2">
		<Button type="submit" variant="primary">{buyer ? 'Guardar cambios' : 'Crear comprador'}</Button>
		{#if cancelHref}<Button href={cancelHref}>Cancelar</Button>{/if}
	</div>
</form>
