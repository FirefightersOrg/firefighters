<script lang="ts">
	import { resolve } from '$app/paths';
	import FormAlert from '$lib/components/campaigns/FormAlert.svelte';
	import {
		cardClass,
		inputClass,
		labelClass,
		primaryButtonClass,
		secondaryButtonClass
	} from '$lib/components/campaigns/styles';
	import { PRIZE_STATUS_LABELS, WINNING_NUMBER_STATUS_LABELS } from '$lib/domain/prizes';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();
	const submittedValues = $derived(
		form && 'values' in form ? (form.values as Record<string, string>) : {}
	);
	const immediateResult = $derived(
		form?.form === 'loadWinner' && form.success ? form.result : null
	);
</script>

<svelte:head><title>Winners and prizes - {data.draw.name}</title></svelte:head>
<div class="space-y-6">
	<header>
		<a
			class="text-sm text-blue-700 underline"
			href={resolve('/campaigns/[id]/draws/[drawId]', {
				id: data.campaign.id,
				drawId: data.draw.id
			})}>← {data.draw.name}</a
		>
		<h1 class="mt-2 text-2xl font-bold">Winners and prizes</h1>
		<p class="text-sm text-slate-600">Frozen-roster results and prize fulfillment.</p>
	</header>

	{#if form?.message}<FormAlert
			kind={form.success ? 'success' : 'error'}
			message={form.message}
		/>{/if}
	{#if immediateResult}
		<section class="{cardClass} border-blue-200 bg-blue-50" aria-live="polite">
			<h2 class="font-semibold">Validation result for {immediateResult.formattedNumber}</h2>
			{#if immediateResult.resultStatus === 'no_match'}
				<p class="mt-2 text-sm"><strong>Not eligible:</strong> Number not in the roster.</p>
				<p class="mt-1 text-sm">The prize is unawarded.</p>
			{:else}
				<dl class="mt-3 grid gap-2 text-sm sm:grid-cols-2">
					<div>
						<dt class="text-slate-500">Bond</dt>
						<dd>{immediateResult.bondLabel}</dd>
					</div>
					<div>
						<dt class="text-slate-500">Buyer</dt>
						<dd>{immediateResult.buyerLabel}</dd>
					</div>
					<div>
						<dt class="text-slate-500">Collector</dt>
						<dd>{immediateResult.collectorLabel}</dd>
					</div>
					<div>
						<dt class="text-slate-500">Eligibility</dt>
						<dd>{immediateResult.eligible ? 'Eligible' : 'Not eligible'}</dd>
					</div>
				</dl>
				{#if !immediateResult.eligible}<p class="mt-2 text-sm">
						<strong>Reason:</strong>
						{immediateResult.reasonLabel}
					</p>{/if}
				<p class="mt-1 text-sm">
					{immediateResult.eligible ? 'Awaiting resolution.' : 'The prize is unawarded.'}
				</p>
			{/if}
		</section>
	{/if}

	{#if data.can.create}
		<details class={cardClass}>
			<summary class="cursor-pointer font-semibold">Configure a prize</summary>
			<form method="POST" action="?/create" class="mt-4 grid gap-3 sm:grid-cols-2">
				<div>
					<label class={labelClass} for="create-position">Position</label>
					<input
						class={inputClass}
						id="create-position"
						name="position"
						type="number"
						min="1"
						required
					/>
				</div>
				<div>
					<label class={labelClass} for="create-name">Prize name</label>
					<input class={inputClass} id="create-name" name="name" required />
				</div>
				<div class="sm:col-span-2">
					<label class={labelClass} for="create-description">Description</label>
					<textarea class={inputClass} id="create-description" name="description"></textarea>
				</div>
				<label class="flex items-center gap-2 text-sm sm:col-span-2">
					<input type="checkbox" name="excludesFromConsolation" checked />
					Excludes this bond from consolation draws
				</label>
				<div><button class={primaryButtonClass}>Create prize</button></div>
			</form>
		</details>
	{/if}

	<section class="space-y-4">
		{#each data.prizes as prize (prize.id)}
			<article class={cardClass}>
				<div class="flex flex-wrap items-start justify-between gap-3">
					<div>
						<h2 class="font-semibold">#{prize.position} — {prize.name}</h2>
						{#if prize.description}<p class="mt-1 text-sm text-slate-600">
								{prize.description}
							</p>{/if}
					</div>
					<span class="rounded bg-slate-100 px-2 py-1 text-xs"
						>{PRIZE_STATUS_LABELS[prize.status]}</span
					>
				</div>
				<p class="mt-2 text-xs text-slate-500">
					{prize.excludesFromConsolation
						? 'Excludes from consolation'
						: 'Does not exclude from consolation'}
				</p>

				{#if prize.winningNumber}
					<div class="mt-4 rounded border border-slate-200 p-3 text-sm">
						<p>
							<strong>Winning number:</strong>
							<span class="font-mono">{prize.winningNumber.formattedNumber}</span>
							— {WINNING_NUMBER_STATUS_LABELS[prize.winningNumber.resultStatus]}
						</p>
						{#if prize.winningNumber.resultStatus === 'no_match'}
							<p class="mt-2"><strong>Reason:</strong> Number not in the roster</p>
							<p class="mt-1">The prize is unawarded.</p>
						{:else}
							<p class="mt-2">
								<strong>Bond:</strong>
								{prize.winningNumber.bondLabel} ·
								<strong>Buyer:</strong>
								{prize.winningNumber.buyerLabel} ·
								<strong>Collector:</strong>
								{prize.winningNumber.collectorLabel}
							</p>
							<p class="mt-1">
								{prize.winningNumber.eligible ? 'Eligible' : 'Not eligible'}
								{#if prize.winningNumber.reasonLabel}
									— {prize.winningNumber.reasonLabel}{/if}
							</p>
							<p class="mt-1">
								{prize.winningNumber.eligible && prize.status === 'pending_validation'
									? 'Awaiting resolution.'
									: prize.winningNumber.eligible
										? 'Resolution recorded.'
										: 'The prize is unawarded.'}
							</p>
						{/if}
					</div>
				{/if}

				<div class="mt-4 space-y-3">
					{#if data.can.edit && prize.status === 'pending_validation'}
						<details>
							<summary class="cursor-pointer text-sm font-medium text-blue-700">Edit prize</summary>
							<form method="POST" action="?/update" class="mt-3 grid gap-2 sm:grid-cols-2">
								<input type="hidden" name="prizeId" value={prize.id} />
								<label class={labelClass} for="position-{prize.id}">Position</label>
								<input
									class={inputClass}
									id="position-{prize.id}"
									name="position"
									type="number"
									min="1"
									value={prize.position}
									required
								/>
								<label class={labelClass} for="name-{prize.id}">Prize name</label>
								<input
									class={inputClass}
									id="name-{prize.id}"
									name="name"
									value={prize.name}
									required
								/>
								<label class={labelClass} for="description-{prize.id}">Description</label>
								<textarea class={inputClass} id="description-{prize.id}" name="description"
									>{prize.description ?? ''}</textarea
								>
								<label class="flex items-center gap-2 text-sm">
									<input
										type="checkbox"
										name="excludesFromConsolation"
										checked={prize.excludesFromConsolation}
									/> Excludes from consolation
								</label>
								<div class="sm:col-span-2">
									<button class={secondaryButtonClass}>Save prize</button>
								</div>
							</form>
						</details>
					{/if}

					{#if data.can.loadWinner && prize.status === 'pending_validation' && !prize.winningNumber}
						<form method="POST" action="?/loadWinner" class="rounded border border-blue-200 p-3">
							<input type="hidden" name="prizeId" value={prize.id} />
							<label class={labelClass} for="number-{prize.id}">Winning number</label>
							<input
								class={inputClass}
								id="number-{prize.id}"
								name="numberValue"
								type="number"
								min="0"
								required
							/>
							<label class={labelClass} for="load-notes-{prize.id}">Notes</label>
							<textarea class={inputClass} id="load-notes-{prize.id}" name="notes"></textarea>
							<button class="{primaryButtonClass} mt-2">Validate against frozen roster</button>
						</form>
					{/if}

					{#if data.can.resolve && prize.status === 'pending_validation' && prize.winningNumber?.resultStatus === 'eligible_winner'}
						<form method="POST" action="?/resolve" class="rounded border border-emerald-200 p-3">
							<input type="hidden" name="prizeId" value={prize.id} />
							<label class={labelClass} for="decision-{prize.id}">Resolution</label>
							<select class={inputClass} id="decision-{prize.id}" name="decision" required>
								<option value="award">Award prize</option>
								<option value="unaward">Leave unawarded</option>
							</select>
							<label class={labelClass} for="resolve-notes-{prize.id}">Notes</label>
							<textarea class={inputClass} id="resolve-notes-{prize.id}" name="notes"></textarea>
							<button class="{primaryButtonClass} mt-2">Record resolution</button>
						</form>
					{/if}

					{#if data.can.deliver && prize.status === 'pending_delivery'}
						<form method="POST" action="?/deliver" class="rounded border border-emerald-200 p-3">
							<input type="hidden" name="prizeId" value={prize.id} />
							<label class={labelClass} for="delivery-notes-{prize.id}"
								>Delivery notes (required)</label
							>
							<textarea class={inputClass} id="delivery-notes-{prize.id}" name="notes" required
							></textarea>
							<button class="{primaryButtonClass} mt-2">Record delivery</button>
						</form>
					{/if}

					{#if prize.status === 'delivered'}
						{#if data.can.reverseDelivery}
							<details class="rounded border border-red-200 p-3">
								<summary class="cursor-pointer text-sm font-medium text-red-700"
									>Reverse delivery</summary
								>
								<form method="POST" action="?/reverseDelivery" class="mt-3">
									<input type="hidden" name="prizeId" value={prize.id} />
									<label class={labelClass} for="reverse-reason-{prize.id}"
										>Reason (max. {data.reasonMax} Unicode characters)</label
									>
									<textarea class={inputClass} id="reverse-reason-{prize.id}" name="reason" required
										>{form?.form === 'reverseDelivery' && submittedValues.prizeId === prize.id
											? submittedValues.reason
											: ''}</textarea
									>
									<button class="{secondaryButtonClass} mt-2">Confirm delivery reversal</button>
								</form>
							</details>
						{/if}
						<div class="flex flex-wrap items-center gap-3 rounded bg-slate-50 p-2 text-sm">
							<p class="text-slate-600">Delivered prizes cannot be annulled.</p>
							<a
								class="text-blue-700 underline"
								target="_blank"
								rel="noreferrer"
								href={resolve(
									'/campaigns/[id]/draws/[drawId]/winners/[prizeId]/delivery-certificate',
									{
										id: data.campaign.id,
										drawId: data.draw.id,
										prizeId: prize.id
									}
								)}>Print delivery certificate</a
							>
						</div>
					{:else if prize.status === 'unawarded'}
						<div class="flex flex-wrap items-center gap-3">
							<a
								class="text-sm text-blue-700 underline"
								target="_blank"
								rel="noreferrer"
								href={resolve(
									'/campaigns/[id]/draws/[drawId]/winners/[prizeId]/unawarded-certificate',
									{
										id: data.campaign.id,
										drawId: data.draw.id,
										prizeId: prize.id
									}
								)}>Print unawarded certificate</a
							>
							{#if data.can.annul}
								<details class="rounded border border-red-200 p-3">
									<summary class="cursor-pointer text-sm font-medium text-red-700"
										>Annul prize</summary
									>
									<form method="POST" action="?/annul" class="mt-3">
										<input type="hidden" name="prizeId" value={prize.id} />
										<label class={labelClass} for="annul-reason-{prize.id}"
											>Reason (max. {data.reasonMax} Unicode characters)</label
										>
										<textarea class={inputClass} id="annul-reason-{prize.id}" name="reason" required
										></textarea>
										<button class="{secondaryButtonClass} mt-2">Confirm annulment</button>
									</form>
								</details>
							{/if}
						</div>
					{:else if data.can.annul && prize.status !== 'annulled'}
						<details class="rounded border border-red-200 p-3">
							<summary class="cursor-pointer text-sm font-medium text-red-700">Annul prize</summary>
							<form method="POST" action="?/annul" class="mt-3">
								<input type="hidden" name="prizeId" value={prize.id} />
								<label class={labelClass} for="annul-reason-{prize.id}"
									>Reason (max. {data.reasonMax} Unicode characters)</label
								>
								<textarea class={inputClass} id="annul-reason-{prize.id}" name="reason" required
								></textarea>
								<button class="{secondaryButtonClass} mt-2">Confirm annulment</button>
							</form>
						</details>
					{/if}

					{#if prize.status === 'annulled'}
						<p class="text-sm text-red-700">Annulled: {prize.annulReason}</p>
						{#if data.can.create}
							<details class="rounded border border-blue-200 p-3">
								<summary class="cursor-pointer text-sm font-medium text-blue-700">
									Create replacement at position {prize.position}
								</summary>
								<form method="POST" action="?/create" class="mt-3 space-y-2">
									<input type="hidden" name="position" value={prize.position} />
									<label class={labelClass} for="replacement-name-{prize.id}"
										>Replacement prize name</label
									>
									<input
										class={inputClass}
										id="replacement-name-{prize.id}"
										name="name"
										value={prize.name}
										required
									/>
									<label class={labelClass} for="replacement-description-{prize.id}"
										>Description</label
									>
									<textarea
										class={inputClass}
										id="replacement-description-{prize.id}"
										name="description">{prize.description ?? ''}</textarea
									>
									<label class="flex items-center gap-2 text-sm">
										<input
											type="checkbox"
											name="excludesFromConsolation"
											checked={prize.excludesFromConsolation}
										/> Excludes from consolation
									</label>
									<button class={primaryButtonClass}>Create replacement prize</button>
								</form>
							</details>
						{/if}
					{/if}
				</div>
			</article>
		{:else}
			<div class={cardClass}><p class="text-sm text-slate-500">No prizes configured.</p></div>
		{/each}
	</section>
</div>
