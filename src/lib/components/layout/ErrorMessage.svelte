<script lang="ts">
	import { Button } from '$lib/components/ui';
	import { errorCopy } from '$lib/error-copy';

	/**
	 * The content of an error page: what happened and the way back, in Spanish, inside whatever shell
	 * the route has (the campaign shell, the portal, or the plain header).
	 */
	let {
		status,
		error,
		retryHref,
		back
	}: {
		status: number;
		error: { message?: string; code?: string; permission?: string } | null | undefined;
		/** The same address, to try again after a failure. */
		retryHref: string;
		/** Where to go from here: the list the record belongs to, then the home. Resolved by the caller. */
		back: { label: string; href: string }[];
	} = $props();

	const copy = $derived(errorCopy(status, error));
</script>

<!-- eslint-disable svelte/no-navigation-without-resolve -- hrefs are resolved by the caller -->
<section class="max-w-prose py-6" aria-labelledby="error-title" data-error-page>
	<p class="m-0 text-body-sm text-subtle">Error {status}</p>
	<h1 id="error-title" class="m-0 mt-1 text-heading-1 text-text">{copy.title}</h1>
	<p class="m-0 mt-3 text-body text-muted" role={status >= 500 ? 'alert' : undefined}>
		{copy.body}
	</p>
	<div class="mt-6 flex flex-wrap gap-2">
		{#if copy.retry}
			<Button variant="primary" href={retryHref}>Volver a intentar</Button>
		{/if}
		{#each back as link, i (link.href)}
			<Button variant={!copy.retry && i === 0 ? 'primary' : 'secondary'} href={link.href}
				>{link.label}</Button
			>
		{/each}
	</div>
</section>
