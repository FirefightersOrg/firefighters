<script lang="ts">
	import { tick } from 'svelte';
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import type { ResolvedPathname } from '$app/types';
	import ImportSummaryPanel from '$lib/components/imports/ImportSummaryPanel.svelte';
	import {
		Alert,
		Button,
		Card,
		EmptyState,
		Field,
		PageHeader,
		StatusBadge,
		Table,
		TextInput,
		type TableColumn
	} from '$lib/components/ui';
	import { BARCODE_MODE_LABELS } from '$lib/domain/campaigns';
	import { translateImportMessage } from '$lib/domain/import-messages';
	import { formatImportNumber } from '$lib/domain/import-preview';
	import { formatDateTime } from '$lib/format';
	import type { ImportItem } from '$lib/server/repositories/imports';
	import type { ImportSessionSummary as ImportSummary } from '$lib/server/services/imports';
	import type { PageProps } from './$types';

	/**
	 * Barcode scanner (keyboard wedge): the scanner types the code and presses Enter (or Tab), the
	 * form submits without a page reload, the result beeps (high = staged, low = problem) and the
	 * code field is focused again, so scanning never needs the mouse. A pata is scanned with its
	 * grupo_pata filled in; it stays filled until cleared. The result of each read goes to a polite
	 * live region.
	 */
	let { data, form }: PageProps = $props();

	const campaign = $derived(data.campaign);
	const campaignHref = $derived(resolve('/campaigns/[id]', { id: campaign.id }));
	const previewHref = (sessionId: string) =>
		resolve('/campaigns/[id]/bonds/import/[sessionId]', { id: campaign.id, sessionId });
	/** The scanner on an open batch (resolved pathname plus a search string, hence the cast). */
	const scanHref = (sessionId: string) =>
		`${resolve('/campaigns/[id]/bonds/scan', { id: campaign.id })}?session=${sessionId}` as ResolvedPathname;
	const number = (value: number | null) => formatImportNumber(value, campaign.numberDigits);

	let barcode = $state('');
	let baseNumber = $state('');
	let groupKey = $state('');
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
		document.getElementById('barcode')?.focus();
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

	type ScanRow = ImportItem & Record<string, unknown>;
	const scanColumns: TableColumn<ScanRow>[] = [
		{ key: 'rowNumber', header: 'N.º', align: 'right' },
		{ key: 'barcode', header: 'Código', mono: true },
		{ key: 'base', header: 'Número base', mono: true },
		{ key: 'pata', header: 'Pata' },
		{ key: 'status', header: 'Estado' }
	];
	const scanRows = $derived(recent as ScanRow[]);
</script>

<svelte:head>
	<title>Escanear bonos - {campaign.name} - Firefighters</title>
</svelte:head>

<PageHeader
	title="Escanear bonos"
	description={`Modo de código de barras: ${BARCODE_MODE_LABELS[campaign.barcodeMode]}. Los escaneos se verifican al instante y solo crean bonos al confirmar el lote.`}
	breadcrumbs={[
		{ label: 'Campañas', href: resolve('/campaigns') },
		{ label: campaign.name, href: campaignHref },
		{ label: 'Bonos', href: resolve('/campaigns/[id]/bonds', { id: campaign.id }) },
		{ label: 'Escanear bonos' }
	]}
