<script lang="ts">
	import { onMount } from 'svelte';
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
	<div
		role="status"
		class="fixed inset-x-4 bottom-4 z-50 mx-auto flex max-w-md items-center justify-between gap-3 rounded-lg border border-gray-300 bg-white px-4 py-3 text-sm shadow-lg"
	>
		<span>Nueva versión disponible</span>
		<button
			type="button"
			class="rounded-md bg-gray-900 px-3 py-1.5 font-medium text-white hover:bg-gray-700"
			onclick={reload}
		>
			Recargar
		</button>
	</div>
{/if}
