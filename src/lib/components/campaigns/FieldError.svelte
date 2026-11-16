<script lang="ts">
	let { id, errors }: { id: string; errors?: string[] } = $props();
</script>

{#if errors?.length}
	<p {id} class="mt-1 text-xs text-red-600">{errors[0]}</p>
{/if}
