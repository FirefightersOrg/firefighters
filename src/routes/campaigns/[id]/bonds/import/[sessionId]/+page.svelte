<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import type { ResolvedPathname } from '$app/types';
	import RiskyOperationChecklist from '$lib/components/backups/RiskyOperationChecklist.svelte';
	import ImportSummaryPanel from '$lib/components/imports/ImportSummaryPanel.svelte';
	import {
		Alert,
		Button,
		Card,
		Dialog,
		EmptyState,
		Field,
		PageHeader,
		Select,
		StatusBadge,
		Table,
		TextInput,
		type TableColumn
	} from '$lib/components/ui';
	import { translateImportMessage } from '$lib/domain/import-messages';
	import {
		IMPORT_ITEM_FILTERS,
		IMPORT_SOURCE_LABELS,
		canConfirmImport,
		canValidateImport,
		formatImportNumber,
		type ImportItemFilter
	} from '$lib/domain/import-preview';
	import { formatDateTime, formatNumber } from '$lib/format';
	import type { ImportItem } from '$lib/server/repositories/imports';
	import type { PageProps } from './$types';

	/**
	 * Preview of an import: the seven metrics, the rows filtered by status, row correction and
	 * removal while the session is open, then validate → confirm. Confirm stays disabled while
	 * there is any blocking error (the database revalidates on confirmation anyway).
	 */
	let { data, form }: PageProps = $props();

	const campaign = $derived(data.campaign);
	const session = $derived(data.session);
	const summary = $derived(data.summary);
	const isScan = $derived(session.sourceType === 'barcode_scan');
	const backHref = $derived(
		isScan
			? resolve('/campaigns/[id]/bonds/scan', { id: campaign.id })
			: resolve('/campaigns/[id]/bonds/import', { id: campaign.id })
	);
	const scanHref = $derived(
		`${resolve('/campaigns/[id]/bonds/scan', { id: campaign.id })}?session=${session.id}` as ResolvedPathname
	);
	const bondsHref = $derived(resolve('/campaigns/[id]/bonds', { id: campaign.id }));
	const bondHref = (bondId: string) =>
		resolve('/campaigns/[id]/bonds/[bondId]', { id: campaign.id, bondId });

	const FILTER_LABELS: Record<ImportItemFilter, string> = {
		all: 'Todas las filas',
		valid: 'Válidas',
		warning: 'Con observaciones',
		error: 'Con errores'
	};
	const previewHref = $derived(
		resolve('/campaigns/[id]/bonds/import/[sessionId]', { id: campaign.id, sessionId: session.id })
	);
	/**
	 * This preview with another filter or page. The pathname is `resolve()`d; only a search string
	 * is appended, which `ResolvedPathname` does not model (hence the cast).
	 */
	function previewLink(filter: ImportItemFilter, target = 1): ResolvedPathname {
		const pairs: string[] = [];
		if (filter !== 'all') pairs.push(`status=${filter}`);
		if (target > 1) pairs.push(`page=${target}`);
		return (pairs.length ? `${previewHref}?${pairs.join('&')}` : previewHref) as ResolvedPathname;
	}
	const pageCount = $derived(Math.max(1, Math.ceil(data.total / data.pageSize)));

	const number = (value: number | null) => formatImportNumber(value, campaign.numberDigits);
	const associated = (value: number | null) =>
		formatImportNumber(
			value === null ? null : value + campaign.associatedNumberOffset,
			campaign.numberDigits
		);

	let editing = $state<string | null>(null);
	let busy = $state<string | null>(null);
	let removing = $state<ImportItem | null>(null);
	let cancelling = $state(false);
	let rollingBack = $state(false);
	const canConfirm = $derived(data.canEdit && canConfirmImport(summary));
	const canValidate = $derived(data.canEdit && canValidateImport(summary));
	const justConfirmed = $derived(data.justConfirmed);
	const bondCount = $derived(summary.simpleItems + summary.pataGroups);

	/** The failed edit of this row, to keep its form open with the typed values. */
	const editFailure = (item: ImportItem) =>
		form && !form.success && form.form === 'update' && form.itemId === item.id ? form : null;
	const editItem = $derived(
		data.canEdit
			? (data.items.find(
					(item) => item.removedAt === null && (editing === item.id || !!editFailure(item))
				) ?? null)
			: null
	);
	const failure = $derived(editItem ? editFailure(editItem) : null);

	function submitting(key: string) {
		return () => {
			busy = key;
			return async ({ update }: { update: (o?: { reset?: boolean }) => Promise<void> }) => {
				await update({ reset: false });
				busy = null;
			};
		};
	}

	type ItemRow = ImportItem & Record<string, unknown>;
	const columns: TableColumn<ItemRow>[] = $derived([
		{ key: 'rowNumber', header: 'Fila', align: 'right' },
		{ key: 'status', header: 'Estado' },
		{ key: 'type', header: 'Tipo' },
		{ key: 'pata', header: 'Pata' },
		{ key: 'numbers', header: 'Base / asociado' },
		{ key: 'barcode', header: 'Código de barras' },
		{ key: 'problem', header: 'Problema' },
		...(data.canEdit ? [{ key: 'actions', header: 'Acciones', align: 'right' as const }] : [])
	]);
	const rows = $derived(data.items as ItemRow[]);
	const TYPE_LABELS = { simple: 'Bono simple', pata: 'Pata' } as const;
