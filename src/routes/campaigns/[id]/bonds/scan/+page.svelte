<script lang="ts">
	import { tick } from 'svelte';
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import type { ResolvedPathname } from '$app/types';
	import CampaignStatusBadge from '$lib/components/campaigns/CampaignStatusBadge.svelte';
	import FieldError from '$lib/components/campaigns/FieldError.svelte';
	import FormAlert from '$lib/components/campaigns/FormAlert.svelte';
	import {
		cardClass,
		hintClass,
		inputClass,
		labelClass,
		primaryButtonClass,
		secondaryButtonClass
	} from '$lib/components/campaigns/styles';
	import ImportItemStatusBadge from '$lib/components/imports/ImportItemStatusBadge.svelte';
	import ImportSummaryPanel from '$lib/components/imports/ImportSummaryPanel.svelte';
	import { BARCODE_MODE_LABELS } from '$lib/domain/campaigns';
	import { formatImportNumber } from '$lib/domain/import-preview';
	import type { ImportItem } from '$lib/server/repositories/imports';
	import type { ImportSessionSummary as ImportSummary } from '$lib/server/services/imports';
	import type { PageProps } from './$types';

	/**
	 * Barcode scanner (keyboard wedge): the scanner types the code and presses Enter (or Tab), the
	 * form submits without a page reload, the result beeps (high = staged, low = problem) and the
	 * code field is focused again, so scanning never needs the mouse. A pata is scanned with its
	 * grupo_pata filled in; it stays filled until cleared.
	 */
	let { data, form }: PageProps = $props();

	const campaign = $derived(data.campaign);
	const campaignHref = $derived(resolve('/campaigns/[id]', { id: campaign.id }));
	const previewHref = (sessionId: string) =>
		resolve('/campaigns/[id]/bonds/import/[sessionId]', { id: campaign.id, sessionId });
	/** The scanner on an open batch (resolved pathname plus a search string, hence the cast). */
	const scanHref = (sessionId: string) =>
		`${resolve('/campaigns/[id]/bonds/scan', { id: campaign.id })}?session=${sessionId}` as ResolvedPathname;
	const dateTime = new Intl.DateTimeFormat('es-AR', { dateStyle: 'short', timeStyle: 'short' });
	const number = (value: number | null) => formatImportNumber(value, campaign.numberDigits);

	let barcode = $state('');
	let baseNumber = $state('');
	let groupKey = $state('');
	let barcodeInput = $state<HTMLInputElement>();
	let sending = $state(false);
	let flash = $state<'ok' | 'error' | null>(null);
	// Scans of this visit are prepended to what the server listed (newest first).
	let liveScans = $state<ImportItem[]>([]);
	let liveSummary = $state<ImportSummary | null>(null);
	const summary = $derived(liveSummary ?? data.summary);
	const recent = $derived(
		[...liveScans, ...data.recent.filter((r) => !liveScans.some((l) => l.id === r.id))].slice(0, 15)
	);

	let audio: AudioContext | null = null;
	function beep(ok: boolean) {
		try {
			audio ??= new AudioContext();
			const osc = audio.createOscillator();
			const gain = audio.createGain();
			osc.frequency.value = ok ? 1046 : 220;
			gain.gain.value = 0.08;
			osc.connect(gain).connect(audio.destination);
			osc.start();
			osc.stop(audio.currentTime + (ok ? 0.08 : 0.3));
		} catch {
			// Sound is a convenience; the visual feedback is always shown.
		}
	}

	async function focusBarcode() {
		await tick();
		barcodeInput?.focus();
	}

	function onBarcodeKeydown(event: KeyboardEvent) {
		// Many scanners end with Tab instead of Enter: treat it as a submit too.
		if (event.key === 'Tab' && !event.shiftKey && barcode.trim() !== '') {
			event.preventDefault();
			(event.currentTarget as HTMLInputElement).form?.requestSubmit();
		}
	}

	$effect(() => {
		if (data.session) focusBarcode();
	});
</script>

<svelte:head>
	<title>Scan bonds - {campaign.name} - Firefighters</title>
</svelte:head>

