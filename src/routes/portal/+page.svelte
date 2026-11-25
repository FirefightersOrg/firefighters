<script lang="ts">
	import { Card, EmptyState, PageHeader } from '$lib/components/ui';
	import type { PageProps } from './$types';

	let { data }: PageProps = $props();
</script>

<svelte:head>
	<title>Mi portal - Firefighters</title>
</svelte:head>

{#if data.collector}
	<PageHeader title="Mi portal" description={`Hola, ${data.collector.displayName}.`} />
	<Card title="Tu cartera">
		<p class="m-0 text-muted">
			Acá vas a ver tus bonos, tus ventas y tu cuenta corriente. Todavía no hay secciones
			disponibles.
		</p>
	</Card>
{:else}
	<PageHeader title="Mi portal" />
	<EmptyState title="Tu usuario todavía no está vinculado a un cobrador">
		Pedile a un administrador que vincule tu usuario con tu ficha de cobrador. Mientras tanto no hay
		datos para mostrar.
	</EmptyState>
{/if}
