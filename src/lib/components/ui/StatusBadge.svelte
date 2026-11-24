<script lang="ts" generics="K extends StatusKind">
	import Badge from './Badge.svelte';
	import { statusMeta, type StatusKind, type StatusOf } from './status';

	/** Badge for any domain status: tone and Spanish label come from the central map. */
	let { kind, status }: { kind: K; status: StatusOf<K> } = $props();

	const meta = $derived(statusMeta(kind, status));
</script>

<Badge tone={meta.tone}>{meta.label}</Badge>
