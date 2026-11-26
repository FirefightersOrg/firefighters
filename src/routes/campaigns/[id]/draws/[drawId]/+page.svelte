<script lang="ts">
	import { resolve } from '$app/paths';
	import {
		Alert,
		Button,
		Checkbox,
		Disclosure,
		Field,
		Icon,
		PageHeader,
		StatusBadge,
		Textarea,
		TextInput
	} from '$lib/components/ui';
	import { DRAW_TYPE_LABELS } from '$lib/domain/draws';
	import { drawProgress, type DrawStep } from '$lib/domain/draw-steps';
	import { buenosAiresDateTimeLocal } from '$lib/domain/draws-datetime';
	import { formatDate, formatDateTime } from '$lib/format';
	import type { PageProps } from './$types';

	/**
	 * Draw record (UX plan PR 16, audit A15). A draw is a ceremony with an order: generate the
	 * roster, freeze it, load the winners, complete the draw. The record lists those steps, says
	 * which are done and when, and puts the one button of the next step on it. The steps that cannot
	 * be undone say so before their button. The actions and their fields are the same.
	 */
	let { data, form }: PageProps = $props();
	const draw = $derived(data.draw);
	const localCutoff = $derived(buenosAiresDateTimeLocal(draw.paymentCutoffAt));
	const cutoffDisplay = $derived(formatDateTime(draw.paymentCutoffAt));
	const errors = $derived(
		(form && 'errors' in form ? form.errors : {}) as Record<string, string[] | undefined>
	);
	const consolationInstallment = $derived(
		(draw.eligibilityRule?.consolation_rule as { required_installment_number?: number } | undefined)
			?.required_installment_number ?? ''
	);
	const releasesExtras = $derived(
		data.hasLegacyExtras &&
			draw.drawType === 'extraordinary_full_payment' &&
			draw.status === 'roster_generated'
	);
	const kind = $derived(
		draw.drawType === 'consolation'
			? 'Sorteo de consuelo'
			: `Sorteo ${DRAW_TYPE_LABELS[draw.drawType].toLowerCase()}`
	);
	const progress = $derived(
		drawProgress({
			status: draw.status,
			rosterGeneratedAt: data.roster?.generatedAt ? formatDateTime(data.roster.generatedAt) : null,
			rosterFrozenAt: data.roster?.frozenAt ? formatDateTime(data.roster.frozenAt) : null,
			prizes: data.prizes ?? null
		})
	);
	const rosterHref = $derived(
		resolve('/campaigns/[id]/draws/[drawId]/roster', { id: data.campaign.id, drawId: draw.id })
	);
	const winnersHref = $derived(
		resolve('/campaigns/[id]/draws/[drawId]/winners', { id: data.campaign.id, drawId: draw.id })
	);
	const finished = $derived(draw.status === 'completed' || draw.status === 'closed');
	/** Prizes awarded and not handed over: the one thing left to do on a finished draw. */
	const toDeliver = $derived(finished ? (data.prizes?.pendingDelivery ?? 0) : 0);
	const STATE_WORD: Record<DrawStep['state'], string> = {
		done: 'Hecho',
		current: 'Paso actual',
		pending: 'Pendiente'
	};
</script>

<svelte:head><title>{draw.name} - {data.campaign.name}</title></svelte:head>

<PageHeader
	title={draw.name}
	description="{kind} del {formatDate(draw.drawDate)}"
	breadcrumbs={[
		{ label: 'Campañas', href: resolve('/campaigns') },
		{ label: data.campaign.name, href: resolve('/campaigns/[id]', { id: data.campaign.id }) },
		{ label: 'Sorteos', href: resolve('/campaigns/[id]/draws', { id: data.campaign.id }) },
		{ label: draw.name }
	]}
/>

