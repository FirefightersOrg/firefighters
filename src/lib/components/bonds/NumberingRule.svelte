<script lang="ts">
	import type { NumberingPreview } from '$lib/domain/numbering-preview';
	import { associatedNumberRuleText } from '$lib/domain/numbering';
	import type { Campaign } from '$lib/domain/campaigns';
	import { formatNumber } from '$lib/format';

	/**
	 * Says in sentences how this campaign numbers its bonds: the digits, how the associated number
	 * is worked out (linear or circular, SAN-151) and which base numbers can be used. Presentation
	 * only: the figures come from `buildNumberingPreview`.
	 */
	let {
		campaign,
		numbering
	}: {
		campaign: Pick<
			Campaign,
			'numberDigits' | 'maxNumber' | 'associatedNumberOffset' | 'associatedNumberMode'
		>;
		numbering: NumberingPreview;
	} = $props();
</script>

<div class="flex flex-col gap-1 text-body-sm text-muted">
	<p class="m-0">
		Los números tienen {campaign.numberDigits} dígitos y llegan hasta
		<span class="font-figure tabular-nums">{campaign.maxNumber}</span>. El número asociado se
		calcula como <span class="tabular-nums">{associatedNumberRuleText(campaign)}</span>.
	</p>
	{#if numbering.ok}
		{#if numbering.associatedRange}
			<p class="m-0">
				En modo circular el asociado vuelve a empezar al pasar el máximo: los asociados cubren de
				<span class="font-figure tabular-nums">{numbering.associatedRange.from}</span>
				a <span class="font-figure tabular-nums">{numbering.associatedRange.to}</span>, así que
				cualquier número base sirve.
			</p>
		{/if}
		<p class="m-0">
			Se pueden usar los números base de
			<span class="font-figure tabular-nums">{numbering.examples[0].baseFormatted}</span>
			a <span class="font-figure tabular-nums">{numbering.maxValidBase.baseFormatted}</span>,
			{formatNumber(numbering.usableBaseCount)} en total.
		</p>
	{/if}
</div>