>
	{#snippet actions()}
		<StatusBadge kind="campaign" status={campaign.status} />
	{/snippet}
</PageHeader>

<div class="flex flex-col gap-6">
	<p class="m-0 text-body-sm">
		<a
			href={resolve('/campaigns/[id]/bonds/import', { id: campaign.id })}
			class="text-primary-text underline-offset-2 hover:underline">Importar un archivo →</a
		>
	</p>

	{#if !data.canLoad}
		<Alert tone="warning" title="No se pueden escanear bonos">{data.lockedMessage}</Alert>
	{:else if !data.session}
		{#if form?.message && !form.success}<Alert tone="danger">{form.message}</Alert>{/if}
		<Card title="Iniciar un lote de escaneo" id="start">
			<form method="POST" action="?/start" class="flex flex-wrap items-end gap-3" use:enhance>
				<div class="min-w-64 flex-1">
					<Field label="Notas" id="notes" optional>
						<TextInput name="notes" maxlength={2000} placeholder="Por ejemplo: caja 3" />
					</Field>
				</div>
				<Button type="submit" variant="primary">Iniciar escaneo</Button>
			</form>
		</Card>
		{#if data.openSessions.length > 0}
			<Card title="Lotes de escaneo abiertos" id="open">
				<ul class="m-0 list-none divide-y divide-border p-0 text-body-sm">
					{#each data.openSessions as open (open.id)}
						<li class="flex flex-wrap items-center justify-between gap-2 py-2">
							<span>
								Iniciado el {formatDateTime(open.createdAt)}{open.notes ? ` · ${open.notes}` : ''}
							</span>
							<span class="flex gap-2">
								<Button href={scanHref(open.id)}>Continuar</Button>
								<Button href={previewHref(open.id)}>Revisar</Button>
							</span>
						</li>
					{/each}
				</ul>
			</Card>
		{/if}
	{:else}
		{@const session = data.session}
		<div
			class="rounded-lg transition-colors {flash === 'ok'
				? 'ring-4 ring-success'
				: flash === 'error'
					? 'ring-4 ring-danger'
					: ''}"
		>
			<Card title="Escáner" id="scanner">
				{#snippet actions()}
					<Button variant="primary" href={previewHref(session.id)}>Revisar y confirmar</Button>
				{/snippet}
				<div class="flex flex-col gap-4">
					<form
						method="POST"
						action="?/scan"
						class="grid gap-4 sm:grid-cols-4 sm:items-end"
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
							<Field
								label="Código de barras"
								id="barcode"
								required
								hint="Apuntar el lector acá. Enter o Tab envían el código."
								error={form?.form === 'scan' ? form.errors?.barcode?.[0] : undefined}
							>
								<TextInput
									name="barcode"
									bind:value={barcode}
									onkeydown={onBarcodeKeydown}
									autocomplete="off"
									autocapitalize="off"
									spellcheck={false}
									maxlength={200}
									mono
								/>
							</Field>
						</div>
						{#if data.needsBaseNumber}
							<Field
								label="Número base"
								id="baseNumber"
								hint="Esta campaña lo necesita ingresado con cada código."
								error={form?.form === 'scan' ? form.errors?.baseNumber?.[0] : undefined}
							>
								<TextInput
									name="baseNumber"
									bind:value={baseNumber}
									inputmode="numeric"
									autocomplete="off"
									mono
								/>
							</Field>
						{/if}
						<Field
							label="grupo_pata (solo patas)"
							id="groupKey"
							hint={groupKey.trim()
								? `Escaneando unidades de la pata ${groupKey.trim()}.`
								: 'Vacío: bonos simples.'}
						>
							<TextInput
								name="groupKey"
								bind:value={groupKey}
								maxlength={200}
								autocomplete="off"
								mono
							/>
						</Field>
						<div class="sm:hidden">
							<Button type="submit" variant="primary" size="lg" block loading={sending}>
								Agregar
							</Button>
						</div>
					</form>

					<div aria-live="polite" class="min-h-6 text-body-sm">
						{#if form?.form === 'scan' && form.message}
							<p class="m-0 {form.success ? 'text-success-text' : 'text-danger-text'}">
								{form.scanned
									? `Fila ${form.scanned.rowNumber}: ${form.success ? `${number(form.scanned.baseNumber)} cargado.` : form.message}`
									: form.message}
							</p>
						{/if}
					</div>
				</div>
			</Card>
		</div>

		{#if summary}
			<section aria-labelledby="scan-summary-title" class="flex flex-col gap-2">
				<h2 id="scan-summary-title" class="sr-only">Resumen del lote</h2>
				<ImportSummaryPanel {summary} />
			</section>
		{/if}

		<Card title="Últimos escaneos" id="recent">
			{#if recent.length === 0}
				<EmptyState title="Todavía no se escaneó nada">
					Apuntar el lector al campo del código de barras para empezar.
				</EmptyState>
			{:else}
				<div class="flex flex-col gap-3">
					<Table columns={scanColumns} rows={scanRows} caption="Últimos escaneos" density="compact">
						{#snippet cell({ row, column })}
							{#if column.key === 'rowNumber'}
								<span class="tabular-nums">{row.rowNumber}</span>
							{:else if column.key === 'barcode'}
								{row.barcode ?? '—'}
							{:else if column.key === 'base'}
								{number(row.baseNumber)}
							{:else if column.key === 'pata'}
								{row.groupKey ?? '—'}
							{:else if column.key === 'status'}
								<StatusBadge kind="importItem" status={row.status} />
								{#if row.errorMessage}<span class="ml-2 text-caption text-muted"
										>{translateImportMessage(row.errorMessage)}</span
									>{/if}
							{/if}
						{/snippet}
					</Table>
					<p class="m-0 text-body-sm text-muted">
						Los estados son los de cada escaneo; un escaneo posterior puede convertir uno anterior
						en duplicado. La página de revisión muestra el estado actual.
					</p>
				</div>
			{/if}
		</Card>
	{/if}
</div>
