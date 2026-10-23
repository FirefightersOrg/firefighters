<script lang="ts">
	import { resolve } from '$app/paths';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
</script>

<svelte:head>
	<title>Home - Firefighters</title>
</svelte:head>

<main class="min-h-screen bg-slate-50 text-slate-900 py-12 px-4 sm:px-6 lg:px-8">
	<div class="max-w-2xl mx-auto bg-white rounded-xl shadow-sm border border-slate-200 p-6 sm:p-8">
		<header class="border-b border-slate-100 pb-5 mb-6">
			<h1 class="text-2xl font-bold tracking-tight text-slate-900">Firefighters</h1>
			<p class="text-sm text-slate-500">Bomberos Voluntarios Management System</p>
		</header>

		{#if data.user && data.profile}
			<div class="space-y-6">
				<div class="bg-slate-50 rounded-lg p-5 border border-slate-200/60">
					<h2 class="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-4">
						Active Session
					</h2>
					<dl class="grid grid-cols-1 gap-y-4 sm:grid-cols-2">
						<div>
							<dt class="text-xs font-medium text-slate-500">Name</dt>
							<dd class="text-sm font-semibold text-slate-900 mt-0.5">{data.profile.full_name}</dd>
						</div>
						<div>
							<dt class="text-xs font-medium text-slate-500">Email</dt>
							<dd class="text-sm font-semibold text-slate-900 mt-0.5">{data.profile.email}</dd>
						</div>
						<div class="sm:col-span-2">
							<dt class="text-xs font-medium text-slate-500 mb-1.5">Roles</dt>
							<dd class="flex flex-wrap gap-2">
								{#if data.roles && data.roles.length > 0}
									{#each data.roles as role (role)}
										<span
											class="inline-flex items-center px-2.5 py-1 rounded-md text-xs font-medium bg-blue-100 text-blue-800"
										>
											{role}
										</span>
									{/each}
								{:else}
									<span class="text-sm text-slate-400 italic">No roles assigned</span>
								{/if}
							</dd>
						</div>
					</dl>
				</div>

				<div class="pt-2 flex justify-end">
					<form method="POST" action="?/logout">
						<button
							type="submit"
							class="inline-flex justify-center items-center px-4 py-2 border border-slate-300 shadow-xs text-sm font-medium rounded-lg text-slate-700 bg-white hover:bg-slate-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 cursor-pointer transition-colors"
						>
							Log out
						</button>
					</form>
				</div>
			</div>
		{:else}
			<div class="text-center py-10 space-y-4">
				<p class="text-slate-600">You are not logged in.</p>
				<div>
					<a
						href={resolve('/login')}
						class="inline-flex justify-center items-center px-5 py-2.5 border border-transparent text-sm font-medium rounded-lg text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 shadow-sm transition-colors"
					>
						Sign in
					</a>
				</div>
			</div>
		{/if}
	</div>
</main>
