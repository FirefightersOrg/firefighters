<script lang="ts">
	import { CAMPAIGN_STATUS_LABELS, type CampaignStatus } from '$lib/domain/campaigns';

	let { status }: { status: CampaignStatus } = $props();

	const TONES: Record<CampaignStatus, string> = {
		draft: 'bg-slate-100 text-slate-700 ring-slate-300',
		active: 'bg-green-50 text-green-800 ring-green-300',
		closing: 'bg-amber-50 text-amber-800 ring-amber-300',
		closed: 'bg-blue-50 text-blue-800 ring-blue-300',
		annulled: 'bg-red-50 text-red-800 ring-red-300'
	};
</script>

<span
	class="inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset {TONES[
		status
	]}"
>
	{CAMPAIGN_STATUS_LABELS[status]}
</span>