<div class="flex max-w-[720px] flex-col gap-8">
	<div class="flex flex-col gap-4">
		<div><StatusBadge kind="draw" status={draw.status} /></div>
		{#if form?.message}
			<Alert tone={form.success ? 'success' : 'danger'}>{form.message}</Alert>
		{/if}
		{#if draw.status === 'annulled'}
			<Alert tone="danger" title="Sorteo anulado">
				{draw.annulledAt ? `Anulado el ${formatDateTime(draw.annulledAt)}.` : ''}
				{draw.annulReason ? `Motivo: ${draw.annulReason}` : ''}
			</Alert>
		{/if}
		<dl class="m-0 grid grid-cols-1 gap-x-8 gap-y-3 text-body sm:grid-cols-2" data-draw-facts>
			<div>
				<dt class="text-body-sm text-muted">Corte de pagos</dt>
				<dd class="m-0">{cutoffDisplay} (hora de Buenos Aires)</dd>
			</div>
			<div>
				<dt class="text-body-sm text-muted">Cuota requerida</dt>
				<dd class="m-0">{draw.requiredInstallmentNumber ?? 'No aplica'}</dd>
			</div>
		</dl>
	</div>

	{#if progress.steps.length}
		<section aria-labelledby="steps-title">
			<h2 id="steps-title" class="m-0 border-b border-border-strong pb-2 text-heading-3">
				Pasos del sorteo
			</h2>
			<ol class="m-0 list-none p-0" data-draw-steps>
				{#each progress.steps as step, index (step.key)}
					<li
						class="relative flex gap-3 border-b border-border py-4 last:border-b-0"
						aria-current={step.state === 'current' ? 'step' : undefined}
						data-step={step.key}
						data-state={step.state}
					>
						<span
							class="grid size-7 shrink-0 place-items-center rounded-full text-label tabular-nums {step.state ===
							'current'
								? 'bg-primary text-on-primary'
								: step.state === 'done'
									? 'border border-border-strong bg-surface text-text'
									: 'border border-border-strong text-muted'}"
							aria-hidden="true"
						>
							{#if step.state === 'done'}<Icon name="check" size="sm" />{:else}{index + 1}{/if}
						</span>
						<div class="flex min-w-0 flex-1 flex-col gap-3">
							<div>
								<h3
									class="m-0 text-body leading-7 {step.state === 'pending'
										? 'font-medium text-muted'
										: 'font-semibold text-text'}"
								>
									<span class="sr-only">{STATE_WORD[step.state]}: </span>{step.title}
								</h3>
								<p class="m-0 max-w-[60ch] text-body-sm text-muted">{step.detail}</p>
							</div>

							{#if step.key === 'generate'}
								{#if draw.drawType === 'consolation' && draw.status === 'scheduled'}
									<p class="m-0 max-w-[60ch] text-body-sm text-muted">
										El padrón de consuelo solo se puede generar cuando los premios de los sorteos
										anteriores que excluyen del consuelo están resueltos.
									</p>
								{/if}
								{#if step.state === 'current' && data.can.generate}
									<form method="POST" action="?/generate">
										<Button type="submit" variant="primary" size="lg">Generar padrón</Button>
									</form>
								{:else if data.roster}
									<div class="flex flex-wrap items-center gap-2">
										<Button href={rosterHref}>Ver padrón</Button>
										{#if data.can.regenerate}
											<form method="POST" action="?/generate">
												<Button type="submit">Regenerar padrón</Button>
											</form>
										{/if}
									</div>
								{/if}
							{:else if step.key === 'freeze'}
								{#if step.state === 'current' && data.can.freeze}
									<form method="POST" action="?/freeze" class="flex flex-col gap-3">
										<Alert tone="warning" title="Congelar es definitivo">
											Un padrón congelado no se vuelve a calcular nunca, aunque después se registren
											pagos.
										</Alert>
										<Checkbox
											name="confirm"
											value="yes"
											required
											label="Confirmo que este padrón es el definitivo y no se debe recalcular."
										/>
										<div>
											<Button type="submit" variant="primary" size="lg">Congelar padrón</Button>
										</div>
									</form>
								{/if}
							{:else if step.key === 'winners'}
								<div>
									{#if step.state === 'current'}
										<Button href={winnersHref} variant="primary" size="lg"
											>{data.can.loadWinner
												? 'Cargar ganadores'
												: 'Ver ganadores y premios'}</Button
										>
									{:else if toDeliver > 0}
										<Button href={winnersHref} variant="primary" size="lg"
											>{toDeliver === 1
												? 'Registrar la entrega del premio'
												: 'Registrar las entregas de premios'}</Button
										>
									{:else if step.state === 'pending'}
										<Button href={winnersHref}>Configurar premios</Button>
									{:else}
										<Button href={winnersHref}>Ver ganadores y premios</Button>
									{/if}
								</div>
							{:else if step.key === 'complete'}
								{#if data.can.complete && (step.state === 'current' || progress.readyToComplete === null)}
									<form method="POST" action="?/complete">
										<Button
											type="submit"
											variant={step.state === 'current' ? 'primary' : 'secondary'}
											size={step.state === 'current' ? 'lg' : 'md'}>Completar sorteo</Button
										>
									</form>
								{/if}
							{/if}
						</div>
					</li>
				{/each}
			</ol>
		</section>
	{/if}

	{#if data.can.edit || data.can.annul}
		<div class="flex flex-col gap-3">
			{#if data.can.edit}
				<Disclosure summary="Editar sorteo programado">
					<form method="POST" action="?/update" class="space-y-4">
						<Field label="Nombre" id="name" required error={errors.name?.[0]}>
							<TextInput name="name" value={draw.name} />
						</Field>
						<Field label="Fecha del sorteo" id="drawDate" required error={errors.drawDate?.[0]}>
							<TextInput name="drawDate" type="date" value={draw.drawDate} />
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
								value={draw.requiredInstallmentNumber ?? ''}
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
						<Button type="submit">Guardar cambios</Button>
					</form>
				</Disclosure>
			{/if}

			{#if data.can.annul}
				<Disclosure summary="Anular sorteo">
					{#if releasesExtras}
						<Alert tone="warning">
							Este padrón es anterior al cambio y tiene números extra. Anular el sorteo libera los
							números extra reservados que ningún otro sorteo activo usa, para que un sorteo
							posterior pueda volver a asignarlos. El padrón generado queda como historial.
						</Alert>
					{/if}
					<form method="POST" action="?/annul" class="mt-3 space-y-3">
						<p class="m-0 text-body-sm text-muted">
							Un sorteo anulado no se puede volver a activar.
						</p>
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
	{/if}
</div>
