<script lang="ts">
	import type { ImportItemStatus } from '$lib/domain/imports';
	import { IMPORT_ITEM_STATUS_LABELS } from '$lib/domain/import-preview';

	let { status, removed = false }: { status: ImportItemStatus; removed?: boolean } = $props();

	const TONES: Record<ImportItemStatus, string> = {
		pending: 'bg-slate-100 text-slate-700',
		valid: 'bg-green-100 text-green-800',
		warning: 'bg-amber-100 text-amber-900',
		error: 'bg-red-100 text-red-800'
	};
</script>

<span
	class="inline-flex rounded-full px-2 py-0.5 text-xs font-medium {removed
		? 'bg-slate-100 text-slate-500 line-through'
		: TONES[status]}"
>
	{removed ? 'Removed' : IMPORT_ITEM_STATUS_LABELS[status]}
</span>
