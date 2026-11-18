<script lang="ts">
	import { resolve } from '$app/paths';
	import { inputClass, labelClass, primaryButtonClass } from '$lib/components/campaigns/styles';
	import type { Buyer } from '$lib/domain/parties';
	let {
		buyer = null,
		campaignId,
		collectors,
		form
	}: {
		buyer?: Buyer | null;
		campaignId: string;
		collectors: { id: string; displayName: string }[];
		form:
			| {
					values?: Record<string, unknown>;
					errors?: Record<string, string[]>;
					duplicates?: { id: string; name: string }[];
			  }
			| null
			| undefined;
	} = $props();
	let type = $state(buyer?.type ?? form?.values?.type ?? 'individual');
	const value = (name: string, fallback = '') => {
		const candidate = form?.values?.[name];
		return typeof candidate === 'string' ? candidate : fallback;
	};
</script>

<form method="POST" action={buyer ? '?/update' : '?/default'} class="space-y-4">
	{#if buyer}<input type="hidden" name="updatedAt" value={buyer.updatedAt} />{/if}
	<div>
		<label for="type" class={labelClass}>Type</label><select
			id="type"
			name="type"
			bind:value={type}
			class={inputClass}
			><option value="individual">Individual</option><option value="business">Business</option
			></select
		>
	</div>
	{#if type === 'individual'}
		<div class="grid gap-4 sm:grid-cols-2">
			<div>
				<label for="firstName" class={labelClass}>First name</label><input
					id="firstName"
					name="firstName"
					class={inputClass}
					value={value('firstName', buyer?.firstName ?? '')}
				/>
			</div>
			<div>
				<label for="lastName" class={labelClass}>Last name</label><input
					id="lastName"
					name="lastName"
					class={inputClass}
					value={value('lastName', buyer?.lastName ?? '')}
				/>
			</div>
		</div>
		<div>
			<label for="documentNumber" class={labelClass}>Document number</label><input
				id="documentNumber"
				name="documentNumber"
				class={inputClass}
				value={value('documentNumber', buyer?.documentNumber ?? '')}
			/>
		</div>
	{:else}
		<div>
			<label for="businessName" class={labelClass}>Business name</label><input
				id="businessName"
				name="businessName"
				required
				class={inputClass}
				value={value('businessName', buyer?.businessName ?? '')}
			/>
		</div>
		<div>
			<label for="taxId" class={labelClass}>Tax ID</label><input
				id="taxId"
				name="taxId"
				class={inputClass}
				value={value('taxId', buyer?.taxId ?? '')}
			/>
		</div>
	{/if}
	<div class="grid gap-4 sm:grid-cols-2">
		<div>
			<label for="phone" class={labelClass}>Phone</label><input
				id="phone"
				name="phone"
				class={inputClass}
				value={value('phone', buyer?.phone ?? '')}
			/>
		</div>
		<div>
			<label for="usualCollectorId" class={labelClass}>Usual collector</label><select
				id="usualCollectorId"
				name="usualCollectorId"
				class={inputClass}
				><option value="">None</option>{#each collectors as collector (collector.id)}<option
						value={collector.id}
						selected={value('usualCollectorId', buyer?.usualCollectorId ?? '') === collector.id}
						>{collector.displayName}</option
					>{/each}</select
			>
		</div>
	</div>
	<div>
		<label for="address" class={labelClass}>Address</label><input
			id="address"
			name="address"
			class={inputClass}
			value={value('address', buyer?.address ?? '')}
		/>
	</div>
	<div>
		<label for="notes" class={labelClass}>Notes</label><textarea
			id="notes"
			name="notes"
			class={inputClass}>{value('notes', buyer?.notes ?? '')}</textarea
		>
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
