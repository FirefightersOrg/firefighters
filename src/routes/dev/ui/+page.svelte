<script lang="ts">
	import {
		Button,
		Icon,
		Field,
		TextInput,
		Select,
		Textarea,
		Checkbox,
		RadioGroup,
		Badge,
		Dialog,
		FilterBar,
		Row,
		RowActions,
		RowList,
		SegmentedControl,
		Table,
		TaskBar
	} from '$lib/components/ui';
	import { ICON_NAMES } from '$lib/components/ui/icon-names';

	let theme = $state<'light' | 'dark'>('light');
	let loading = $state(false);
	let method = $state('transfer');

	const methods = [
		{ value: 'cash', label: 'Efectivo', description: 'Se cobra en el momento' },
		{ value: 'transfer', label: 'Transferencia' },
		{ value: 'card', label: 'Tarjeta', disabled: true }
	];
	const types = [
		'Efectivo',
		{ value: 'cuotas', label: 'Cuotas' },
		{ value: 'x', label: 'No disponible', disabled: true }
	];
	const variants = ['primary', 'secondary', 'ghost', 'danger'] as const;

	let payMethod = $state('cash');
	let removing = $state<string | null>(null);
	let lastAction = $state('');
	const payMethods = [
		{ value: 'cash', label: 'Efectivo' },
		{ value: 'transfer', label: 'Transferencia' }
	];
	const payments = [
		{
			id: '1',
			bond: '0019',
			buyer: 'Patricia Rodríguez',
			detail: 'Pago total, efectivo',
			amount: '$ 60.000'
		},
		{
			id: '2',
			bond: '0003',
			buyer: 'Daniel Luna',
			detail: 'Cuota 4, transferencia',
			amount: '$ 10.000'
		},
		{
			id: '3',
			bond: '0008',
			buyer: 'Graciela Ojeda',
			detail: 'Cuota 3, efectivo',
			amount: '$ 10.000'
		}
	];
	const bondColumns = [
		{ key: 'bond', header: 'Bono', stack: 'primary' as const },
		{ key: 'value', header: 'Valor', align: 'right' as const, stack: 'trailing' as const },
		{ key: 'buyer', header: 'Comprador', stack: 'secondary' as const },
		{ key: 'collector', header: 'Cobrador' },
		{ key: 'state', header: 'Estado' },
		{ key: 'code', header: 'Código', stack: 'hidden' as const }
	];
	const bondRows = [
		{
			id: 'a',
			bond: '0181 / 5181',
			value: '$ 60.000',
			buyer: 'Stella Rodríguez',
			collector: 'Héctor Acosta',
			state: 'Vendido, en mora',
			code: '—'
		},
		{
			id: 'b',
			bond: '0182 / 5182',
			value: '$ 60.000',
			buyer: 'Luis Pérez',
			collector: 'Héctor Acosta',
			state: 'Vendido, al día',
			code: '—'
		},
		{
			id: 'c',
			bond: '0211 / 5211',
			value: '$ 60.000',
			buyer: 'Sin vender',
			collector: 'Raúl Sosa',
			state: 'Entregado al cobrador',
			code: '—'
		}
	];
</script>

<svelte:head><title>UI kit (dev)</title></svelte:head>

