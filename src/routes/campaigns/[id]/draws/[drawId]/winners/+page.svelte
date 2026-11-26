<script lang="ts">
	import BondStub from '$lib/components/ui/BondStub.svelte';
	import { resolve } from '$app/paths';
	import {
		Alert,
		Button,
		Card,
		Checkbox,
		Dialog,
		Disclosure,
		EmptyState,
		Field,
		PageHeader,
		StatusBadge,
		Textarea,
		TextInput
	} from '$lib/components/ui';
	import { countDrawPrizes } from '$lib/domain/draw-steps';
	import { WINNING_NUMBER_STATUS_LABELS } from '$lib/domain/prizes';
	import type { PageProps } from './$types';

	/**
	 * Winners and prizes of a draw. UX plan PR 16: the next thing to do is the one primary button of
	 * the page (configure the first prize, validate a number, award it, hand it over), the resolution
	 * is two buttons that name their outcome («Adjudicar el premio», «Dejar sin adjudicar») and say
	 * that it cannot be changed, and a draw whose prizes are all resolved leads back to its record to
	 * be completed. The actions and their fields are the same.
	 */
	let { data, form }: PageProps = $props();
	const submittedValues = $derived(
		form && 'values' in form ? (form.values as Record<string, string>) : {}
	);
	const immediateResult = $derived(
		form?.form === 'loadWinner' && form.success ? form.result : null
	);
	type Prize = (typeof data.prizes)[number];
	/** A prize waiting for its number or its resolution: what the draw itself is waiting for. */
	const unresolvedStep = (prize: Prize) =>
		(data.can.loadWinner && prize.status === 'pending_validation' && !prize.winningNumber) ||
		(data.can.resolve &&
			prize.status === 'pending_validation' &&
			prize.winningNumber?.resultStatus === 'eligible_winner');
	/**
	 * The prize that carries the page's primary button: the first one to load or resolve, in prize
	 * order; when none is waiting, the first one to hand over (a delivery can wait, a draw cannot be
	 * completed with a prize unresolved).
	 */
	const nextPrizeId = $derived(
		(
			data.prizes.find(unresolvedStep) ??
			data.prizes.find((prize) => data.can.deliver && prize.status === 'pending_delivery')
		)?.id ?? null
	);
	const emphasis = (prize: Prize) => (prize.id === nextPrizeId ? 'primary' : 'secondary');
	const counts = $derived(countDrawPrizes(data.prizes));
	/** Every prize resolved on a frozen draw: what is left is completing the draw, on its record. */
	const readyToComplete = $derived(
		data.draw.status === 'roster_frozen' && counts.unresolved === 0 && counts.resolved > 0
	);
	const drawHref = $derived(
		resolve('/campaigns/[id]/draws/[drawId]', { id: data.campaign.id, drawId: data.draw.id })
	);
	const rosterPending = $derived(
		data.draw.status === 'scheduled' || data.draw.status === 'roster_generated'
	);
	/** The prize being left unawarded: asked in a dialog, because it cannot be changed afterwards. */
	let unawarding = $state<Prize | null>(null);
	const RESOLUTION_NOTE =
		'La resolución no se puede cambiar: para corregirla hay que anular el premio y crear su reemplazo.';
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
	{#if rosterPending}
		<Alert tone="info" title="El padrón todavía no está congelado">
			Los números ganadores se cargan contra el padrón congelado. Mientras tanto se pueden
			configurar los premios.
		</Alert>
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
		<Disclosure
			summary="Configurar un premio"
			defaultOpen={data.prizes.length === 0 || (form?.form === 'create' && !form.success)}
		>
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
				<div>
					<Button type="submit" variant={data.prizes.length === 0 ? 'primary' : 'secondary'}
						>Crear premio</Button
					>
				</div>
			</form>
		</Disclosure>
	{/if}

	<section class="space-y-4" aria-label="Premios del sorteo">
		{#each data.prizes as prize (prize.id)}
			<Card
				title="Premio {prize.position}: {prize.name}"
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
								{#if prize.winningNumber.bondId}
									<p class="mt-1">
										<a
											class="inline-flex items-center rounded-sm text-primary-text underline underline-offset-2 pointer-coarse:min-h-touch"
											href={resolve('/campaigns/[id]/bonds/[bondId]', {
												id: data.campaign.id,
												bondId: prize.winningNumber.bondId
											})}>Ver la ficha del bono</a
										>
									</p>
								{/if}
								<p class="mt-1">
									{prize.winningNumber.eligible
										? 'Habilitado'
										: 'No habilitado'}{#if prize.winningNumber.reasonLabel}: {prize.winningNumber
											.reasonLabel}{/if}
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
							<Button type="submit" variant={emphasis(prize)}
								>Validar contra el padrón congelado</Button
							>
						</form>
					{/if}

					{#if data.can.resolve && prize.status === 'pending_validation' && prize.winningNumber?.resultStatus === 'eligible_winner'}
						<form
							method="POST"
							action="?/resolve"
							class="space-y-3 rounded-md border border-border p-3"
						>
							<input type="hidden" name="prizeId" value={prize.id} />
							<input type="hidden" name="decision" value="award" />
							<p class="text-body text-text" data-resolution-note>{RESOLUTION_NOTE}</p>
							<Field label="Notas" id="resolve-notes-{prize.id}" optional>
								<Textarea name="notes" />
							</Field>
							<div class="flex flex-wrap gap-2">
								<Button type="submit" variant={emphasis(prize)}>Adjudicar el premio</Button>
								<Button variant="ghost" onclick={() => (unawarding = prize)}
									>Dejar sin adjudicar</Button
								>
							</div>
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
							<Button type="submit" variant={emphasis(prize)}>Registrar entrega</Button>
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
							<Button
								href={certificateHref(prize.id, 'unawarded')}
								target="_blank"
								rel="noreferrer"
								class="h-auto! min-h-control-md py-2 whitespace-normal!"
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
									<Button type="submit">Crear premio de reemplazo</Button>
								</form>
							</Disclosure>
						{/if}
					{/if}
				</div>
			</Card>
		{:else}
			<EmptyState title="Todavía no hay premios configurados">
				{data.can.create
					? 'Configurar el primer premio para poder cargar su número ganador.'
					: 'Los premios los configura quien administra los sorteos.'}
			</EmptyState>
		{/each}
	</section>

	{#if readyToComplete}
		<section
			class="flex flex-wrap items-center justify-between gap-x-4 gap-y-3 border-t border-border-strong pt-4"
			aria-label="Siguiente paso"
			data-next-step
		>
			<p class="m-0 min-w-0 flex-1 basis-56 text-body text-text">
				Todos los premios están resueltos. El sorteo se completa desde su ficha.
			</p>
			<Button href={drawHref} variant={nextPrizeId ? 'secondary' : 'primary'}
				>Ir a completar el sorteo</Button
			>
		</section>
	{/if}
</div>

{#if data.can.resolve}
	<Dialog
		open={unawarding !== null}
		onClose={() => (unawarding = null)}
		action="?/resolve"
		tone="danger"
		title={unawarding
			? `¿Dejar sin adjudicar el premio ${unawarding.position}, ${unawarding.name}?`
			: '¿Dejar sin adjudicar el premio?'}
		description="El número {unawarding?.winningNumber?.formattedNumber ??
			''} está habilitado, pero el premio queda sin ganador. {RESOLUTION_NOTE}"
		confirmLabel="Dejar sin adjudicar"
	>
		{#if unawarding}
			<input type="hidden" name="prizeId" value={unawarding.id} />
			<input type="hidden" name="decision" value="unaward" />
			<Field label="Notas" id="unaward-notes" optional>
				<Textarea name="notes" />
			</Field>
		{/if}
	</Dialog>
{/if}
