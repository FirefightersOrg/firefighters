<script lang="ts">
	import { resolve } from '$app/paths';
	import {
		Alert,
		Button,
		Card,
		Checkbox,
		Disclosure,
		Field,
		PageHeader,
		StatusBadge,
		Textarea,
		TextInput
	} from '$lib/components/ui';
	import { DRAW_TYPE_LABELS } from '$lib/domain/draws';
	import { buenosAiresDateTimeLocal } from '$lib/domain/draws-datetime';
	import { formatDate, formatDateTime } from '$lib/format';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	const localCutoff = $derived(buenosAiresDateTimeLocal(data.draw.paymentCutoffAt));
	const cutoffDisplay = $derived(formatDateTime(data.draw.paymentCutoffAt));
	const errors = $derived(
		(form && 'errors' in form ? form.errors : {}) as Record<string, string[] | undefined>
	);
	const consolationInstallment = $derived(
		(
			data.draw.eligibilityRule?.consolation_rule as
				{ required_installment_number?: number } | undefined
		)?.required_installment_number ?? ''
	);
	const releasesExtras = $derived(
		data.draw.drawType === 'extraordinary_full_payment' && data.draw.status === 'roster_generated'
	);
</script>

<svelte:head><title>{data.draw.name} - {data.campaign.name}</title></svelte:head>

<PageHeader
	title={data.draw.name}
	description="{DRAW_TYPE_LABELS[data.draw.drawType]} · {formatDate(data.draw.drawDate)}"
	breadcrumbs={[
		{ label: 'Campañas', href: resolve('/campaigns') },
		{ label: data.campaign.name, href: resolve('/campaigns/[id]', { id: data.campaign.id }) },
		{ label: 'Sorteos', href: resolve('/campaigns/[id]/draws', { id: data.campaign.id }) },
		{ label: data.draw.name }
	]}
/>

<div class="space-y-6">
	<div><StatusBadge kind="draw" status={data.draw.status} /></div>
	{#if form?.message}
		<Alert tone={form.success ? 'success' : 'danger'}>{form.message}</Alert>
	{/if}

	<Card title="Elegibilidad y corte">
		<dl class="grid gap-3 text-body sm:grid-cols-2">
			<div>
				<dt class="text-muted">Corte de pagos</dt>
				<dd>{cutoffDisplay} (hora de Buenos Aires)</dd>
			</div>
			<div>
				<dt class="text-muted">Cuota requerida</dt>
				<dd>{data.draw.requiredInstallmentNumber ?? 'No aplica'}</dd>
			</div>
		</dl>
	</Card>

	{#if data.can.edit}
		<Disclosure summary="Editar sorteo programado">
			<form method="POST" action="?/update" class="space-y-4">
				<Field label="Nombre" id="name" required error={errors.name?.[0]}>
					<TextInput name="name" value={data.draw.name} />
				</Field>
				<Field label="Fecha del sorteo" id="drawDate" required error={errors.drawDate?.[0]}>
					<TextInput name="drawDate" type="date" value={data.draw.drawDate} />
				</Field>
				<Field
					label="Corte de pagos"
					id="paymentCutoffLocal"
					required
					hint="Hora de Buenos Aires (UTC−03)."
					error={errors.paymentCutoffLocal?.[0]}
				>
					<TextInput name="paymentCutoffLocal" type="datetime-local" value={localCutoff} />
				</Field>
				<Field
					label="Cuota requerida"
					id="requiredInstallmentNumber"
					error={errors.requiredInstallmentNumber?.[0]}
				>
					<TextInput
						name="requiredInstallmentNumber"
						type="number"
						min="1"
						max={data.campaign.installmentCount}
						value={data.draw.requiredInstallmentNumber ?? ''}
					/>
				</Field>
				<Field
					label="Cuota requerida para consuelo"
					id="consolationRequiredInstallmentNumber"
					optional
					error={errors.consolationRequiredInstallmentNumber?.[0]}
				>
					<TextInput
						name="consolationRequiredInstallmentNumber"
						type="number"
						min="1"
						max={data.campaign.installmentCount}
						value={consolationInstallment}
					/>
				</Field>
				<Button type="submit" variant="primary">Guardar cambios</Button>
			</form>
		</Disclosure>
	{/if}

	<Card title="Padrón">
		{#if data.roster}
			<p class="text-body">
				Padrón actual: <StatusBadge kind="roster" status={data.roster.status} />
				<a
					class="ml-2 rounded-sm text-primary-text underline-offset-2 underline"
					href={resolve('/campaigns/[id]/draws/[drawId]/roster', {
						id: data.campaign.id,
						drawId: data.draw.id
					})}>Ver padrón</a
				>
			</p>
		{:else}
			<p class="text-body text-muted">Todavía no se generó el padrón.</p>
		{/if}
		{#if data.draw.drawType === 'consolation' && data.draw.status === 'scheduled'}
			<p class="mt-2 text-body text-muted">
				El padrón de consuelo solo se puede generar cuando los premios de los sorteos anteriores que
				excluyen del consuelo están resueltos.
			</p>
		{/if}
		{#if data.can.generate || data.can.regenerate}
			<form method="POST" action="?/generate" class="mt-4">
				<Button type="submit" variant={data.roster ? 'secondary' : 'primary'}>
					{data.roster ? 'Regenerar padrón' : 'Generar padrón'}
				</Button>
			</form>
		{/if}
		{#if data.can.freeze}
			<form method="POST" action="?/freeze" class="mt-4 space-y-3">
				<Alert tone="warning" title="Congelar es definitivo">
					Un padrón congelado no se vuelve a calcular nunca, aunque después se registren pagos.
				</Alert>
				<Checkbox
					name="confirm"
					value="yes"
					required
					label="Confirmo que este padrón es el definitivo y no se debe recalcular."
				/>
				<Button type="submit" variant="primary">Congelar padrón</Button>
			</form>
		{/if}
	</Card>

	<Card title="Ganadores y premios">
		<p class="text-body">
			Configurar premios, cargar números ganadores y registrar entregas.
			<a
				class="rounded-sm text-primary-text underline-offset-2 underline"
				href={resolve('/campaigns/[id]/draws/[drawId]/winners', {
					id: data.campaign.id,
					drawId: data.draw.id
				})}>Ganadores y premios</a
			>
		</p>
	</Card>

	{#if data.can.complete}
		<Card
			title="Completar sorteo"
			description="Todos los premios tienen que estar resueltos (adjudicados o no adjudicados). Las entregas pendientes se pueden registrar después."
		>
			<form method="POST" action="?/complete">
				<Button type="submit">Completar sorteo</Button>
			</form>
		</Card>
	{/if}

	{#if data.can.annul}
		<Disclosure summary="Anular sorteo">
			{#if releasesExtras}
				<Alert tone="warning">
					Anular este sorteo libera los números extra reservados que ningún otro sorteo activo usa,
					para que un sorteo posterior pueda volver a asignarlos. El padrón generado queda como
					historial.
				</Alert>
			{/if}
			<form method="POST" action="?/annul" class="mt-3 space-y-3">
				<Field
					label="Motivo"
					id="reason"
					required
					hint="Hasta {data.reasonMax} caracteres."
					error={errors.reason?.[0]}
				>
					<Textarea name="reason" />
				</Field>
				<Button type="submit" variant="danger">Anular sorteo</Button>
			</form>
		</Disclosure>
	{/if}
</div>
