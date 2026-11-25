<script lang="ts">
	import { enhance } from '$app/forms';
	import {
		Alert,
		Button,
		Dialog,
		Disclosure,
		Field,
		Select,
		Textarea,
		TextInput
	} from '$lib/components/ui';
	import { formatDate, formatMoney } from '$lib/format';
	import { PAYMENT_METHOD_LABELS, type PaymentMethod } from '$lib/domain/payments';
	import { parseMoneyInput, centsToDecimalString } from '$lib/domain/money';

	/**
	 * "Registrar cobro" of one installment (SAN-147). It only SENDS the collection: it stays pending until the
	 * operator includes it in a settlement and closes it. Sent collections cannot be edited from here.
	 */
	interface Props {
		installmentId: string;
		installmentNumber: number;
		/** What can still be sent for this installment (balance minus unconfirmed drafts), as "123.45". */
		available: string;
		/** Buenos Aires today, `YYYY-MM-DD`: default and upper bound of the date. */
		today: string;
		noteMax: number;
		requestKey: string;
		/** The action result when it belongs to this installment. */
		result?: {
			message?: string;
			errors?: Record<string, string[] | undefined>;
			values?: Record<string, string>;
		} | null;
	}
	let {
		installmentId,
		installmentNumber,
		available,
		today,
		noteMax,
		requestKey,
		result = null
	}: Props = $props();

	const uid = $props.id();
	const methodOptions = [
		{ value: 'cash', label: PAYMENT_METHOD_LABELS.cash },
		{ value: 'transfer', label: PAYMENT_METHOD_LABELS.transfer }
	];
	// svelte-ignore state_referenced_locally
	let amount = $state(result?.values?.amount ?? available);
	// svelte-ignore state_referenced_locally
	let method = $state(result?.values?.paymentMethod ?? 'cash');
	// svelte-ignore state_referenced_locally
	let date = $state(result?.values?.paymentDate ?? today);
	// svelte-ignore state_referenced_locally
	let note = $state(result?.values?.note ?? '');
	let confirming = $state(false);
	let sending = $state(false);
	let formEl = $state<HTMLFormElement>();

	const cents = $derived(parseMoneyInput(amount));
	const availableCents = $derived(parseMoneyInput(available) ?? 0);
	const localErrors = $derived.by(() => {
		const errors: Record<string, string> = {};
		if (cents === null || cents <= 0) errors.amount = 'Ingresar un importe mayor que cero.';
		else if (cents > availableCents)
			errors.amount = `El importe no puede superar ${formatMoney(available, { decimals: 'always' })}.`;
		if (!date) errors.paymentDate = 'Ingresar la fecha del cobro.';
		else if (date > today) errors.paymentDate = 'La fecha del cobro no puede ser futura.';
		if ([...note].length > noteMax) errors.note = `La nota admite hasta ${noteMax} caracteres.`;
		return errors;
	});
	let showErrors = $state(false);
	const err = (name: string) =>
		(showErrors ? localErrors[name] : undefined) ?? result?.errors?.[name]?.[0] ?? null;

	function review() {
		showErrors = true;
		if (Object.keys(localErrors).length) return;
		confirming = true;
	}
</script>

<Disclosure summary="Registrar cobro" defaultOpen={!!result?.message}>
	<form
		bind:this={formEl}
		method="POST"
		action="?/registrar"
		class="space-y-4"
		use:enhance={() => {
			sending = true;
			return async ({ update }) => {
				await update();
				sending = false;
			};
		}}
	>
		<input type="hidden" name="installmentId" value={installmentId} />
		<input type="hidden" name="requestKey" value={requestKey} />
		<Alert tone="info">
			Este cobro queda pendiente de rendición. Recién se confirma cuando el operador lo incluye en
			tu rendición y la cierra. Una vez enviado, no se puede editar.
		</Alert>
		{#if result?.message}
			<Alert tone="danger">{result.message}</Alert>
		{/if}
		<Field
			label="Importe"
			id="{uid}-amount"
			required
			hint="Máximo disponible: {formatMoney(available, { decimals: 'always' })}"
			error={err('amount')}
		>
			<TextInput
				name="amount"
				inputmode="decimal"
				prefix="$"
				bind:value={amount}
				class="text-right tabular-nums"
			/>
		</Field>
		<Field label="Fecha del cobro" id="{uid}-date" required error={err('paymentDate')}>
			<TextInput name="paymentDate" type="date" max={today} bind:value={date} />
		</Field>
		<Field label="Medio" id="{uid}-method" required error={err('paymentMethod')}>
			<Select name="paymentMethod" options={methodOptions} bind:value={method} />
		</Field>
		<Field
			label="Nota"
			id="{uid}-note"
			optional
			hint="Hasta {noteMax} caracteres."
			error={err('note')}
		>
			<Textarea name="note" rows={2} maxlength={noteMax} bind:value={note} />
		</Field>
		<Button type="button" variant="primary" loading={sending} onclick={review}
			>Revisar y enviar</Button
		>
	</form>
	<Dialog
		open={confirming}
		onClose={() => (confirming = false)}
		onConfirm={() => {
			confirming = false;
			formEl?.requestSubmit();
		}}
		title="¿Enviar el cobro de la cuota {installmentNumber}?"
		description="Se envía {formatMoney(centsToDecimalString(cents ?? 0), {
			decimals: 'always'
		})} en {PAYMENT_METHOD_LABELS[method as PaymentMethod]?.toLowerCase()} con fecha {date
			? formatDate(date)
			: '—'}. Queda pendiente de rendición y no se puede editar después."
		confirmLabel="Enviar cobro"
	/>
</Disclosure>
