<script lang="ts">
	import { resolve } from '$app/paths';
	import { secondaryButtonClass } from '$lib/components/campaigns/styles';
	import type { ReportExportKey } from '$lib/domain/report-exports';

	/**
	 * CSV / Excel download links of one report (SAN-87). The links carry the active filters, so the
	 * file matches the screen. Rendered only for users with `report.export`.
	 */
	let {
		campaignId,
		report,
		params,
		show
	}: {
		campaignId: string;
		report: ReportExportKey;
		/** Active filters, as the query-string names the page uses (null/empty are skipped). */
		params: Record<string, string | null | undefined>;
		show: boolean;
	} = $props();

	function href(format: 'csv' | 'xlsx') {
		const pairs = Object.entries({ ...params, format })
			.filter(([, value]) => value)
			.map(([name, value]) => `${name}=${encodeURIComponent(String(value))}`);
		return `${resolve('/campaigns/[id]/reports/export/[report]', { id: campaignId, report })}?${pairs.join('&')}`;
	}
</script>

{#if show}
	<div class="flex gap-2 text-sm">
		<!-- eslint-disable svelte/no-navigation-without-resolve -- the href is built from the resolved export path -->
		<a class={secondaryButtonClass} href={href('csv')} data-sveltekit-reload>Export CSV</a>
		<a class={secondaryButtonClass} href={href('xlsx')} data-sveltekit-reload>Export Excel</a>
		<!-- eslint-enable svelte/no-navigation-without-resolve -->
	</div>
{/if}