</script>

<svelte:head>
	<title>Revisión de importación - {campaign.name} - Firefighters</title>
</svelte:head>

<PageHeader
	title={isScan ? 'Lote de escaneo' : (session.fileName ?? 'Importación')}
	description={`${IMPORT_SOURCE_LABELS[session.sourceType]} · ${campaign.name} · iniciada el ${formatDateTime(session.createdAt)}${session.notes ? ` · ${session.notes}` : ''}`}
	breadcrumbs={[
		{ label: 'Campañas', href: resolve('/campaigns') },
		{ label: campaign.name, href: resolve('/campaigns/[id]', { id: campaign.id }) },
		{ label: isScan ? 'Escaneo de bonos' : 'Importaciones', href: backHref },
		{ label: isScan ? 'Lote de escaneo' : (session.fileName ?? 'Importación') }
	]}
>
	{#snippet actions()}
		<StatusBadge
			kind="importSession"
			status={session.rolledBackAt !== null ? 'rolled_back' : session.status}
		/>
	{/snippet}
</PageHeader>

<div class="flex flex-col gap-6">
	{#if justConfirmed && session.status === 'confirmed'}
		<Alert tone="success">
			Importación confirmada: los bonos se crearon y están disponibles.
			<a href={bondsHref} class="font-medium underline">Ver los bonos</a>
		</Alert>
	{:else if form?.message}
		<Alert tone={form.success ? 'success' : 'danger'}>{form.message}</Alert>
	{/if}

	{#if session.status === 'cancelled'}
		<Alert tone="warning">
			Esta importación se canceló{session.cancelReason ? `: ${session.cancelReason}` : ''}. No se
			creó ningún bono.
		</Alert>
	{:else if session.rolledBackAt}
		<Alert tone="warning">
			Esta importación se revirtió el {formatDateTime(session.rolledBackAt)}: sus bonos se anularon
			({session.rollbackReason}).
		</Alert>
	{:else if data.lockedMessage}
		<Alert tone="warning">{data.lockedMessage}</Alert>
	{/if}

	<section class="flex flex-col gap-3" aria-labelledby="summary-title">
		<h2 id="summary-title" class="sr-only">Resumen</h2>
		<ImportSummaryPanel {summary} />
	</section>

	{#if data.canEdit}
		<RiskyOperationChecklist
			campaignId={data.campaign.id}
			operation="confirming a bulk import"
			canExport={data.canExport}
		/>
		<Card title="Acciones de la importación" id="actions">
			<div class="flex flex-wrap items-center gap-3">
				<form method="POST" action="?/confirm" use:enhance={submitting('confirm')}>
					<Button
						type="submit"
						variant="primary"
						disabled={!canConfirm || (busy !== null && busy !== 'confirm')}
						loading={busy === 'confirm'}
						aria-describedby="confirm-hint"
					>
						{busy === 'confirm'
							? 'Creando bonos…'
							: `Confirmar y crear ${formatNumber(bondCount)} ${bondCount === 1 ? 'bono' : 'bonos'}`}
					</Button>
				</form>
				<form method="POST" action="?/validate" use:enhance={submitting('validate')}>
					<Button
						type="submit"
						disabled={!canValidate || (busy !== null && busy !== 'validate')}
						loading={busy === 'validate'}
						title={summary.status === 'validated' ? 'Ya está validada' : undefined}
					>
						{busy === 'validate' ? 'Validando…' : 'Validar'}
					</Button>
				</form>
				{#if isScan}
					<Button href={scanHref}>Seguir escaneando</Button>
				{/if}
				<div class="ml-auto">
					<Button disabled={busy !== null} onclick={() => (cancelling = true)}>
						Cancelar importación
					</Button>
				</div>
				<p id="confirm-hint" class="m-0 w-full text-body-sm text-muted">
					{#if summary.errors > 0}
						Confirmar está deshabilitado: corregir o quitar {summary.errors === 1
							? 'la fila con error'
							: `las ${formatNumber(summary.errors)} filas con errores`}.
					{:else if summary.status !== 'validated'}
						Validar la importación para habilitar Confirmar.
					{:else}
						Confirmar crea todos los bonos de una vez. Una persona administradora puede revertir más
						tarde una importación hecha por error.
					{/if}
				</p>
			</div>
		</Card>
	{/if}

	{#if data.canRollBack}
		<Card
			title="Revertir esta importación"
			description="Anula los bonos disponibles de esta importación y libera sus números y códigos. Los bonos ya anulados a mano quedan como están. Solo es posible mientras ninguno se haya entregado, vendido o agrupado en una pata."
			id="rollback"
		>
			<Button variant="danger" disabled={busy !== null} onclick={() => (rollingBack = true)}>
				Revertir importación
			</Button>
			{#if form?.form === 'rollback' && form.errors?.reason}
				<p class="m-0 mt-2 text-body-sm text-danger-text">{form.errors.reason[0]}</p>
			{/if}
		</Card>
	{/if}

	<section class="flex flex-col gap-3" aria-labelledby="rows-title">
		<div class="flex flex-wrap items-center justify-between gap-3">
			<h2 id="rows-title" class="m-0 text-heading-3">Filas</h2>
			<nav aria-label="Filtrar filas por estado" class="flex flex-wrap gap-1">
				{#each IMPORT_ITEM_FILTERS as filter (filter)}
					<a
						href={previewLink(filter)}
						aria-current={data.filter === filter ? 'page' : undefined}
						class="rounded-full px-3 py-1 text-body-sm {data.filter === filter
							? 'bg-primary text-on-primary'
							: 'bg-surface-sunken text-text hover:bg-surface-hover'}"
					>
						{FILTER_LABELS[filter]}
						{#if filter === 'error' && summary.errors > 0}({formatNumber(summary.errors)}){/if}
						{#if filter === 'warning' && summary.warnings > 0}({formatNumber(
								summary.warnings
							)}){/if}
					</a>
				{/each}
			</nav>
		</div>

		{#if data.items.length === 0}
			<EmptyState title="Ninguna fila coincide con este filtro" icon="search" />
		{:else}
			<Table {columns} {rows} caption="Filas de la importación" density="compact">
				{#snippet cell({ row, column })}
					{@const removed = row.removedAt !== null}
					{#if column.key === 'rowNumber'}
						<span class="tabular-nums {removed ? 'text-muted' : ''}">{row.rowNumber}</span>
					{:else if column.key === 'status'}
						<StatusBadge kind="importItem" status={removed ? 'removed' : row.status} />
					{:else if column.key === 'type'}
						{row.itemType ? TYPE_LABELS[row.itemType] : '—'}
					{:else if column.key === 'pata'}
						<span class="font-mono">{row.groupKey ?? '—'}</span>
					{:else if column.key === 'numbers'}
						<span class="font-mono tabular-nums"
							>{number(row.baseNumber)} / {associated(row.baseNumber)}</span
						>
					{:else if column.key === 'barcode'}
						<span class="font-mono">{row.barcode ?? '—'}</span>
					{:else if column.key === 'problem'}
						<span class="text-caption">
							{#if removed}
								Quitada{row.removeReason ? `: ${row.removeReason}` : ''}
							{:else if row.errorMessage}
								<span class={row.status === 'error' ? 'text-danger-text' : 'text-warning-text'}
									>{translateImportMessage(row.errorMessage)}</span
								>
							{/if}
							{#if row.createdBondId}
								<a
									href={bondHref(row.createdBondId)}
									class="text-primary-text underline-offset-2 hover:underline">Ver bono →</a
								>
							{/if}
						</span>
					{:else if column.key === 'actions'}
						{#if !removed}
							<div class="flex justify-end gap-1">
								<Button
									size="sm"
									variant="ghost"
									aria-expanded={editing === row.id || editItem?.id === row.id}
									aria-label={`Editar la fila ${row.rowNumber}`}
									onclick={() => (editing = editing === row.id ? null : row.id)}>Editar</Button
								>
								<Button
									size="sm"
									variant="ghost"
									disabled={busy !== null}
									aria-label={`Quitar la fila ${row.rowNumber}`}
									onclick={() => (removing = rows.find((r) => r.id === row.id) ?? null)}
									>Quitar</Button
								>
							</div>
						{/if}
					{/if}
				{/snippet}
			</Table>

			{#if editItem}
				<Card title={`Editar la fila ${editItem.rowNumber}`} id="edit-row">
					<form
						method="POST"
						action="?/update"
						class="grid gap-4 sm:grid-cols-4 sm:items-start"
						use:enhance={() => {
							busy = `update-${editItem.id}`;
							return async ({ result, update }) => {
								await update({ reset: false });
								busy = null;
								if (result.type === 'success') editing = null;
							};
						}}
					>
						<input type="hidden" name="itemId" value={editItem.id} />
						<Field label="Tipo" id="type-{editItem.id}" error={failure?.errors?.itemType?.[0]}>
							<Select
								name="itemType"
								value={failure?.values?.itemType ?? editItem.itemType ?? 'simple'}
								options={[
									{ value: 'simple', label: 'Bono simple' },
									{ value: 'pata', label: 'Pata' }
								]}
							/>
						</Field>
						<Field
							label="grupo_pata"
							id="group-{editItem.id}"
							error={failure?.errors?.groupKey?.[0]}
						>
							<TextInput
								name="groupKey"
								maxlength={200}
								mono
								value={failure?.values?.groupKey ?? editItem.groupKey ?? ''}
							/>
						</Field>
						<Field
							label="Número base"
							id="base-{editItem.id}"
							required
							error={failure?.errors?.baseNumber?.[0]}
						>
							<TextInput
								name="baseNumber"
								inputmode="numeric"
								mono
								value={failure?.values?.baseNumber ??
									(editItem.baseNumber === null ? '' : number(editItem.baseNumber))}
							/>
						</Field>
						<Field
							label="Código de barras"
							id="barcode-{editItem.id}"
							error={failure?.errors?.barcode?.[0]}
						>
							<TextInput
								name="barcode"
								maxlength={200}
								mono
								value={failure?.values?.barcode ?? editItem.barcode ?? ''}
							/>
						</Field>
						<div class="flex gap-2 sm:col-span-4">
							<Button
								type="submit"
								variant="primary"
								loading={busy === `update-${editItem.id}`}
								disabled={busy !== null && busy !== `update-${editItem.id}`}
							>
								{busy === `update-${editItem.id}` ? 'Guardando…' : 'Guardar'}
							</Button>
							<Button onclick={() => (editing = null)}>Cerrar</Button>
						</div>
						<p class="m-0 text-body-sm text-muted sm:col-span-4">
							Fila de origen: <code class="font-mono">{editItem.rawValue}</code>
						</p>
					</form>
				</Card>
			{/if}

			{#if pageCount > 1}
				<nav aria-label="Páginas" class="flex items-center justify-between text-body-sm">
					<span class="text-muted tabular-nums"
						>Página {formatNumber(data.page)} de {formatNumber(pageCount)} · {formatNumber(
							data.total
						)} filas</span
					>
					<span class="flex gap-2">
						{#if data.page > 1}<Button href={previewLink(data.filter, data.page - 1)}
								>Anterior</Button
							>{/if}
						{#if data.page < pageCount}<Button href={previewLink(data.filter, data.page + 1)}
								>Siguiente</Button
							>{/if}
					</span>
				</nav>
			{/if}
		{/if}
	</section>
</div>

<Dialog
	open={cancelling}
	onClose={() => (cancelling = false)}
	title="¿Cancelar esta importación?"
	description="Sus filas se conservan como historial y no se crea ningún bono. No se puede deshacer."
	confirmLabel="Cancelar importación"
	cancelLabel="Volver"
	tone="danger"
	loading={busy === 'cancel'}
	action="?/cancel"
	enhance={(f) =>
		enhance(f, () => {
			busy = 'cancel';
			return async ({ update }) => {
				try {
					cancelling = false;
					await update({ reset: false });
				} finally {
					busy = null;
				}
			};
		})}
>
	<Field label="Motivo" id="cancel-reason" optional>
		<TextInput name="reason" maxlength={500} />
	</Field>
</Dialog>

<Dialog
	open={removing !== null}
	onClose={() => (removing = null)}
	title={removing ? `¿Quitar la fila ${removing.rowNumber} de la importación?` : ''}
	description="La fila se conserva como historial y deja de contar en el resumen."
	confirmLabel="Quitar fila"
	cancelLabel="Volver"
	tone="danger"
	loading={busy?.startsWith('remove') ?? false}
	action="?/remove"
	enhance={(f) =>
		enhance(f, () => {
			busy = 'remove';
			return async ({ update }) => {
				try {
					removing = null;
					await update({ reset: false });
				} finally {
					busy = null;
				}
			};
		})}
>
	<input type="hidden" name="itemId" value={removing?.id ?? ''} />
	<Field label="Motivo" id="remove-reason" optional>
		<TextInput name="reason" maxlength={500} />
	</Field>
</Dialog>

<Dialog
	open={rollingBack}
	onClose={() => (rollingBack = false)}
	title="¿Revertir esta importación?"
	description="Los bonos disponibles de esta importación se anulan y sus números y códigos quedan libres."
	confirmLabel="Revertir importación"
	cancelLabel="Volver"
	tone="danger"
	loading={busy === 'rollback'}
	action="?/rollback"
	enhance={(f) =>
		enhance(f, () => {
			busy = 'rollback';
			return async ({ update }) => {
				try {
					rollingBack = false;
					await update({ reset: false });
				} finally {
					busy = null;
				}
			};
		})}
>
	<Field label="Motivo" id="rollback-reason" required>
		<TextInput
			name="reason"
			maxlength={500}
			value={form?.form === 'rollback' ? (form.values?.reason ?? '') : ''}
		/>
	</Field>
</Dialog>
