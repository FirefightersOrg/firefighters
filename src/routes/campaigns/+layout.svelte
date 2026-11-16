<script lang="ts">
	import { resolve } from '$app/paths';
	import type { LayoutProps } from './$types';

	let { data, children }: LayoutProps = $props();
</script>

<div class="min-h-screen bg-slate-50 text-slate-900">
	<header class="border-b border-slate-200 bg-white">
		<nav
			class="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3 sm:px-6"
			aria-label="Main"
		>
			<div class="flex items-center gap-4 text-sm">
				<a href={resolve('/')} class="font-semibold text-slate-900 hover:text-blue-700">
					Firefighters
				</a>
				<a href={resolve('/campaigns')} class="text-slate-600 hover:text-blue-700">Campaigns</a>
			</div>
			<div class="flex items-center gap-3 text-sm text-slate-600">
				{#if data.profile}<span class="hidden sm:inline">{data.profile.full_name}</span>{/if}
				<form method="POST" action={resolve('/logout')}>
					<button type="submit" class="cursor-pointer text-slate-600 hover:text-blue-700">
						Log out
					</button>
				</form>
			</div>
		</nav>
	</header>

	<main class="mx-auto max-w-5xl px-4 py-8 sm:px-6">
		{@render children()}
	</main>
</div>
