<script lang="ts">
	import { resolve } from '$app/paths';
	import { RISKY_OPERATION_STEPS } from '$lib/domain/backup-exports';

	let {
		campaignId,
		operation,
		canExport
	}: { campaignId: string; operation: string; canExport: boolean } = $props();
</script>

<details
	class="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"
	aria-label="Checklist before {operation}"
>
	<summary class="cursor-pointer font-medium">Before {operation}: 6-step checklist</summary>
	<ol class="mt-2 list-inside list-decimal space-y-1">
		{#each RISKY_OPERATION_STEPS as step (step)}
			<li>{step}</li>
		{/each}
	</ol>
	<p class="mt-2">
		{#if canExport}
			Step 1:
			<a
				href={resolve('/campaigns/[id]/backups', { id: campaignId })}
				class="font-medium text-blue-700 underline">download the backup exports</a
			>.
		{:else}
			Step 1 needs someone with the export permission (administrator).
		{/if}
		Steps 2, 3, 5 and 6 are recorded outside the app (see docs/backup-operations.md).
	</p>
</details>