<div class="space-y-6">
	<div>
		<a href={campaignHref} class="text-sm text-blue-700 hover:underline">← {campaign.name}</a>
		<div class="mt-2 flex flex-wrap items-center gap-3">
			<h1 class="text-2xl font-bold tracking-tight">Scan bonds</h1>
			<CampaignStatusBadge status={campaign.status} />
		</div>
		<p class="text-sm text-slate-500">
			Barcode mode: {BARCODE_MODE_LABELS[campaign.barcodeMode]}. Scans are checked at once and only
			create bonds when you confirm the batch.
			<a
				href={resolve('/campaigns/[id]/bonds/import', { id: campaign.id })}
				class="text-blue-700 hover:underline">Import a file instead →</a
			>
		</p>
	</div>

	{#if !data.canLoad}
		<FormAlert kind="warning">
			<p><strong>Bonds cannot be scanned.</strong> {data.lockedMessage}</p>
		</FormAlert>
	{:else if !data.session}
		{#if form?.message && !form.success}<FormAlert message={form.message} />{/if}
		<section class="{cardClass} space-y-4" aria-labelledby="start-title">
			<h2 id="start-title" class="text-base font-semibold">Start a scan batch</h2>
			<form method="POST" action="?/start" class="flex flex-wrap items-end gap-3" use:enhance>
				<div class="min-w-64 flex-1">
					<label for="notes" class={labelClass}>Notes (optional)</label>
					<input
						id="notes"
						name="notes"
						maxlength="2000"
						class={inputClass}
						placeholder="For example: box 3"
					/>
				</div>
				<button type="submit" class={primaryButtonClass}>Start scanning</button>
			</form>
		</section>
		{#if data.openSessions.length > 0}
			<section class="{cardClass} space-y-3" aria-labelledby="open-title">
				<h2 id="open-title" class="text-base font-semibold">Open scan batches</h2>
				<ul class="divide-y divide-slate-100 text-sm">
					{#each data.openSessions as open (open.id)}
						<li class="flex flex-wrap items-center justify-between gap-2 py-2">
							<span>
								Started {dateTime.format(new Date(open.createdAt))}{open.notes
									? ` · ${open.notes}`
									: ''}
							</span>
							<span class="flex gap-2">
								<a href={scanHref(open.id)} class={secondaryButtonClass}>Continue</a>
								<a href={previewHref(open.id)} class={secondaryButtonClass}>Review</a>
							</span>
						</li>
					{/each}
				</ul>
			</section>
		{/if}
	{:else}
		{@const session = data.session}
		<section
			class="{cardClass} space-y-4 transition-colors {flash === 'ok'
				? 'ring-4 ring-green-300'
				: flash === 'error'
					? 'ring-4 ring-red-300'
					: ''}"
			aria-labelledby="scan-title"
		>
			<div class="flex flex-wrap items-center justify-between gap-3">
				<h2 id="scan-title" class="text-base font-semibold">Scanner</h2>
				<a href={previewHref(session.id)} class={primaryButtonClass}>Review and confirm</a>
			</div>
			<form
				method="POST"
				action="?/scan"
				class="grid gap-3 sm:grid-cols-4 sm:items-end"
				use:enhance={() => {
					// Clear at once: a fast scanner may send the next code before this answer arrives,
					// and clearing on the answer would wipe it.
					const sentBarcode = barcode;
					const sentBase = baseNumber;
					barcode = '';
					baseNumber = '';
					sending = true;
					return async ({ result, update }) => {
						sending = false;
						let staged = false;
						if (result.type === 'success' || result.type === 'failure') {
							const payload = result.data as
								| { success?: boolean; summary?: ImportSummary; scanned?: ImportItem | null }
								| undefined;
							if (payload?.summary) liveSummary = payload.summary;
							if (payload?.scanned) liveScans = [payload.scanned, ...liveScans];
							staged = !!payload?.scanned;
							const ok = result.type === 'success' && payload?.success !== false;
							flash = ok ? 'ok' : 'error';
							beep(ok);
							setTimeout(() => (flash = null), 600);
						} else {
							flash = 'error';
							beep(false);
							setTimeout(() => (flash = null), 600);
						}
						// Nothing was staged (rejected input, network error): give the code back to fix it,
						// unless the operator already scanned another one.
						if (!staged && barcode === '') {
							barcode = sentBarcode;
							baseNumber = sentBase;
						}
						await update({ reset: false, invalidateAll: false });
						focusBarcode();
					};
				}}
			>
				<input type="hidden" name="sessionId" value={session.id} />
				<div class="sm:col-span-2">
					<label for="barcode" class={labelClass}>Barcode</label>
					<input
						id="barcode"
						name="barcode"
						bind:this={barcodeInput}
						bind:value={barcode}
						onkeydown={onBarcodeKeydown}
						autocomplete="off"
						autocapitalize="off"
						spellcheck="false"
						maxlength="200"
						required
						class="{inputClass} font-mono text-lg"
						aria-describedby="barcode-hint"
					/>
					<p id="barcode-hint" class={hintClass}>
						Point the scanner here. Enter or Tab sends the code.
					</p>
					<FieldError
						id="barcode-error"
						errors={form?.form === 'scan' ? form.errors?.barcode : undefined}
					/>
				</div>
				{#if data.needsBaseNumber}
					<div>
						<label for="baseNumber" class={labelClass}>Base number</label>
						<input
							id="baseNumber"
							name="baseNumber"
							bind:value={baseNumber}
							inputmode="numeric"
							autocomplete="off"
							class="{inputClass} font-mono"
						/>
						<p class={hintClass}>This campaign needs it typed with each code.</p>
						<FieldError
							id="baseNumber-error"
							errors={form?.form === 'scan' ? form.errors?.baseNumber : undefined}
						/>
					</div>
				{/if}
				<div>
					<label for="groupKey" class={labelClass}>grupo_pata (patas only)</label>
					<input
						id="groupKey"
						name="groupKey"
						bind:value={groupKey}
						maxlength="200"
						autocomplete="off"
						class="{inputClass} font-mono"
					/>
					<p class={hintClass}>
						{groupKey.trim()
							? `Scanning units of pata ${groupKey.trim()}.`
							: 'Empty: simple bonds.'}
					</p>
				</div>
				<button type="submit" class="{primaryButtonClass} sm:hidden" disabled={sending}>Add</button>
			</form>

			<div aria-live="polite" class="min-h-6 text-sm">
				{#if form?.form === 'scan' && form.message}
					<p class={form.success ? 'text-green-700' : 'text-red-700'}>
						{form.scanned
							? `Row ${form.scanned.rowNumber}: ${form.success ? `${number(form.scanned.baseNumber)} staged.` : form.message}`
							: form.message}
					</p>
				{/if}
			</div>
		</section>

		{#if summary}
			<section aria-labelledby="scan-summary-title" class="space-y-2">
				<h2 id="scan-summary-title" class="sr-only">Batch summary</h2>
				<ImportSummaryPanel {summary} />
			</section>
		{/if}

		<section class="{cardClass} space-y-3" aria-labelledby="recent-title">
			<h2 id="recent-title" class="text-base font-semibold">Last scans</h2>
			{#if recent.length === 0}
				<p class="text-sm text-slate-500">Nothing scanned yet.</p>
			{:else}
				<table class="min-w-full text-sm">
					<thead class="text-left text-xs text-slate-500 uppercase">
						<tr>
							<th class="py-2 pr-3 font-medium">#</th>
							<th class="py-2 pr-3 font-medium">Code</th>
							<th class="py-2 pr-3 font-medium">Base</th>
							<th class="py-2 pr-3 font-medium">Pata</th>
							<th class="py-2 pr-3 font-medium">Status</th>
						</tr>
					</thead>
					<tbody class="divide-y divide-slate-100">
						{#each recent as item (item.id)}
							<tr>
								<td class="py-2 pr-3 tabular-nums">{item.rowNumber}</td>
								<td class="py-2 pr-3 font-mono">{item.barcode ?? '—'}</td>
								<td class="py-2 pr-3 font-mono tabular-nums">{number(item.baseNumber)}</td>
								<td class="py-2 pr-3">{item.groupKey ?? '—'}</td>
								<td class="py-2 pr-3">
									<ImportItemStatusBadge status={item.status} />
									{#if item.errorMessage}<span class="ml-2 text-xs text-slate-600"
											>{item.errorMessage}</span
										>{/if}
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
				<p class="text-xs text-slate-500">
					Statuses are as of each scan; a later scan can make an earlier one a duplicate. The review
					page shows the current state.
				</p>
			{/if}
		</section>
	{/if}
</div>
