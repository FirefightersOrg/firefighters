<script lang="ts">
	import { enhance } from '$app/forms';
	import type { ActionData, PageData } from './$types';

	let { data, form }: { data: PageData; form: ActionData } = $props();

	let isSubmitting = $state(false);
</script>

<svelte:head>
	<title>Sign In - Firefighters</title>
</svelte:head>

<div class="min-h-screen bg-slate-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
	<div class="sm:mx-auto sm:w-full sm:max-w-md">
		<div class="text-center">
			<div
				class="mx-auto h-12 w-12 rounded-xl bg-blue-600 flex items-center justify-center text-white shadow-md shadow-blue-500/20"
			>
				<svg
					xmlns="http://www.w3.org/2000/svg"
					class="h-7 w-7"
					fill="none"
					viewBox="0 0 24 24"
					stroke="currentColor"
					stroke-width="2"
					aria-hidden="true"
				>
					<path
						stroke-linecap="round"
						stroke-linejoin="round"
						d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
					/>
				</svg>
			</div>
			<h1 class="mt-4 text-2xl font-bold tracking-tight text-slate-900">Sign in to Firefighters</h1>
			<p class="mt-1 text-sm text-slate-500">Bomberos Voluntarios Management System</p>
		</div>
	</div>

	<div class="mt-8 sm:mx-auto sm:w-full sm:max-w-md">
		<div class="bg-white py-8 px-4 shadow-sm sm:rounded-xl sm:px-10 border border-slate-200/80">
			{#if data.reason === 'expired'}
				<div
					role="alert"
					class="mb-6 rounded-lg bg-amber-50 p-4 border border-amber-200 text-sm text-amber-800 flex items-start space-x-3"
				>
					<svg
						class="h-5 w-5 text-amber-500 mt-0.5 shrink-0"
						xmlns="http://www.w3.org/2000/svg"
						viewBox="0 0 20 20"
						fill="currentColor"
						aria-hidden="true"
					>
						<path
							fill-rule="evenodd"
							d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z"
							clip-rule="evenodd"
						/>
					</svg>
					<span>Your session has expired. Please sign in again to continue.</span>
				</div>
			{/if}

			{#if form?.message}
				<div
					role="alert"
					class="mb-6 rounded-lg bg-red-50 p-4 border border-red-200 text-sm text-red-800 flex items-start space-x-3"
				>
					<svg
						class="h-5 w-5 text-red-500 mt-0.5 shrink-0"
						xmlns="http://www.w3.org/2000/svg"
						viewBox="0 0 20 20"
						fill="currentColor"
						aria-hidden="true"
					>
						<path
							fill-rule="evenodd"
							d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z"
							clip-rule="evenodd"
						/>
					</svg>
					<span>{form.message}</span>
				</div>
			{/if}

			<form
				method="POST"
				use:enhance={() => {
					isSubmitting = true;
					return async ({ update }) => {
						isSubmitting = false;
						await update();
					};
				}}
				class="space-y-5"
			>
				{#if data.redirectTo}
					<input type="hidden" name="redirectTo" value={data.redirectTo} />
				{/if}

				<div>
					<label for="email" class="block text-sm font-medium text-slate-700">Email address</label>
					<div class="mt-1">
						<input
							id="email"
							name="email"
							type="email"
							autocomplete="email"
							required
							value={form?.email ?? ''}
							aria-invalid={form?.errors?.email ? 'true' : undefined}
							aria-describedby={form?.errors?.email ? 'email-error' : undefined}
							class="block w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 placeholder-slate-400 shadow-xs focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 sm:text-sm"
						/>
					</div>
					{#if form?.errors?.email}
						<p id="email-error" class="mt-1 text-xs text-red-600">
							{form.errors.email[0]}
						</p>
					{/if}
				</div>

				<div>
					<label for="password" class="block text-sm font-medium text-slate-700">Password</label>
					<div class="mt-1">
						<input
							id="password"
							name="password"
							type="password"
							autocomplete="current-password"
							required
							aria-invalid={form?.errors?.password ? 'true' : undefined}
							aria-describedby={form?.errors?.password ? 'password-error' : undefined}
							class="block w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 placeholder-slate-400 shadow-xs focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 sm:text-sm"
						/>
					</div>
					{#if form?.errors?.password}
						<p id="password-error" class="mt-1 text-xs text-red-600">
							{form.errors.password[0]}
						</p>
					{/if}
				</div>

				<div>
					<button
						type="submit"
						disabled={isSubmitting}
						class="w-full flex justify-center items-center py-2.5 px-4 border border-transparent rounded-lg shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer transition-colors"
					>
						{#if isSubmitting}
							<svg
								class="animate-spin -ml-1 mr-2 h-4 w-4 text-white"
								xmlns="http://www.w3.org/2000/svg"
								fill="none"
								viewBox="0 0 24 24"
								aria-hidden="true"
							>
								<circle
									class="opacity-25"
									cx="12"
									cy="12"
									r="10"
									stroke="currentColor"
									stroke-width="4"
								></circle>
								<path
									class="opacity-75"
									fill="currentColor"
									d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
								></path>
							</svg>
							<span>Signing in...</span>
						{:else}
							<span>Sign in</span>
						{/if}
					</button>
				</div>
			</form>

			<div class="mt-6 border-t border-slate-200/60 pt-4 text-center">
				<p class="text-xs text-slate-500">
					Account access is restricted. Contact your administrator if you need access.
				</p>
			</div>
		</div>
	</div>
</div>
