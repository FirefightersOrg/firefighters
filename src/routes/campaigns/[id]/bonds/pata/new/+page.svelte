<script lang="ts">
	import { institutionName } from '$lib/institution';
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import type { ResolvedPathname } from '$app/types';
	import BondConflictLinks from '$lib/components/bonds/BondConflictLinks.svelte';
	import PataNumbersPreview from '$lib/components/bonds/PataNumbersPreview.svelte';
	import {
		Alert,
		Button,
		Card,
		EmptyState,
		Field,
		FormResult,
		PageHeader,
		StatusBadge,
		Textarea,
		TextInput
	} from '$lib/components/ui';
	import { MIN_PATA_SIZE } from '$lib/domain/bonds';
	import { campaignNumberingConfig } from '$lib/domain/campaigns';
	import { associatedNumberRuleText } from '$lib/domain/numbering';
	import { previewPata } from '$lib/domain/pata-preview';
	import { formatNumber } from '$lib/format';
	import { BOND_CODE_MAX_LENGTH } from '$lib/schemas/bond';
	import type { PageProps } from './$types';

	/**
	 * Pata entry. "Pata impresa": the N base numbers printed on the pata, typed at once.
	 * "Agrupar bonos simples": pick N available simple bonds already loaded and join them in a
	 * manual pata (they keep their numbers). Both open the new pata's record when saved.
	 */
	let { data, form }: PageProps = $props();

	const FIX_FIELDS_MESSAGE = 'Corregir los campos marcados.';

	const campaign = $derived(data.campaign);
	const config = $derived(campaignNumberingConfig(campaign));
	const campaignHref = $derived(resolve('/campaigns/[id]', { id: campaign.id }));
	const pageHref = $derived(resolve('/campaigns/[id]/bonds/pata/new', { id: campaign.id }));
	const grouping = $derived(data.grouping);

	/** The query of this page in grouping mode, with the search and the picked bonds. */
	function groupingQuery(query: { q?: string; selected?: string[] }): string {
		const pairs = [['mode', 'grouping']];
		if (query.q) pairs.push(['q', query.q]);
		for (const id of query.selected ?? []) pairs.push(['selected', id]);
		return pairs.map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
	}
	/**
	 * This page with a query. The pathname is `resolve()`d; only a search string is appended, which
	 * `ResolvedPathname` does not model (hence the cast).
	 */
	function pageWith(query: string): ResolvedPathname {
		return `${pageHref}?${query}` as ResolvedPathname;
	}
	const selectedIds = $derived(grouping?.selected.map((bond) => bond.id) ?? []);

	// Initial values only: afterwards the inputs own them (refilled from `form` without JS).
	function initialValues() {
		return {
			baseNumbers: form?.values?.baseNumbers ?? '',
			internalCode: form?.values?.internalCode ?? '',
			barcode: form?.values?.barcode ?? ''
		};
	}
	const values = $state(initialValues());
	let submitting = $state(false);

	const preview = $derived(previewPata(values.baseNumbers, config, campaign.simpleBondValue));
	const printedRows = $derived(
		preview.entries.map((entry, i) =>
			entry.preview.state === 'ok'
				? {
						key: `${i}`,
						baseFormatted: entry.preview.baseFormatted,
						associatedFormatted: entry.preview.associatedFormatted
					}
				: {
						key: `${i}`,
						baseFormatted: entry.typed,
						associatedFormatted: null,
						problem: entry.preview.message
					}
		)
	);

	const groupRows = $derived(
		(grouping?.selected ?? []).map((bond) => ({
			key: bond.id,
			baseFormatted: bond.baseFormatted,
			associatedFormatted: bond.associatedFormatted,
			problem: bond.problem
		}))
	);
	const groupProblems = $derived([
		...((grouping?.selected.length ?? 0) < MIN_PATA_SIZE
			? [`Una pata necesita al menos ${MIN_PATA_SIZE} bonos simples`]
			: []),
		...(grouping?.selected.some((bond) => bond.problem)
			? ['Quitar los bonos que no se pueden agrupar']
			: [])
	]);

	// Server errors describe what was submitted: hide them once the field is edited.
	const submitted = $derived(form && !form.success ? (form.values ?? null) : null);
	function fieldErrors(field: 'baseNumbers' | 'internalCode' | 'barcode') {
		if (!submitted || submitted[field] !== values[field]) return undefined;
		return form?.errors[field];
	}
	function fieldConflicts(field: string) {
		if (field !== 'memberBondIds') {
			if (!submitted || submitted[field] !== values[field as keyof typeof values]) return [];
		}
		return (form?.conflicts ?? []).filter((c) => c.field === field);
	}
	const formMessage = $derived(form && !form.success ? form.message : null);
	// Messages that are not about one field are shown on their own; the field summary covers the rest.
	const summaryErrors = $derived({
		baseNumbers: fieldErrors('baseNumbers'),
		internalCode: fieldErrors('internalCode'),
		barcode: fieldErrors('barcode')
	});
	const SUMMARY_FIELDS = [
		{ name: 'baseNumbers', label: 'Números base' },
		{ name: 'internalCode', label: 'Código interno' },
		{ name: 'barcode', label: 'Código de barras' }
	];
