<script lang="ts">
	import type { ImportSessionStatus } from '$lib/domain/imports';
	import { IMPORT_SESSION_STATUS_LABELS } from '$lib/domain/import-preview';

	let { status, rolledBack = false }: { status: ImportSessionStatus; rolledBack?: boolean } =
		$props();

	const TONES: Record<ImportSessionStatus, string> = {
		draft: 'bg-slate-100 text-slate-700',
		validated: 'bg-blue-100 text-blue-800',
		confirmed: 'bg-green-100 text-green-800',
		cancelled: 'bg-slate-100 text-slate-500',
		failed: 'bg-red-100 text-red-800'
	};
</script>

<span
	class="inline-flex rounded-full px-2 py-0.5 text-xs font-medium {rolledBack
		? 'bg-amber-100 text-amber-900'
		: TONES[status]}"
>
	{rolledBack ? 'Rolled back' : IMPORT_SESSION_STATUS_LABELS[status]}
</span>
