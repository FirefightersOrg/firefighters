<script lang="ts">
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import {
		cardClass,
		inputClass,
		labelClass,
		primaryButtonClass,
		secondaryButtonClass
	} from '$lib/components/campaigns/styles';
	import { PAYMENT_MODE_LABELS, buildInstallmentSchedule } from '$lib/domain/sales';
	import { formatMoney } from '$lib/domain/money';
	import { buyerDisplayName } from '$lib/domain/parties';
	import type { PageProps } from './$types';
	let { data, form }: PageProps = $props();
	let selectedBond = $state('');
	let selectedBuyer = $state('');
	let mode = $state('full_payment');
	let due = $state('');
	$effect(() => {
		if (!due) due = data.today;
	});
	$effect(() => {
		if (form?.form === 'buyer' && form.success && form.buyerId) selectedBuyer = form.buyerId;
	});
	const schedule = $derived.by(() =>
		selectedBond
			? buildInstallmentSchedule({
					paymentMode: mode as 'full_payment' | 'installments',
					firstDueDate: due,
					totalAmount: data.campaign.simpleBondValue,
					installmentCount: data.campaign.installmentCount,
					installmentValue: data.campaign.installmentValue,
					commercialUnitCount: 1
				})
			: []
	);
</script>

<svelte:head><title>Register sale - {data.campaign.name}</title></svelte:head>
<div class="space-y-6">
	<a
		class="text-sm text-blue-700 hover:underline"
		href={resolve('/campaigns/[id]/sales', { id: data.campaign.id })}>← Sales</a
	>
	<h1 class="text-2xl font-bold">Register sale</h1>
	<section class="{cardClass} space-y-4">
		<h2 class="font-semibold">1–2. Find a delivered bond</h2>
		<form method="POST" action="?/lookup" use:enhance class="flex gap-2">
			<input
				class={inputClass}
				name="query"
				placeholder="Base number, associated number or code"
			/><button class={primaryButtonClass}>Search</button>
		</form>
		{#if form?.form === 'lookup'}<div class="space-y-2">
				{#each form.found ?? [] as bond (bond.id)}<label class="block"
						><input type="radio" bind:group={selectedBond} value={bond.id} /> Bond {bond.baseNumbers.join(
							', '
						)} — delivered (collector confirmed)</label
					>{:else}<p class="text-sm text-slate-500">
						No delivered bond matches. Available bonds must be delivered first; sold, lost, annulled
						and grouped member bonds cannot be sold.
					</p>{/each}
			</div>{/if}
	</section>
	<section class="{cardClass} space-y-5">
		<h2 class="font-semibold">3. Buyer</h2>
		<select class={inputClass} bind:value={selectedBuyer}
			><option value="">Choose buyer</option>{#each data.buyers as buyer (buyer.id)}<option
					value={buyer.id}>{buyerDisplayName(buyer)}</option
				>{/each}</select
		>
		{#if data.canCreateBuyer}<details class="rounded border p-3 text-sm">
				<summary class="cursor-pointer font-medium">Create a buyer</summary>
				<form
					method="POST"
					action="?/createBuyer"
					use:enhance
					class="mt-3 grid gap-2 sm:grid-cols-2"
				>
					<select class={inputClass} name="type"
						><option value="individual">Individual</option><option value="business">Business</option
						></select
					>
					<input class={inputClass} name="firstName" placeholder="First name" />
					<input class={inputClass} name="lastName" placeholder="Last name" />
					<input class={inputClass} name="businessName" placeholder="Business name" />
					<input class={inputClass} name="documentNumber" placeholder="Document number" />
					<input class={inputClass} name="taxId" placeholder="Tax ID" />
					<input class={inputClass} name="phone" placeholder="Phone" />
					<input class={inputClass} name="address" placeholder="Address" />
					<input type="hidden" name="usualCollectorId" value="" />
					<input type="hidden" name="notes" value="" />
					{#if form?.form === 'buyer' && form.duplicates}<label class="sm:col-span-2"
							><input type="checkbox" name="createAnyway" /> {form.message}</label
						>{/if}
					<button class={secondaryButtonClass}>Create buyer</button>
					{#if form?.form === 'buyer' && form.message}<p class="text-red-700">
							{form.message}
						</p>{/if}
				</form>
			</details>{/if}
	</section>
	<form method="POST" action="?/register" use:enhance class="{cardClass} space-y-5">
		<input type="hidden" name="bondId" value={selectedBond} />
		<input type="hidden" name="buyerId" value={selectedBuyer} />
		<p class="text-sm text-slate-500">
			The collector is confirmed from the bond’s current custody and cannot be changed here. If it
			differs from the buyer’s usual collector, the bond’s confirmed collector records this sale.
		</p>
		<h2 class="font-semibold">5. Modality</h2>
		<select class={inputClass} name="paymentMode" bind:value={mode}
			>{#each Object.entries(PAYMENT_MODE_LABELS) as [value, label] (value)}<option {value}
					>{label}</option
				>{/each}</select
		><label class={labelClass} for="firstDueDate">First due date</label><input
			class={inputClass}
			id="firstDueDate"
			name="firstDueDate"
			type="date"
			bind:value={due}
		/>
		<h2 class="font-semibold">6. Schedule preview</h2>
		{#if schedule.length}<table class="text-sm">
				<tbody
					>{#each schedule as installment (installment.number)}<tr
							><td class="pr-4">{installment.number}</td><td class="pr-4">{installment.dueDate}</td
							><td>{formatMoney(installment.amount)}</td></tr
						>{/each}</tbody
				>
			</table>{:else}<p class="text-sm text-slate-500">
				Select a bond to preview the schedule.
			</p>{/if}{#if form?.form === 'sale' && form.message}<p class="text-sm text-red-700">
				{form.message}
			</p>{/if}<button class={primaryButtonClass}>Confirm sale</button>
	</form>
</div>