</script>

<svelte:head>
	<title>Cargar una pata - {campaign.name} - {institutionName()}</title>
</svelte:head>

{#snippet codeFields()}
	<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
		<div>
			<Field
				label="Código interno"
				id="internalCode"
				optional
				error={fieldErrors('internalCode')?.[0]}
			>
				<TextInput
					name="internalCode"
					type="text"
					autocomplete="off"
					mono
					maxlength={BOND_CODE_MAX_LENGTH}
					bind:value={values.internalCode}
				/>
			</Field>
			<BondConflictLinks campaignId={campaign.id} conflicts={fieldConflicts('internalCode')} />
		</div>
		<div>
			<Field label="Código de barras" id="barcode" optional error={fieldErrors('barcode')?.[0]}>
				<TextInput
					name="barcode"
					type="text"
					autocomplete="off"
					mono
					maxlength={BOND_CODE_MAX_LENGTH}
					bind:value={values.barcode}
				/>
			</Field>
			<BondConflictLinks campaignId={campaign.id} conflicts={fieldConflicts('barcode')} />
		</div>
	</div>
{/snippet}

<PageHeader
	title="Cargar una pata"
	description="Una pata vende N números base juntos: vale lo mismo que N bonos simples. Las patas nuevas quedan disponibles para la venta."
	breadcrumbs={[
		{ label: 'Campañas', href: resolve('/campaigns') },
		{ label: campaign.name, href: campaignHref },
		{ label: 'Bonos', href: resolve('/campaigns/[id]/bonds', { id: campaign.id }) },
		{ label: 'Cargar una pata' }
	]}
>
	{#snippet actions()}
		<StatusBadge kind="campaign" status={campaign.status} />
	{/snippet}
</PageHeader>

<div class="flex flex-col gap-6">
	<p class="m-0 text-body-sm">
		<a
			href={resolve('/campaigns/[id]/bonds/new', { id: campaign.id })}
			class="text-primary-text underline-offset-2 underline">Cargar bonos simples →</a
		>
	</p>

	{#if !data.canLoad}
		<Alert tone="warning" title="No se pueden cargar patas">{data.lockedMessage}</Alert>
		<div><Button href={campaignHref}>Volver a la campaña</Button></div>
	{:else}
		<nav aria-label="Tipo de pata" class="flex gap-2 border-b border-border text-label">
			<a
				href={pageWith('mode=printed')}
				aria-current={data.mode === 'printed' ? 'page' : undefined}
				class="-mb-px inline-flex items-center border-b-2 px-3 py-2 pointer-coarse:min-h-touch {data.mode ===
				'printed'
					? 'border-primary text-primary-text'
					: 'border-transparent text-muted hover:text-text'}">Pata impresa</a
			>
			<a
				href={pageWith(groupingQuery({}))}
				aria-current={data.mode === 'grouping' ? 'page' : undefined}
				class="-mb-px inline-flex items-center border-b-2 px-3 py-2 pointer-coarse:min-h-touch {data.mode ===
				'grouping'
					? 'border-primary text-primary-text'
					: 'border-transparent text-muted hover:text-text'}">Agrupar bonos simples</a
			>
		</nav>

		{#if formMessage && formMessage !== FIX_FIELDS_MESSAGE}
			<Alert tone="danger">{formMessage}</Alert>
		{/if}

		{#if data.mode === 'printed'}
			<Card title="Pata impresa" id="printed">
				<div class="flex flex-col gap-5">
					<p class="m-0 text-body-sm text-muted">
						Ingresar los {MIN_PATA_SIZE} o más números base impresos en la pata. Cada uno trae su número
						asociado (<span class="tabular-nums">{associatedNumberRuleText(campaign)}</span>).
					</p>
					{#if campaign.status === 'draft'}
						<Alert tone="warning">
							Esta campaña es un borrador. <strong>Guardar el primer bono congela sus reglas</strong
							>
							(precio, cuotas, numeración, política de desborde y modo de código de barras).
						</Alert>
					{/if}
					{#if formMessage === FIX_FIELDS_MESSAGE}
						<FormResult
							result={{ success: false, message: formMessage, errors: summaryErrors }}
							fields={SUMMARY_FIELDS}
						/>
					{/if}

					<form
						method="POST"
						action="?/printed"
						class="flex flex-col gap-5"
						use:enhance={() => {
							submitting = true;
							return async ({ update }) => {
								try {
									await update({ reset: false });
								} finally {
									submitting = false;
								}
							};
						}}
					>
						<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
							<div>
								<Field
									label="Números base"
									id="baseNumbers"
									required
									hint="Separados por comas, espacios o saltos de línea. Con o sin ceros a la izquierda."
									error={fieldErrors('baseNumbers')?.[0]}
								>
									<Textarea
										name="baseNumbers"
										rows={4}
										autocomplete="off"
										placeholder="68, 69, 70"
										class="font-mono tabular-nums"
										bind:value={values.baseNumbers}
										aria-describedby="pata-preview"
									/>
								</Field>
								<BondConflictLinks
									campaignId={campaign.id}
									conflicts={fieldConflicts('baseNumbers')}
								/>
							</div>
							<PataNumbersPreview
								rows={printedRows}
								problems={values.baseNumbers.trim() === '' ? [] : preview.problems}
								unitCount={preview.unitCount}
								totalValue={preview.totalValue}
								simpleBondValue={campaign.simpleBondValue}
								emptyText="Ingresar los números base para ver sus números asociados."
							/>
						</div>

						{@render codeFields()}

						<div class="flex flex-wrap gap-2">
							<Button type="submit" variant="primary" loading={submitting} disabled={!preview.ok}>
								{submitting ? 'Guardando…' : 'Guardar pata'}
							</Button>
							<Button href={campaignHref}>Cancelar</Button>
						</div>
					</form>
				</div>
			</Card>
		{:else if grouping}
			<Card title="Buscar bonos simples" id="search">
				<div class="flex flex-col gap-4">
					<p class="m-0 text-body-sm text-muted">
						Solo se pueden agrupar bonos simples disponibles que no estén en otra pata. Conservan
						sus números y no se pueden operar por separado mientras están agrupados.
					</p>
					<form method="GET" class="flex flex-wrap items-end gap-2" data-sveltekit-keepfocus>
						<input type="hidden" name="mode" value="grouping" />
						{#each selectedIds as id (id)}
							<input type="hidden" name="selected" value={id} />
						{/each}
						<div class="grow">
							<Field
								label="Desde el número base"
								id="q"
								hint={grouping.searchError
									? undefined
									: `Muestra los primeros ${grouping.searchLimit} por número base, desde el ingresado.`}
								error={grouping.searchError}
							>
								<TextInput
									name="q"
									type="text"
									inputmode="numeric"
									autocomplete="off"
									mono
									value={grouping.query}
									placeholder={'0'.repeat(campaign.numberDigits)}
								/>
							</Field>
						</div>
						<Button type="submit">Buscar</Button>
					</form>

					{#if grouping.results.length === 0}
						<EmptyState title="No hay bonos simples disponibles para agrupar" icon="search" />
					{:else}
						<ul
							class="m-0 list-none divide-y divide-border p-0 text-body-sm"
							aria-label="Bonos simples disponibles para agrupar"
						>
							{#each grouping.results as bond (bond.id)}
								<li class="flex items-center justify-between gap-3 py-2">
									<span class="font-mono tabular-nums"
										>{bond.baseFormatted} <span aria-hidden="true">→</span><span class="sr-only"
											>asociado</span
										>
										{bond.associatedFormatted}
										{#if bond.internalCode}<span class="ml-2 font-sans text-caption text-muted"
												>{bond.internalCode}</span
											>{/if}</span
									>
									<a
										href={pageWith(
											groupingQuery({ q: grouping.query, selected: [...selectedIds, bond.id] })
										)}
										data-sveltekit-noscroll
										class="font-medium text-primary-text underline-offset-2 hover:underline"
										aria-label={`Agregar el bono ${bond.baseFormatted}`}>Agregar</a
									>
								</li>
							{/each}
						</ul>
					{/if}
				</div>
			</Card>

			<Card
				title={`Pata nueva (${formatNumber(grouping.selected.length)} ${grouping.selected.length === 1 ? 'bono' : 'bonos'})`}
				id="group"
			>
				<div class="flex flex-col gap-4">
					{#if formMessage === FIX_FIELDS_MESSAGE}
						<FormResult
							result={{ success: false, message: formMessage, errors: summaryErrors }}
							fields={SUMMARY_FIELDS}
						/>
					{/if}
					{#if form && !form.success && form.errors.memberBondIds?.length}
						<Alert tone="danger">
							<ul class="m-0 list-disc space-y-1 pl-5">
								{#each form.errors.memberBondIds as message, i (i)}
									<li>{message}</li>
								{/each}
							</ul>
							<BondConflictLinks
								campaignId={campaign.id}
								conflicts={fieldConflicts('memberBondIds')}
								kind="pata"
							/>
						</Alert>
					{/if}

					{#if grouping.selected.length > 0}
						<ul
							class="m-0 list-none divide-y divide-border p-0 text-body-sm"
							aria-label="Bonos de la pata nueva"
						>
							{#each grouping.selected as bond (bond.id)}
								<li class="flex items-center justify-between gap-3 py-2">
									<span>
										<span class="font-mono tabular-nums"
											>{bond.baseFormatted ?? 'Bono desconocido'}</span
										>
										{#if bond.problem}
											<span class="ml-2 text-caption text-danger-text">{bond.problem}</span>
											{#if bond.pataId}
												<a
													href={resolve('/campaigns/[id]/bonds/[bondId]', {
														id: campaign.id,
														bondId: bond.pataId
													})}
													class="ml-1 text-caption font-medium text-primary-text underline-offset-2 hover:underline"
													>Ver pata</a
												>
											{/if}
										{/if}
									</span>
									<a
										href={pageWith(
											groupingQuery({
												q: grouping.query,
												selected: selectedIds.filter((id) => id !== bond.id)
											})
										)}
										data-sveltekit-noscroll
										class="text-primary-text underline-offset-2 hover:underline"
										aria-label={`Quitar el bono ${bond.baseFormatted ?? ''}`.trim()}>Quitar</a
									>
								</li>
							{/each}
						</ul>
					{/if}

					<PataNumbersPreview
						id="group-preview"
						rows={groupRows}
						problems={groupProblems}
						unitCount={grouping.unitCount}
						totalValue={grouping.totalValue}
						simpleBondValue={campaign.simpleBondValue}
						emptyText={`Agregar al menos ${MIN_PATA_SIZE} bonos simples de la lista.`}
					/>

					<form
						method="POST"
						action={`?/group&${groupingQuery({ q: grouping.query, selected: selectedIds })}`}
						class="flex flex-col gap-5"
						use:enhance={() => {
							submitting = true;
							return async ({ update }) => {
								try {
									await update({ reset: false });
								} finally {
									submitting = false;
								}
							};
						}}
					>
						{#each selectedIds as id (id)}
							<input type="hidden" name="memberBondIds" value={id} />
						{/each}
						{@render codeFields()}
						<div class="flex flex-wrap gap-2">
							<Button
								type="submit"
								variant="primary"
								loading={submitting}
								disabled={groupProblems.length > 0}
							>
								{submitting ? 'Guardando…' : 'Crear pata'}
							</Button>
							<Button href={campaignHref}>Cancelar</Button>
						</div>
					</form>
				</div>
			</Card>
		{/if}
	{/if}
</div>
