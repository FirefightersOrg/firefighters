<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import FieldError from '$lib/components/campaigns/FieldError.svelte';
	import FormAlert from '$lib/components/campaigns/FormAlert.svelte';
	import {
		cardClass,
		inputClass,
		labelClass,
		primaryButtonClass,
		secondaryButtonClass
	} from '$lib/components/campaigns/styles';
	import { COLLECTOR_STATUSES, COLLECTOR_STATUS_LABELS } from '$lib/domain/parties';
	import type { PageProps } from './$types';
	let { data, form }: PageProps = $props();
	let submitting = $state(false);
</script>

<svelte:head><title>New collector - {data.campaign.name} - Firefighters</title></svelte:head>
<div class="space-y-6">
	<div>
		<a
			href={resolve('/campaigns/[id]/collectors', { id: data.campaign.id })}
			class="text-sm text-blue-700 hover:underline">← Collectors</a
		>
		<h1 class="mt-2 text-2xl font-bold">New collector</h1>
	</div>
	{#if form?.message}<FormAlert message={form.message} />{/if}
	<form
		method="POST"
		use:enhance={() => {
			submitting = true;
			return async ({ update }) => {
				await update();
				submitting = false;
			};
		}}
		class="{cardClass} space-y-4"
	>
		<div>
			<label for="displayName" class={labelClass}>Display name</label><input
				id="displayName"
				name="displayName"
				required
				value={form?.values?.displayName ?? ''}
				class={inputClass}
			/><FieldError id="displayName-error" errors={form?.errors?.displayName} />
		</div>
		<div class="grid gap-4 sm:grid-cols-2">
			<div>
				<label for="phone" class={labelClass}>Phone</label><input
					id="phone"
					name="phone"
					value={form?.values?.phone ?? ''}
					class={inputClass}
				/><FieldError id="phone-error" errors={form?.errors?.phone} />
			</div>
			<div>
				<label for="email" class={labelClass}>Email</label><input
					id="email"
					name="email"
					type="email"
					value={form?.values?.email ?? ''}
					class={inputClass}
				/><FieldError id="email-error" errors={form?.errors?.email} />
			</div>
		</div>
		<div>
			<label for="address" class={labelClass}>Address</label><input
				id="address"
				name="address"
				value={form?.values?.address ?? ''}
				class={inputClass}
			/><FieldError id="address-error" errors={form?.errors?.address} />
		</div>
		<div class="grid gap-4 sm:grid-cols-2">
			<div>
				<label for="status" class={labelClass}>Status</label><select
					id="status"
					name="status"
					class={inputClass}
					>{#each COLLECTOR_STATUSES as status (status)}<option
							value={status}
							selected={(form?.values?.status ?? 'active') === status}
							>{COLLECTOR_STATUS_LABELS[status]}</option
						>{/each}</select
				>
			</div>
			<div>
				<label for="userProfileId" class={labelClass}>Linked user (optional)</label><select
					id="userProfileId"
					name="userProfileId"
					class={inputClass}
					><option value="">None</option>{#each data.profiles as profile (profile.id)}<option
							value={profile.id}
							selected={form?.values?.userProfileId === profile.id}
							>{profile.fullName} — {profile.email}</option
						>{/each}</select
				><FieldError id="userProfileId-error" errors={form?.errors?.userProfileId} />
			</div>
		</div>
		<div class="flex gap-3">
			<button disabled={submitting} class={primaryButtonClass}
				>{submitting ? 'Saving…' : 'Save collector'}</button
			><a
				href={resolve('/campaigns/[id]/collectors', { id: data.campaign.id })}
				class={secondaryButtonClass}>Cancel</a
			>
		</div>
	</form>
</div>
