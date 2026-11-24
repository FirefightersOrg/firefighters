<script lang="ts">
	import { enhance } from '$app/forms';
	import { Alert, Button, Card, Field, FormErrorSummary, TextInput } from '$lib/components/ui';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	let isSubmitting = $state(false);

	const fieldErrors = $derived(form?.errors ?? {});
</script>

<svelte:head>
	<title>Iniciar sesión - Firefighters</title>
</svelte:head>

<main class="mx-auto flex min-h-screen max-w-form flex-col justify-center gap-6 px-4 py-12">
	<div class="text-center">
		<p class="m-0 text-heading-3 text-text">Firefighters</p>
		<h1 class="mt-2 text-heading-1 text-text">Iniciar sesión</h1>
		<p class="mt-1 text-body text-muted">Sistema de gestión de Bomberos Voluntarios</p>
	</div>

	<Card>
		<div class="flex flex-col gap-5">
			{#if data.sessionExpired && !form?.message}
				<Alert tone="warning" title="La sesión expiró">
					Iniciar sesión de nuevo para continuar.
				</Alert>
			{/if}

			{#if form?.errors}
				<FormErrorSummary
					errors={fieldErrors}
					fields={[
						{ name: 'email', label: 'Correo electrónico' },
						{ name: 'password', label: 'Contraseña' }
					]}
				/>
			{:else if form?.message}
				<Alert tone="danger">{form.message}</Alert>
			{/if}

			<form
				method="POST"
				use:enhance={() => {
					isSubmitting = true;
					return async ({ update }) => {
						try {
							await update();
						} finally {
							isSubmitting = false;
						}
					};
				}}
				class="flex flex-col gap-5"
			>
				{#if data.redirectTo}
					<input type="hidden" name="redirectTo" value={data.redirectTo} />
				{/if}

				<Field label="Correo electrónico" id="email" error={fieldErrors.email?.[0]}>
					<TextInput
						name="email"
						type="email"
						autocomplete="email"
						required
						value={form?.email ?? ''}
					/>
				</Field>

				<Field label="Contraseña" id="password" error={fieldErrors.password?.[0]}>
					<TextInput name="password" type="password" autocomplete="current-password" required />
				</Field>

				<Button type="submit" variant="primary" size="lg" block loading={isSubmitting}>
					{isSubmitting ? 'Iniciando sesión…' : 'Iniciar sesión'}
				</Button>
			</form>

			<p class="m-0 border-t border-border pt-4 text-center text-body-sm text-muted">
				El acceso es restringido. Pedir acceso a un administrador.
			</p>
		</div>
	</Card>
</main>
