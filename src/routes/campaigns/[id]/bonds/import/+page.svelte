<script lang="ts">
	import { institutionName } from '$lib/institution';
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
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
	import { IMPORT_SOURCE_LABELS } from '$lib/domain/import-preview';
	import { IMPORT_MAX_FILE_BYTES, IMPORT_MAX_ROWS } from '$lib/domain/imports';
	import { formatDateTime, formatNumber } from '$lib/format';
	import type { PageProps } from './$types';

	/**
	 * File import: upload a CSV or Excel file, then review it on the preview page (the upload
	 * redirects there). Lists the campaign's file imports, newest first.
	 */
	let { data, form }: PageProps = $props();

	const campaign = $derived(data.campaign);
	const campaignHref = $derived(resolve('/campaigns/[id]', { id: campaign.id }));
	const sessionHref = (sessionId: string) =>
		resolve('/campaigns/[id]/bonds/import/[sessionId]', { id: campaign.id, sessionId });
	let uploading = $state(false);

	const fileErrors = $derived(form?.errors?.file);
	const notesErrors = $derived(form?.errors?.notes);

	type SessionRow = (typeof data.sessions)[number] & Record<string, unknown>;
	const columns: TableColumn<SessionRow>[] = [
		{ key: 'file', header: 'Archivo' },
		{ key: 'type', header: 'Tipo' },
		{ key: 'status', header: 'Estado' },
		{ key: 'uploaded', header: 'Subido' },
		{ key: 'open', header: 'Acción', align: 'right' }
	];
	const rows = $derived(data.sessions as SessionRow[]);
</script>

<svelte:head>
	<title>Importar bonos - {campaign.name} - {institutionName()}</title>
</svelte:head>

<PageHeader
	title="Importar bonos desde un archivo"
	description="Subir un archivo CSV o de Excel, revisar las filas y confirmar. No se crea nada hasta confirmar."
	breadcrumbs={[
		{ label: 'Campañas', href: resolve('/campaigns') },
		{ label: campaign.name, href: campaignHref },
		{ label: 'Bonos', href: resolve('/campaigns/[id]/bonds', { id: campaign.id }) },
		{ label: 'Importar archivo' }
	]}
>
	{#snippet actions()}
		<StatusBadge kind="campaign" status={campaign.status} />
	{/snippet}
</PageHeader>

<div class="flex flex-col gap-6">
	<p class="m-0 text-body-sm">
		<a
			href={resolve('/campaigns/[id]/bonds/scan', { id: campaign.id })}
			class="text-primary-text underline-offset-2 underline"
			>Usar el lector de códigos de barras →</a
		>
	</p>

	{#if !data.canLoad}
		<Alert tone="warning" title="No se pueden importar bonos">{data.lockedMessage}</Alert>
	{:else}
		{#if form?.message && !form.success && !fileErrors?.length && !notesErrors?.length}
			<Alert tone="danger">{form.message}</Alert>
		{/if}

		<Card title="Subir un archivo" id="upload">
			<div class="flex flex-col gap-5">
				<div class="text-body-sm text-muted">
					<p class="m-0">
						La primera fila debe tener los nombres de las columnas
						<code class="rounded-sm bg-surface-sunken px-1 font-mono"
							>tipo_bono,grupo_pata,numero_base,barcode</code
						>. Las filas que comparten un
						<code class="rounded-sm bg-surface-sunken px-1 font-mono">grupo_pata</code> forman una pata
						(cada fila de una pata necesita su código de barras).
					</p>
					<pre
						class="m-0 mt-2 overflow-x-auto rounded-lg bg-surface-sunken p-3 font-mono text-caption">tipo_bono,grupo_pata,numero_base,barcode
simple,,1658,1658
pata,PATA1200,1200,PATA1200-1200
pata,PATA1200,1315,PATA1200-1315</pre>
				</div>
				{#if campaign.status === 'draft'}
					<Alert tone="warning">
						Esta campaña es un borrador. <strong
							>Confirmar la primera importación congela sus reglas</strong
						>
						(precio, cuotas, numeración, política de desborde y modo de código de barras).
					</Alert>
				{/if}

				<form
					method="POST"
					action="?/upload"
					enctype="multipart/form-data"
					class="flex flex-col gap-5"
					use:enhance={() => {
						uploading = true;
						return async ({ update }) => {
							await update();
							uploading = false;
						};
					}}
				>
					<Field
						label="Archivo (.csv o .xlsx)"
						id="file"
						required
						hint={`Hasta ${Math.round(IMPORT_MAX_FILE_BYTES / 1024 / 1024)} MB y ${formatNumber(IMPORT_MAX_ROWS)} filas. En Excel se lee la primera hoja.`}
						error={fileErrors?.[0]}
					>
						<TextInput
							name="file"
							type="file"
							accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
						/>
					</Field>
					<Field label="Notas" id="notes" optional error={notesErrors?.[0]}>
						<TextInput
							name="notes"
							type="text"
							maxlength={2000}
							value={form?.values?.notes ?? ''}
							placeholder="Por ejemplo: lote de impresión de marzo"
						/>
					</Field>
					<div>
						<Button type="submit" variant="primary" loading={uploading}>
							{uploading ? 'Leyendo el archivo…' : 'Subir y revisar'}
						</Button>
					</div>
				</form>
			</div>
		</Card>
	{/if}

	<section aria-labelledby="history-title" class="flex flex-col gap-3">
		<h2 id="history-title" class="m-0 text-heading-3">Importaciones de archivos</h2>
		{#if data.sessions.length === 0}
			<EmptyState title="Todavía no hay importaciones">
				Subir un archivo CSV o XLSX para cargar bonos en lote.
			</EmptyState>
		{:else}
			<Table {columns} {rows} caption="Importaciones de archivos">
				{#snippet cell({ row, column })}
					{#if column.key === 'file'}
						<span class="font-medium">{row.fileName}</span>
						{#if row.notes}<span class="block text-caption text-muted">{row.notes}</span>{/if}
					{:else if column.key === 'type'}
						{IMPORT_SOURCE_LABELS[row.sourceType]}
					{:else if column.key === 'status'}
						<StatusBadge
							kind="importSession"
							status={row.rolledBackAt !== null ? 'rolled_back' : row.status}
						/>
					{:else if column.key === 'uploaded'}
						<span class="tabular-nums">{formatDateTime(row.createdAt)}</span>
					{:else if column.key === 'open'}
						<Button href={sessionHref(row.id)} size="sm">
							{row.status === 'draft' || row.status === 'validated' ? 'Revisar' : 'Ver'}
						</Button>
					{/if}
				{/snippet}
			</Table>
		{/if}
	</section>
</div>
