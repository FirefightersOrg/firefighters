<script lang="ts">
	import '../app.css';
	import UpdatePrompt from '$lib/pwa/UpdatePrompt.svelte';
	import favicon from '$lib/assets/favicon.svg';

	let { children } = $props();
</script>

<svelte:head>
	<link rel="icon" href={favicon} />
</svelte:head>

{@render children()}

<UpdatePrompt />
