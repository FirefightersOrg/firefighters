<script lang="ts">
	import BondStub from '$lib/components/ui/BondStub.svelte';
	import { resolve } from '$app/paths';
	import {
		Alert,
		Button,
		Card,
		Checkbox,
		Disclosure,
		EmptyState,
		Field,
		PageHeader,
		Select,
		StatusBadge,
		Textarea,
		TextInput
	} from '$lib/components/ui';
	import { WINNING_NUMBER_STATUS_LABELS } from '$lib/domain/prizes';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	const submittedValues = $derived(
		form && 'values' in form ? (form.values as Record<string, string>) : {}
	);
	const immediateResult = $derived(
		form?.form === 'loadWinner' && form.success ? form.result : null
	);
	const decisionOptions = [
		{ value: 'award', label: 'Adjudicar el premio' },
		{ value: 'unaward', label: 'Dejar no adjudicado' }
	];
	const reasonHint = $derived(`Hasta ${data.reasonMax} caracteres.`);
	const certificateHref = (prizeId: string, kind: 'delivery' | 'unawarded') =>
		kind === 'delivery'
			? resolve('/campaigns/[id]/draws/[drawId]/winners/[prizeId]/delivery-certificate', {
					id: data.campaign.id,
					drawId: data.draw.id,
					prizeId
				})
			: resolve('/campaigns/[id]/draws/[drawId]/winners/[prizeId]/unawarded-certificate', {
					id: data.campaign.id,
					drawId: data.draw.id,
					prizeId
				});
</script>