{#snippet showcase()}
	<div class="flex flex-col gap-10">
		<section class="flex flex-col gap-4">
			<h2 class="text-heading-2">Button</h2>
			{#each ['sm', 'md', 'lg'] as const as size (size)}
				<div class="flex flex-wrap items-center gap-3">
					{#each variants as variant (variant)}
						<Button {variant} {size}>{variant}</Button>
						<Button {variant} {size} icon="plus">Con ícono</Button>
						<Button {variant} {size} disabled>Inactivo</Button>
						<Button {variant} {size} loading>Cargando</Button>
					{/each}
					<Button {size} icon="download" aria-label="Descargar" />
					<Button {size} href="/dev/ui" iconEnd="chevron-down">Enlace</Button>
				</div>
			{/each}
			<div class="max-w-form">
				<Button
					variant="primary"
					size="lg"
					block
					{loading}
					onclick={() => {
						loading = true;
						setTimeout(() => (loading = false), 1500);
					}}
				>
					Bloque (clic para cargar)
				</Button>
			</div>
		</section>

		<section class="flex flex-col gap-3">
			<h2 class="text-heading-2">Icon</h2>
			<div class="flex flex-wrap gap-4">
				{#each ICON_NAMES as name (name)}
					<span class="inline-flex items-center gap-2 text-body-sm text-muted">
						<Icon {name} />
						<Icon {name} size="sm" />
						{name}
					</span>
				{/each}
				<Icon name="success" label="Correcto" class="text-success" />
			</div>
		</section>

		<section class="flex max-w-form flex-col gap-5">
			<h2 class="text-heading-2">Field y controles</h2>
			<Field label="Nombre" hint="Como figura en el documento."
				><TextInput name="name" placeholder="Ana Pérez" /></Field
			>
			<Field label="Monto" optional
				><TextInput name="amount" prefix="$" inputmode="decimal" /></Field
			>
			<Field label="Código" error="El código 0457 ya está asignado. Elegir otro."
				><TextInput name="code" mono value="0457" /></Field
			>
			<Field label="Solo lectura"><TextInput readonly value="No editable" /></Field>
			<Field label="Inactivo"><TextInput disabled value="Inactivo" /></Field>
			<Field label="Tipo" hint="Elegir una opción."
				><Select name="type" options={types} placeholder="Elegir…" /></Field
			>
			<Field label="Tipo con error" error="Elegir un tipo."
				><Select options={types} placeholder="Elegir…" /></Field
			>
			<Field label="Motivo" optional><Textarea name="reason" rows={3} /></Field>
			<Field label="Motivo con error" error="Escribir al menos 10 caracteres."><Textarea /></Field>
			<Checkbox
				name="confirm"
				label="Confirmo la anulación"
				description="Esta acción no se puede deshacer."
			/>
			<Checkbox label="Inactiva" disabled />
			<RadioGroup legend="Medio de pago" name="method" options={methods} bind:value={method} />
			<RadioGroup legend="Con error" options={methods} error="Elegir un medio de pago." />
			<p class="text-body-sm text-muted">Seleccionado: {method}</p>
		</section>

		<section class="flex flex-col gap-4" data-demo="segmented">
			<h2 class="text-heading-2">SegmentedControl</h2>
			<div class="max-w-80">
				<SegmentedControl legend="Medio de pago" options={payMethods} bind:value={payMethod} />
			</div>
			<p class="text-body-sm text-muted" data-demo-value>Elegido: {payMethod}</p>
		</section>

		<section class="flex flex-col gap-4" data-demo="filters">
			<h2 class="text-heading-2">FilterBar</h2>
			<FilterBar
				action="/dev/ui"
				searchName="base"
				searchLabel="Número de bono"
				inputmode="numeric"
				applied={[
					{ label: 'Estado: Vendido', removeHref: '/dev/ui?type=simple' },
					{ label: 'Tipo: Bono simple', removeHref: '/dev/ui?status=sold' }
				]}
				clearHref="/dev/ui"
			>
				{#snippet filters()}
					<Field label="Estado comercial" id="demo-status">
						<Select name="status" options={['Cualquiera', 'Disponible', 'Vendido']} />
					</Field>
				{/snippet}
			</FilterBar>
		</section>

		<section class="flex flex-col gap-4" data-demo="rows">
			<h2 class="text-heading-2">RowList, Row y RowActions</h2>
			<RowList label="Pagos de esta rendición">
				{#each payments as payment (payment.id)}
					<Row title={payment.buyer} detail={payment.detail}>
						{#snippet lead()}<span class="font-figure text-[20px] font-bold tabular-nums"
								>{payment.bond}</span
							>{/snippet}
						{#snippet trailing()}<span class="tabular-nums">{payment.amount}</span>{/snippet}
						{#snippet actions()}
							<RowActions
								label="Acciones del pago del bono {payment.bond}"
								actions={[
									{
										label: 'Corregir el medio de pago',
										onselect: () => (lastAction = `corregir ${payment.bond}`)
									},
									{
										label: 'Quitar de la rendición',
										tone: 'danger',
										onselect: () => (removing = payment.bond)
									}
								]}
							/>
						{/snippet}
					</Row>
				{/each}
				<Row title="Sorteo de noviembre" href="#sorteo">
					{#snippet meta()}<Badge tone="warning">No habilitado</Badge> Falta la cuota 2{/snippet}
				</Row>
			</RowList>
			<p class="text-body-sm text-muted" data-demo-action>
				Última acción: {lastAction || 'ninguna'}
			</p>
			<Dialog
				open={removing !== null}
				onClose={() => (removing = null)}
				onConfirm={() => {
					lastAction = `quitar ${removing}`;
					removing = null;
				}}
				title="¿Quitar el pago del bono {removing}?"
				description="El pago sale de esta rendición y la cuota vuelve a quedar pendiente."
				confirmLabel="Quitar pago"
			/>
		</section>

		<section class="flex flex-col gap-4" data-demo="table">
			<h2 class="text-heading-2">Table apilada en el teléfono</h2>
			<p class="text-body-sm text-muted">
				Por debajo de 720 px cada fila pasa a ser un bloque de líneas; arriba es la tabla de
				siempre.
			</p>
			<Table columns={bondColumns} rows={bondRows} caption="Bonos de la campaña" stack />
		</section>

		<section class="flex flex-col gap-4" data-demo="taskbar">
			<h2 class="text-heading-2">TaskBar</h2>
			<p class="text-body-sm text-muted">
				En teléfono queda fija al pie de la pantalla; desde 1024 px es un bloque más.
			</p>
			<TaskBar label="Cierre de la rendición">
				<span class="block text-body-sm text-muted">Entrega en efectivo</span>
				<span class="font-figure text-figure">$ 63.000</span>
				{#snippet action()}<Button variant="primary">Revisar y cerrar</Button>{/snippet}
			</TaskBar>
		</section>
	</div>
{/snippet}

<main class="min-h-screen bg-bg p-6 text-text">
	<div class="mx-auto flex max-w-content flex-col gap-8">
		<header class="flex items-center justify-between">
			<h1 class="text-heading-1">UI kit Cimiento</h1>
			<Button
				onclick={() => {
					theme = theme === 'light' ? 'dark' : 'light';
					document.documentElement.dataset.theme = theme;
				}}
			>
				Tema: {theme === 'light' ? 'claro' : 'oscuro'}
			</Button>
		</header>
		{@render showcase()}
	</div>
</main>
