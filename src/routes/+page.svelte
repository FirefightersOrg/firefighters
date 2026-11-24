<script lang="ts">
	import { resolve } from '$app/paths';
	import AppNav from '$lib/components/layout/AppNav.svelte';
	import { Alert, Badge, Button, Card, PageHeader } from '$lib/components/ui';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<svelte:head>
	<title>Inicio - Firefighters</title>
</svelte:head>

{#if data.user && data.profile}
	<AppNav fullName={data.profile.full_name} permissions={data.permissions ?? []} />
{/if}

<main class="mx-auto max-w-content px-4 py-8 sm:px-6">
	<PageHeader title="Firefighters" description="Sistema de gestión de Bomberos Voluntarios" />

	{#if data.user && data.profile}
		<div class="flex max-w-form flex-col gap-6">
			<Card title="Sesión activa" id="session">
				<dl class="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2">
					<div>
						<dt class="text-caption text-muted">Nombre</dt>
						<dd class="mt-0.5 text-label text-text">{data.profile.full_name}</dd>
					</div>
					<div>
						<dt class="text-caption text-muted">Correo electrónico</dt>
						<dd class="mt-0.5 text-label text-text">{data.profile.email}</dd>
					</div>
					<div class="sm:col-span-2">
						<dt class="mb-1.5 text-caption text-muted">Roles</dt>
						<dd class="flex flex-wrap gap-2">
							{#if data.rolesError}
								<Alert tone="danger">No se pudieron cargar los roles. Recargar la página.</Alert>
							{:else if data.roles.length > 0}
								{#each data.roles as role (role)}
									<Badge tone="info" dot={false}>{role}</Badge>
								{/each}
							{:else}
								<span class="text-body-sm text-muted">Sin roles asignados</span>
							{/if}
						</dd>
					</div>
				</dl>
			</Card>

			{#if data.permissions?.includes('campaign.view')}
				<nav aria-label="Secciones">
					<Button href={resolve('/campaigns')}>Campañas</Button>
				</nav>
			{/if}
		</div>
	{:else}
		<Card>
			<p class="m-0 mb-4 text-muted">No hay una sesión iniciada.</p>
			<Button variant="primary" href={resolve('/login')}>Iniciar sesión</Button>
		</Card>
	{/if}
</main>
