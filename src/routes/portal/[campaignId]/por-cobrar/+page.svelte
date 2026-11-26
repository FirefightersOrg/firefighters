<script lang="ts">
	import { institutionName } from '$lib/institution';
	import { resolve } from '$app/paths';
	import { Badge, BondNumber, Button, EmptyState, Money, PageHeader } from '$lib/components/ui';
	import CollectSheet, { type CollectTarget } from '$lib/components/portal/CollectSheet.svelte';
	import PortalPagination from '$lib/components/portal/PortalPagination.svelte';
	import { centsToDecimalString, parseMoneyInput } from '$lib/domain/money';
	import { bondLabel } from '$lib/portal/labels';
	import { formatDate, formatMoney } from '$lib/format';
	import type { PageProps } from './$types';

	/**
	 * «Por cobrar» (UX plan PR 10, audit A5): where the collector's day starts. What is overdue first,
	 * then what is due this week; each installment with the bond, the buyer and the amount, a call
	 * link and «Cobrar», which opens the payment sheet without leaving the list.
	 */
	let { data }: PageProps = $props();

	type Due = (typeof data.due)[number];
	const cents = (value: string | undefined) => parseMoneyInput(value ?? '0') ?? 0;
	/** What can still be sent: the balance less what the collector already sent and nobody processed. */
	const sentCents = (item: Due) =>
		Math.min(cents(item.balance), cents(data.reserved[item.installmentId]));
	const availableCents = (item: Due) => Math.max(0, cents(item.balance) - sentCents(item));
	const pesos = (value: number) => formatMoney(centsToDecimalString(value));

	const groups = $derived(
		[
			{
				id: 'overdue',
				title: 'Vencidas',
				items: data.due.filter((item) => item.status === 'overdue')
			},
			{
				id: 'upcoming',
				title: 'Vencen esta semana',
				items: data.due.filter((item) => item.status !== 'overdue')
			}
		].filter((group) => group.items.length > 0)
	);
	const total = (items: Due[]) => items.reduce((sum, item) => sum + cents(item.balance), 0);
	const count = (n: number) => (n === 1 ? '1 cuota' : `${n} cuotas`);

	let collecting = $state<CollectTarget | null>(null);
	const collect = (item: Due) => {
		collecting = {
			action: `${resolve('/portal/[campaignId]/ventas/[saleId]', {
				campaignId: data.campaign.id,
				saleId: item.saleId
			})}?/registrar`,
			installmentId: item.installmentId,
			installmentNumber: item.installmentNumber,
			bond: bondLabel(item.bondNumbers, item.numberDigits),
			buyerName: item.buyerName,
			available: centsToDecimalString(availableCents(item))
		};
	};
</script>

<svelte:head><title>Por cobrar - {institutionName()}</title></svelte:head>

<PageHeader
	title="Por cobrar"
	description="Cuotas vencidas y las que vencen en los próximos 7 días."
	breadcrumbs={[{ label: 'Mi portal', href: resolve('/portal') }, { label: 'Por cobrar' }]}
/>

<div class="max-w-[720px] space-y-8">
	{#if groups.length === 0}
		<EmptyState title={data.collector ? 'No hay cuotas por cobrar' : 'Sin cobrador vinculado'}>
			{data.collector
				? 'No hay cuotas vencidas ni próximas a vencer.'
				: 'El usuario no está vinculado a un cobrador. Pedir a un administrador que lo vincule.'}
		</EmptyState>
	{/if}

	{#each groups as group (group.id)}
		<section aria-labelledby="due-{group.id}" data-due-group={group.id}>
			<div class="flex items-baseline justify-between gap-3 border-b border-border-strong pb-2">
				<h2 id="due-{group.id}" class="m-0 text-heading-3 text-text">{group.title}</h2>
				<p class="m-0 text-body-sm text-muted">
					{count(group.items.length)}, {pesos(total(group.items))}
				</p>
			</div>
			<ul class="m-0 list-none p-0">
				{#each group.items as item (item.installmentId)}
					{@const sent = sentCents(item)}
					{@const available = availableCents(item)}
					{@const phone = item.buyerPhone?.trim()}
					<li class="border-b border-border py-3 sm:flex sm:items-center sm:gap-4" data-due-row>
						<div class="flex min-w-0 items-start gap-3 sm:flex-1">
							<BondNumber
								number={bondLabel(item.bondNumbers, item.numberDigits)}
								size="md"
								href={resolve('/portal/[campaignId]/ventas/[saleId]', {
									campaignId: data.campaign.id,
									saleId: item.saleId
								})}
							/>
							<div class="min-w-0 flex-1 pt-2.5">
								<!-- The whole name, on two lines if it has to: a collector must not guess who it is. -->
								<p class="m-0 text-body font-medium break-words">
									<a
										class="rounded-sm text-text underline-offset-2 hover:underline"
										href={resolve('/portal/[campaignId]/compradores/[buyerId]', {
											campaignId: data.campaign.id,
											buyerId: item.buyerId
										})}>{item.buyerName}</a
									>
								</p>
								{#if item.buyerAddress}
									<p class="m-0 text-body-sm text-muted break-words" data-buyer-address>
										{item.buyerAddress}
									</p>
								{/if}
								<p
									class="m-0 text-body-sm {group.id === 'overdue'
										? 'text-danger-text'
										: 'text-muted'}"
								>
									Cuota {item.installmentNumber}, {group.id === 'overdue' ? 'venció' : 'vence'} el {formatDate(
										item.dueDate
									)}
								</p>
							</div>
							<Money value={item.balance} class="shrink-0 pt-2.5 text-body font-medium" />
						</div>
						<div class="mt-2 flex flex-wrap items-center gap-2 sm:mt-0 sm:shrink-0">
							{#if sent > 0}
								<Badge tone="info">Enviado {pesos(sent)}</Badge>
							{/if}
							{#if cents(item.pendingAmount) > 0}
								<span class="text-body-sm text-muted">
									En rendición: {pesos(cents(item.pendingAmount))}
								</span>
							{/if}
							<span class="ml-auto flex flex-wrap gap-2">
								{#if phone}
									<Button
										href="tel:{phone.replace(/[^\d+]/g, '')}"
										aria-label="Llamar a {item.buyerName} al {phone}">Llamar</Button
									>
								{/if}
								{#if data.canRegister && available > 0}
									<Button variant="primary" onclick={() => collect(item)}
										>Cobrar<span class="sr-only">
											la cuota {item.installmentNumber} del bono {bondLabel(
												item.bondNumbers,
												item.numberDigits
											)}</span
										></Button
									>
								{/if}
							</span>
						</div>
					</li>
				{/each}
			</ul>
		</section>
	{/each}

	<PortalPagination
		page={data.pagination.page}
		pageCount={data.pagination.pageCount}
		path={resolve('/portal/[campaignId]/por-cobrar', { campaignId: data.campaign.id })}
		label="Páginas de cuotas por cobrar"
	/>
</div>

{#if collecting}
	{#key collecting.installmentId}
		<CollectSheet
			target={collecting}
			today={data.today}
			noteMax={data.noteMax}
			requestKey={data.requestKey}
			onClose={() => (collecting = null)}
		/>
	{/key}
{/if}