{#snippet annulForm(prizeId: string)}
	<Disclosure summary="Anular premio">
		<form method="POST" action="?/annul" class="space-y-3">
			<input type="hidden" name="prizeId" value={prizeId} />
			<Field label="Motivo" id="annul-reason-{prizeId}" required hint={reasonHint}>
				<Textarea name="reason" />
			</Field>
			<Button type="submit" variant="danger">Confirmar anulación</Button>
		</form>
	</Disclosure>
{/snippet}

<svelte:head><title>Ganadores y premios - {data.draw.name}</title></svelte:head>

<PageHeader
	title="Ganadores y premios"
	description="Resultados contra el padrón congelado y entrega de premios."
	breadcrumbs={[
		{ label: 'Campañas', href: resolve('/campaigns') },
		{ label: data.campaign.name, href: resolve('/campaigns/[id]', { id: data.campaign.id }) },
		{ label: 'Sorteos', href: resolve('/campaigns/[id]/draws', { id: data.campaign.id }) },
		{
			label: data.draw.name,
			href: resolve('/campaigns/[id]/draws/[drawId]', {
				id: data.campaign.id,
				drawId: data.draw.id
			})
		},
		{ label: 'Ganadores y premios' }
	]}
/>

<div class="space-y-6">
	{#if form?.message}
		<Alert tone={form.success ? 'success' : 'danger'}>{form.message}</Alert>
	{/if}

	{#if immediateResult}
		<div aria-live="polite">
			<Card title="Resultado de la validación del {immediateResult.formattedNumber}">
				<div class="grid items-center gap-6 sm:grid-cols-[auto_minmax(0,1fr)]">
					<BondStub caption="Número ganador" number={immediateResult.formattedNumber} />
					<div>
						{#if immediateResult.resultStatus === 'no_match'}
							<p class="text-body">
								<strong>No habilitado:</strong> el número no está en el padrón.
							</p>
							<p class="mt-1 text-body">El premio queda no adjudicado.</p>
						{:else}
							<dl class="grid gap-2 text-body sm:grid-cols-2">
								<div>
									<dt class="text-muted">Bono</dt>
									<dd>{immediateResult.bondLabel}</dd>
								</div>
								<div>
									<dt class="text-muted">Comprador</dt>
									<dd>{immediateResult.buyerLabel}</dd>
								</div>
								<div>
									<dt class="text-muted">Cobrador</dt>
									<dd>{immediateResult.collectorLabel}</dd>
								</div>
								<div>
									<dt class="text-muted">Elegibilidad</dt>
									<dd>{immediateResult.eligible ? 'Habilitado' : 'No habilitado'}</dd>
								</div>
							</dl>
							{#if !immediateResult.eligible}
								<p class="mt-2 text-body"><strong>Motivo:</strong> {immediateResult.reasonLabel}</p>
							{/if}
							<p class="mt-1 text-body">
								{immediateResult.eligible
									? 'Pendiente de resolución.'
									: 'El premio queda no adjudicado.'}
							</p>
						{/if}
					</div>
				</div>
			</Card>
		</div>
	{/if}

	{#if data.can.create}
		<Disclosure summary="Configurar un premio">
			<form method="POST" action="?/create" class="grid gap-4 sm:grid-cols-2">
				<Field label="Posición" id="create-position" required>
					<TextInput name="position" type="number" min="1" />
				</Field>
				<Field label="Nombre del premio" id="create-name" required>
					<TextInput name="name" />
				</Field>
				<div class="sm:col-span-2">
					<Field label="Descripción" id="create-description" optional>
						<Textarea name="description" />
					</Field>
				</div>
				<div class="sm:col-span-2">
					<Checkbox
						name="excludesFromConsolation"
						checked
						label="Excluye a este bono de los sorteos de consuelo"
					/>
				</div>
				<div><Button type="submit" variant="primary">Crear premio</Button></div>
			</form>
		</Disclosure>
	{/if}

	<section class="space-y-4" aria-label="Premios del sorteo">
		{#each data.prizes as prize (prize.id)}
			<Card
				title="#{prize.position} — {prize.name}"
				description={prize.description ?? undefined}
				as="article"
			>
				{#snippet actions()}<StatusBadge kind="prize" status={prize.status} />{/snippet}
				<p class="text-caption text-muted">
					{prize.excludesFromConsolation ? 'Excluye del consuelo' : 'No excluye del consuelo'}
				</p>

				{#if prize.winningNumber}
					<!-- Redesign: the winning number as the bond's stub, next to the verdict and details. -->
					<div class="mt-4 grid items-center gap-6 text-body sm:grid-cols-[auto_minmax(0,1fr)]">
						<BondStub
							caption="Premio {prize.position}"
							number={prize.winningNumber.formattedNumber}
						/>
						<div>
							<p
								class="font-semibold {prize.winningNumber.resultStatus === 'eligible_winner'
									? 'text-success-text'
									: 'text-warning-text'}"
							>
								{WINNING_NUMBER_STATUS_LABELS[prize.winningNumber.resultStatus]}
							</p>
							{#if prize.winningNumber.resultStatus === 'no_match'}
								<p class="mt-2"><strong>Motivo:</strong> el número no está en el padrón</p>
								<p class="mt-1">El premio queda no adjudicado.</p>
							{:else}
								<p class="mt-2">
									{#if prize.winningNumber.bondLabel}
										<strong>Código interno:</strong>
										{prize.winningNumber.bondLabel},
									{/if}
									<strong>Comprador:</strong>
									{prize.winningNumber.buyerLabel},
									<strong>Cobrador:</strong>
									{prize.winningNumber.collectorLabel}
								</p>
								<p class="mt-1">
									{prize.winningNumber.eligible ? 'Habilitado' : 'No habilitado'}
									{#if prize.winningNumber.reasonLabel}— {prize.winningNumber.reasonLabel}{/if}
								</p>
								<p class="mt-1">
									{prize.winningNumber.eligible && prize.status === 'pending_validation'
										? 'Pendiente de resolución.'
										: prize.winningNumber.eligible
											? 'Resolución registrada.'
											: 'El premio queda no adjudicado.'}
								</p>
							{/if}
						</div>
					</div>
				{/if}

				<div class="mt-4 space-y-3">
					{#if data.can.edit && prize.status === 'pending_validation'}
						<Disclosure summary="Editar premio">
							<form method="POST" action="?/update" class="grid gap-4 sm:grid-cols-2">
								<input type="hidden" name="prizeId" value={prize.id} />
								<Field label="Posición" id="position-{prize.id}" required>
									<TextInput name="position" type="number" min="1" value={prize.position} />
								</Field>
								<Field label="Nombre del premio" id="name-{prize.id}" required>
									<TextInput name="name" value={prize.name} />
								</Field>
								<div class="sm:col-span-2">
									<Field label="Descripción" id="description-{prize.id}" optional>
										<Textarea name="description" value={prize.description ?? ''} />
									</Field>
								</div>
								<div class="sm:col-span-2">
									<Checkbox
										name="excludesFromConsolation"
										checked={prize.excludesFromConsolation}
										label="Excluye del consuelo"
									/>
								</div>
								<div><Button type="submit">Guardar premio</Button></div>
							</form>
						</Disclosure>
					{/if}

					{#if data.can.loadWinner && prize.status === 'pending_validation' && !prize.winningNumber}
						<form
							method="POST"
							action="?/loadWinner"
							class="space-y-3 rounded-md border border-border p-3"
						>
							<input type="hidden" name="prizeId" value={prize.id} />
							<Field label="Número ganador" id="number-{prize.id}" required>
								<TextInput name="numberValue" type="number" min="0" mono />
							</Field>
							<Field label="Notas" id="load-notes-{prize.id}" optional>
								<Textarea name="notes" />
							</Field>
							<Button type="submit" variant="primary">Validar contra el padrón congelado</Button>
						</form>
					{/if}

					{#if data.can.resolve && prize.status === 'pending_validation' && prize.winningNumber?.resultStatus === 'eligible_winner'}
						<form
							method="POST"
							action="?/resolve"
							class="space-y-3 rounded-md border border-border p-3"
						>
							<input type="hidden" name="prizeId" value={prize.id} />
							<Field label="Resolución" id="decision-{prize.id}" required>
								<Select name="decision" options={decisionOptions} value="award" />
							</Field>
							<Field label="Notas" id="resolve-notes-{prize.id}" optional>
								<Textarea name="notes" />
							</Field>
							<Button type="submit" variant="primary">Registrar resolución</Button>
						</form>
					{/if}

					{#if data.can.deliver && prize.status === 'pending_delivery'}
						<form
							method="POST"
							action="?/deliver"
							class="space-y-3 rounded-md border border-border p-3"
						>
							<input type="hidden" name="prizeId" value={prize.id} />
							<Field label="Observaciones de la entrega" id="delivery-notes-{prize.id}" required>
								<Textarea name="notes" />
							</Field>
							<Button type="submit" variant="primary">Registrar entrega</Button>
						</form>
					{/if}

					{#if prize.status === 'delivered'}
						{#if data.can.reverseDelivery}
							<Disclosure summary="Revertir entrega">
								<form method="POST" action="?/reverseDelivery" class="space-y-3">
									<input type="hidden" name="prizeId" value={prize.id} />
									<Field label="Motivo" id="reverse-reason-{prize.id}" required hint={reasonHint}>
										<Textarea
											name="reason"
											value={form?.form === 'reverseDelivery' &&
											submittedValues.prizeId === prize.id
												? submittedValues.reason
												: ''}
										/>
									</Field>
									<Button type="submit" variant="danger">Confirmar reversión de la entrega</Button>
								</form>
							</Disclosure>
						{/if}
						<div class="flex flex-wrap items-center gap-3 text-body">
							<p class="text-muted">Un premio entregado no se puede anular.</p>
							<Button href={certificateHref(prize.id, 'delivery')} target="_blank" rel="noreferrer"
								>Imprimir constancia de entrega</Button
							>
						</div>
					{:else if prize.status === 'unawarded'}
						<div class="flex flex-wrap items-center gap-3">
							<Button href={certificateHref(prize.id, 'unawarded')} target="_blank" rel="noreferrer"
								>Imprimir constancia de premio no adjudicado</Button
							>
						</div>
						{#if data.can.annul}{@render annulForm(prize.id)}{/if}
					{:else if data.can.annul && prize.status !== 'annulled'}
						{@render annulForm(prize.id)}
					{/if}

					{#if prize.status === 'annulled'}
						<Alert tone="danger" title="Premio anulado">{prize.annulReason}</Alert>
						{#if data.can.create}
							<Disclosure summary="Crear el reemplazo en la posición {prize.position}">
								<form method="POST" action="?/create" class="space-y-3">
									<input type="hidden" name="position" value={prize.position} />
									<Field
										label="Nombre del premio de reemplazo"
										id="replacement-name-{prize.id}"
										required
									>
										<TextInput name="name" value={prize.name} />
									</Field>
									<Field label="Descripción" id="replacement-description-{prize.id}" optional>
										<Textarea name="description" value={prize.description ?? ''} />
									</Field>
									<Checkbox
										name="excludesFromConsolation"
										checked={prize.excludesFromConsolation}
										label="Excluye del consuelo"
									/>
									<Button type="submit" variant="primary">Crear premio de reemplazo</Button>
								</form>
							</Disclosure>
						{/if}
					{/if}
				</div>
			</Card>
		{:else}
			<EmptyState title="Todavía no hay premios configurados" />
		{/each}
	</section>
</div>
