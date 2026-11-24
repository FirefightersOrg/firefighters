<script lang="ts">
	// Test-only: Button with a text child (snippets cannot be passed from a .ts test).
	import Button from '../Button.svelte';
	import type { ComponentProps } from 'svelte';

	let { text = 'Guardar cambios', ...rest }: { text?: string } & ComponentProps<typeof Button> =
		$props();
</script>

<Button {...rest}>{text}</Button>
