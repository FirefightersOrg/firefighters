<script lang="ts">
	import { resolve } from '$app/paths';
	import FieldError from '$lib/components/campaigns/FieldError.svelte';
	import { inputClass, labelClass, primaryButtonClass } from '$lib/components/campaigns/styles';
	import { PARTY_LIMITS, type Buyer } from '$lib/domain/parties';

	let {
		buyer = null,
		campaignId,
		collectors,
		usualCollectorNotVisible = false,
		canViewCollectors = true,
		form
	}: {
		buyer?: Buyer | null;
		campaignId: string;
		collectors: { id: string; displayName: string }[];
		usualCollectorNotVisible?: boolean;
		canViewCollectors?: boolean;
		form:
			| {
					values?: Record<string, unknown>;
					errors?: Record<string, string[]>;
					duplicates?: { id: string; name: string }[];
			  }
			| null
			| undefined;
	} = $props();

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
	const errors = (name: string) => form?.errors?.[name];
	const invalid = (name: string) => (errors(name) ? 'true' : undefined);
	const describedBy = (name: string) => (errors(name) ? `${name}-error` : undefined);
	const collectorValue = () => {
		const selected = value('usualCollectorId', buyer?.usualCollectorId ?? '');
		return usualCollectorNotVisible && selected === buyer?.usualCollectorId ? '__keep__' : selected;
	};
</script>

<form method="POST" action={buyer ? '?/update' : '?/default'} class="space-y-4">
	{#if buyer}<input type="hidden" name="updatedAt" value={buyer.updatedAt} />{/if}
	<div>
		<label for="type" class={labelClass}>Type</label>
		<select
			id="type"
			name="type"
			bind:value={type}
			class={inputClass}
			aria-invalid={invalid('type')}
			aria-describedby={describedBy('type')}
		>
			<option value="individual">Individual</option>
			<option value="business">Business</option>
		</select>
		<FieldError id="type-error" errors={errors('type')} />
	</div>
	{#if type === 'individual'}
		<div class="grid gap-4 sm:grid-cols-2">
			<div>
				<label for="firstName" class={labelClass}>First name</label>
				<input
					id="firstName"
					name="firstName"
					class={inputClass}
					maxlength={PARTY_LIMITS.firstName}
					value={value('firstName', buyer?.firstName ?? '')}
					aria-invalid={invalid('firstName')}
					aria-describedby={describedBy('firstName')}
				/>
				<FieldError id="firstName-error" errors={errors('firstName')} />
			</div>
			<div>
				<label for="lastName" class={labelClass}>Last name</label>
				<input
					id="lastName"
					name="lastName"
					class={inputClass}
					maxlength={PARTY_LIMITS.lastName}
					value={value('lastName', buyer?.lastName ?? '')}
					aria-invalid={invalid('lastName')}
					aria-describedby={describedBy('lastName')}
				/>
				<FieldError id="lastName-error" errors={errors('lastName')} />
			</div>
		</div>
		<div>
			<label for="documentNumber" class={labelClass}>Document number</label>
			<input
				id="documentNumber"
				name="documentNumber"
				class={inputClass}
				maxlength={PARTY_LIMITS.documentNumber}
				value={value('documentNumber', buyer?.documentNumber ?? '')}
				aria-invalid={invalid('documentNumber')}
				aria-describedby={describedBy('documentNumber')}
			/>
			<FieldError id="documentNumber-error" errors={errors('documentNumber')} />
		</div>
	{:else}
		<div>
			<label for="businessName" class={labelClass}>Business name</label>
			<input
				id="businessName"
				name="businessName"
				required
				class={inputClass}
				maxlength={PARTY_LIMITS.businessName}
				value={value('businessName', buyer?.businessName ?? '')}
				aria-invalid={invalid('businessName')}
				aria-describedby={describedBy('businessName')}
			/>
			<FieldError id="businessName-error" errors={errors('businessName')} />
		</div>
		<div>
			<label for="taxId" class={labelClass}>Tax ID</label>
			<input
				id="taxId"
				name="taxId"
				class={inputClass}
				maxlength={PARTY_LIMITS.taxId}
				value={value('taxId', buyer?.taxId ?? '')}
				aria-invalid={invalid('taxId')}
				aria-describedby={describedBy('taxId')}
			/>
			<FieldError id="taxId-error" errors={errors('taxId')} />
		</div>
	{/if}
	<div class="grid gap-4 sm:grid-cols-2">
		<div>
			<label for="phone" class={labelClass}>Phone</label>
			<input
				id="phone"
				name="phone"
				class={inputClass}
				maxlength={PARTY_LIMITS.phone}
				value={value('phone', buyer?.phone ?? '')}
				aria-invalid={invalid('phone')}
				aria-describedby={describedBy('phone')}
			/>
			<FieldError id="phone-error" errors={errors('phone')} />
		</div>
		<div>
			<label for="usualCollectorId" class={labelClass}>Usual collector</label>
			<select
				id="usualCollectorId"
				name="usualCollectorId"
				class={inputClass}
				aria-invalid={invalid('usualCollectorId')}
				aria-describedby={describedBy('usualCollectorId')}
				value={collectorValue()}
			>
				<option value="">None</option>
				{#if usualCollectorNotVisible}<option value="__keep__"
						>Current usual collector (not visible to you)</option
					>{/if}
				{#each collectors as collector (collector.id)}<option value={collector.id}
						>{collector.displayName}</option
					>{/each}
			</select>
			<FieldError id="usualCollectorId-error" errors={errors('usualCollectorId')} />
			{#if !canViewCollectors && !buyer?.usualCollectorId}<p class="mt-1 text-sm text-slate-500">
					You cannot see collectors; ask an admin to set it.
				</p>{/if}
		</div>
	</div>
	<div>
		<label for="address" class={labelClass}>Address</label>
		<input
			id="address"
			name="address"
			class={inputClass}
			maxlength={PARTY_LIMITS.address}
			value={value('address', buyer?.address ?? '')}
			aria-invalid={invalid('address')}
			aria-describedby={describedBy('address')}
		/>
		<FieldError id="address-error" errors={errors('address')} />
	</div>
	<div>
		<label for="notes" class={labelClass}>Notes</label>
		<textarea
			id="notes"
			name="notes"
			class={inputClass}
			maxlength={PARTY_LIMITS.notes}
			aria-invalid={invalid('notes')}
			aria-describedby={describedBy('notes')}>{value('notes', buyer?.notes ?? '')}</textarea
		>
		<FieldError id="notes-error" errors={errors('notes')} />
	</div>
	{#if form?.duplicates?.length}<div
			class="rounded border border-amber-300 bg-amber-50 p-3 text-sm"
		>
			<p>Possible duplicate buyers:</p>
			<ul>
				{#each form.duplicates as duplicate (duplicate.id)}<li>
						<a
							class="text-blue-700 underline"
							href={resolve('/campaigns/[id]/buyers/[buyerId]', {
								id: campaignId,
								buyerId: duplicate.id
							})}>{duplicate.name}</a
						>
					</li>{/each}
			</ul>
			<label class="mt-2 block"><input type="checkbox" name="createAnyway" /> Create anyway</label>
		</div>{/if}
	<button type="submit" class={primaryButtonClass}>{buyer ? 'Save changes' : 'Create buyer'}</button
	>
</form>
