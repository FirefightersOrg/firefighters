<script lang="ts">
	import { onMount } from 'svelte';
	import Toast from '$lib/components/ui/Toast.svelte';
	import { applyUpdate, watchForUpdate } from './update';

	let registration: ServiceWorkerRegistration | null = null;
	let available = $state(false);

	onMount(() => {
		if (!('serviceWorker' in navigator)) return;
		void navigator.serviceWorker.getRegistration().then((reg) => {
			if (!reg) return;
			registration = reg;
			watchForUpdate(
				reg,
				() => navigator.serviceWorker.controller !== null,
				() => (available = true)
			);
		});
	});

	function reload() {
		if (registration) applyUpdate(registration, navigator.serviceWorker, () => location.reload());
	}
</script>

{#if available}
	<!-- Has an action, so the toast stays until the person reloads (no auto-dismiss). -->
	<Toast tone="info">
		Nueva versión disponible
		{#snippet action()}
			<button
				type="button"
				class="min-h-control-sm cursor-pointer rounded-md bg-primary px-3 text-label font-medium text-on-primary hover:bg-primary-hover"
				onclick={reload}
			>
				Recargar
			</button>
		{/snippet}
	</Toast>
{/if}
