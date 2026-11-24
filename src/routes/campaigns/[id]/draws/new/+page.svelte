<script lang="ts">
	import { resolve } from '$app/paths';
	import {
		Button,
		Card,
		Field,
		FormResult,
		PageHeader,
		Select,
		TextInput
	} from '$lib/components/ui';
	import { DRAW_TYPES, DRAW_TYPE_LABELS } from '$lib/domain/draws';
	import type { PageProps } from './$types';

	let { data, form }: PageProps = $props();

	const values = $derived(
		(form && 'values' in form ? form.values : {}) as Record<string, string | undefined>
	);
	const errors = $derived((form?.errors ?? {}) as Record<string, string[] | undefined>);
	const typeOptions = DRAW_TYPES.map((type) => ({ value: type, label: DRAW_TYPE_LABELS[type] }));
	const fields = [
		{ name: 'drawType', label: 'Tipo', id: 'drawType' },
		{ name: 'name', label: 'Nombre', id: 'name' },
		{ name: 'drawDate', label: 'Fecha del sorteo', id: 'drawDate' },
		{ name: 'paymentCutoffLocal', label: 'Corte de pagos', id: 'paymentCutoffLocal' },
		{
			name: 'requiredInstallmentNumber',
			label: 'Cuota requerida',
			id: 'requiredInstallmentNumber'
		},
		{
			name: 'consolationRequiredInstallmentNumber',
			label: 'Cuota requerida para consuelo',
			id: 'consolationRequiredInstallmentNumber'
		}
	];
</script>

<svelte:head><title>Nuevo sorteo - {data.campaign.name}</title></svelte:head>

<PageHeader
	title="Nuevo sorteo"
	breadcrumbs={[
		{ label: 'Campañas', href: resolve('/campaigns') },
		{ label: data.campaign.name, href: resolve('/campaigns/[id]', { id: data.campaign.id }) },
		{ label: 'Sorteos', href: resolve('/campaigns/[id]/draws', { id: data.campaign.id }) },
		{ label: 'Nuevo sorteo' }
	]}
/>

<div class="space-y-6">
	<FormResult result={form ? { success: false, message: form.message, errors } : null} {fields} />
	<Card>
		<form method="POST" action="?/create" class="space-y-4">
			<Field label="Tipo" id="drawType" required error={errors.drawType?.[0]}>
				<Select name="drawType" options={typeOptions} value={values.drawType ?? DRAW_TYPES[0]} />
			</Field>
			<Field label="Nombre" id="name" required error={errors.name?.[0]}>
				<TextInput name="name" value={values.name ?? ''} />
			</Field>
			<Field label="Fecha del sorteo" id="drawDate" required error={errors.drawDate?.[0]}>
				<TextInput name="drawDate" type="date" value={values.drawDate ?? ''} />
			</Field>
			<Field
				label="Corte de pagos"
				id="paymentCutoffLocal"
				required
				hint="Hora de Buenos Aires (UTC−03)."
				error={errors.paymentCutoffLocal?.[0]}
			>
				<TextInput
					name="paymentCutoffLocal"
					type="datetime-local"
					value={values.paymentCutoffLocal ?? ''}
				/>
			</Field>
			<Field
				label="Cuota requerida"
				id="requiredInstallmentNumber"
				hint="Obligatoria en los sorteos mensuales."
				error={errors.requiredInstallmentNumber?.[0]}
			>
				<TextInput
					name="requiredInstallmentNumber"
					type="number"
					min="1"
					max={data.campaign.installmentCount}
					value={values.requiredInstallmentNumber ?? ''}
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
					value={values.consolationRequiredInstallmentNumber ?? ''}
				/>
			</Field>
			<Button type="submit" variant="primary">Crear sorteo</Button>
		</form>
	</Card>
</div>
