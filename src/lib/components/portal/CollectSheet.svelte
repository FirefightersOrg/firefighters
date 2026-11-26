<script lang="ts" module>
	/** What the sheet needs to know about the installment being collected. */
	export interface CollectTarget {
		/** The sale's `registrar` action, resolved by the caller. */
		action: string;
		installmentId: string;
		installmentNumber: number;
		/** The bond as printed («0068»). */
		bond: string;
		buyerName: string;
		/** What can still be sent for this installment, as a decimal string («10000.00»). */
		available: string;
	}

	/** The `registrar` action's answer when a submission failed. */
	export interface CollectResult {
		message?: string;
		errors?: Record<string, string[] | undefined>;
		values?: Record<string, string>;
	}
</script>

<script lang="ts">
	import { Alert, Dialog, Field, SegmentedControl, Textarea, TextInput } from '$lib/components/ui';
	import { centsToDecimalString, parseMoneyInput } from '$lib/domain/money';
	import { PAYMENT_METHOD_LABELS } from '$lib/domain/payments';
	import { formatMoney } from '$lib/format';

	/**
	 * «Cobrar»: sends the collection of one installment (SAN-147), from the list of what there is to
	 * collect or from the sale. It is a sheet with the amount, cash and today already filled in, so the
	 * usual case is one tap to open it and one to send it. It posts the same fields as before to the
	 * sale's own `registrar` action; the collection stays pending until the operator includes it in a
	 * settlement and closes it, and cannot be edited from here once sent.
	 */
	let {
		target,
		today,
		noteMax,
		requestKey,
		result = null,
		onClose
	}: {
		/** The installment to collect; the sheet is open while there is one. */
		target: CollectTarget | null;
		/** Buenos Aires today, `YYYY-MM-DD`: default and upper bound of the date. */
		today: string;
		noteMax: number;
		requestKey: string;
		/** The action's answer for this installment, when it came back with an error. */
		result?: CollectResult | null;
		onClose: () => void;
	} = $props();

	const methodOptions = [
		{ value: 'cash', label: PAYMENT_METHOD_LABELS.cash },
		{ value: 'transfer', label: PAYMENT_METHOD_LABELS.transfer }
	];
	let amount = $state('');
	let method = $state('cash');
	let date = $state('');
	let note = $state('');
	let touched = $state(false);

	// Each time the sheet opens on an installment it starts from that installment's values (or from
	// what the person had typed, when the server sent the form back).
	let openedFor = '';
	$effect.pre(() => {
		const key = target?.installmentId ?? '';
		if (key === openedFor) return;
		openedFor = key;
		if (!target) return;
		amount = result?.values?.amount ?? target.available;
		method = result?.values?.paymentMethod ?? 'cash';
		date = result?.values?.paymentDate ?? today;
		note = result?.values?.note ?? '';
		touched = false;
	});

	const cents = $derived(parseMoneyInput(amount));
	const availableCents = $derived(parseMoneyInput(target?.available ?? '') ?? 0);
	const localErrors = $derived.by(() => {
		const errors: Record<string, string> = {};
		if (cents === null || cents <= 0) errors.amount = 'Ingresar un importe mayor que cero.';
		else if (cents > availableCents)
			errors.amount = `El importe no puede superar ${formatMoney(target?.available ?? '0', { decimals: 'always' })}.`;
		if (!date) errors.paymentDate = 'Ingresar la fecha del cobro.';
		else if (date > today) errors.paymentDate = 'La fecha del cobro no puede ser futura.';
		if ([...note].length > noteMax) errors.note = `La nota admite hasta ${noteMax} caracteres.`;
		return errors;
	});
	const invalid = $derived(Object.keys(localErrors).length > 0);
	const err = (name: string) =>
		(touched ? localErrors[name] : undefined) ?? (touched ? null : result?.errors?.[name]?.[0]);
</script>

{#if target}
	<Dialog
		open
		{onClose}
		action={target.action}
		title="Cobrar la cuota {target.installmentNumber} del bono {target.bond}"
		description="{target.buyerName}. El cobro queda enviado y se confirma cuando el operador lo incluye en una rendición y la cierra. Una vez enviado, no se puede editar."
		confirmLabel={invalid || cents === null
			? 'Enviar cobro'
			: `Enviar cobro de ${formatMoney(centsToDecimalString(cents))}`}
		confirmDisabled={invalid}
	>
		<input type="hidden" name="installmentId" value={target.installmentId} />
		<input type="hidden" name="requestKey" value={requestKey} />
		{#if result?.message && !touched}
			<Alert tone="danger">{result.message}</Alert>
		{/if}
		<Field
			label="Importe"
			id="collect-amount"
			required
			hint="Hasta {formatMoney(target.available, { decimals: 'always' })}"
			error={err('amount')}
		>
			<TextInput
				name="amount"
				inputmode="decimal"
				prefix="$"
				bind:value={amount}
				oninput={() => (touched = true)}
				class="text-right tabular-nums"
			/>
		</Field>
		<SegmentedControl
			legend="Medio"
			name="paymentMethod"
			options={methodOptions}
			bind:value={method}
		/>
		<Field label="Fecha del cobro" id="collect-date" required error={err('paymentDate')}>
			<TextInput
				name="paymentDate"
				type="date"
				max={today}
				bind:value={date}
				oninput={() => (touched = true)}
			/>
		</Field>
		<Field
			label="Nota"
			id="collect-note"
			optional
			hint="Hasta {noteMax} caracteres."
			error={err('note')}
		>
			<Textarea name="note" rows={2} bind:value={note} oninput={() => (touched = true)} />
		</Field>
	</Dialog>
{/if}
