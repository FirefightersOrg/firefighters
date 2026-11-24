<script lang="ts">
	import StatusBadge from '$lib/components/ui/StatusBadge.svelte';
	import { enhance } from '$app/forms';
	import { resolve } from '$app/paths';
	import FieldError from '$lib/components/campaigns/FieldError.svelte';
	import FormAlert from '$lib/components/campaigns/FormAlert.svelte';
	import {
		cardClass,
		hintClass,
		inputClass,
		labelClass,
		primaryButtonClass,
		secondaryButtonClass
	} from '$lib/components/campaigns/styles';
	import { IMPORT_MAX_FILE_BYTES } from '$lib/domain/imports';
	import { IMPORT_SOURCE_LABELS } from '$lib/domain/import-preview';
	import type { PageProps } from './$types';

	/**
	 * File import: upload a CSV or Excel file, then review it on the preview page (the upload
	 * redirects there). Lists the campaign's file imports, newest first.
	 */
	let { data, form }: PageProps = $props();

	const campaign = $derived(data.campaign);
	const campaignHref = $derived(resolve('/campaigns/[id]', { id: campaign.id }));
	const sessionHref = (sessionId: string) =>
		resolve('/campaigns/[id]/bonds/import/[sessionId]', { id: campaign.id, sessionId });
	let uploading = $state(false);

	const dateTime = new Intl.DateTimeFormat('es-AR', { dateStyle: 'short', timeStyle: 'short' });
	const fileErrors = $derived(form?.errors?.file);
	const notesErrors = $derived(form?.errors?.notes);
</script>

<svelte:head>
	<title>Import bonds - {campaign.name} - Firefighters</title>
</svelte:head>

<div class="space-y-6">
	<div>
		<a href={campaignHref} class="text-sm text-blue-700 hover:underline">← {campaign.name}</a>
		<div class="mt-2 flex flex-wrap items-center gap-3">
			<h1 class="text-2xl font-bold tracking-tight">Import bonds from a file</h1>
			<StatusBadge kind="campaign" status={campaign.status} />
		</div>
		<p class="text-sm text-slate-500">
			Upload a CSV or Excel file, review the rows and confirm. Nothing is created until you confirm.
			<a
				href={resolve('/campaigns/[id]/bonds/scan', { id: campaign.id })}
				class="text-blue-700 hover:underline">Use the barcode scanner →</a
			>
		</p>
	</div>

	{#if !data.canLoad}
		<FormAlert kind="warning">
			<p><strong>Bonds cannot be imported.</strong> {data.lockedMessage}</p>
		</FormAlert>
	{:else}
		{#if form?.message && !form.success}
			<FormAlert message={form.message} />
		{/if}

		<section class="{cardClass} space-y-4" aria-labelledby="upload-title">
			<h2 id="upload-title" class="text-base font-semibold">Upload a file</h2>
			<div class="text-sm text-slate-600">
				<p>
					The first row must hold the column names
					<code class="rounded bg-slate-100 px-1">tipo_bono,grupo_pata,numero_base,barcode</code>.
					Rows sharing a <code class="rounded bg-slate-100 px-1">grupo_pata</code> form one pata (every
					pata row needs its barcode).
				</p>
				<pre
					class="mt-2 overflow-x-auto rounded-lg bg-slate-50 p-3 text-xs">tipo_bono,grupo_pata,numero_base,barcode
simple,,1658,1658
pata,PATA1200,1200,PATA1200-1200
pata,PATA1200,1315,PATA1200-1315</pre>
			</div>
			{#if campaign.status === 'draft'}
				<FormAlert kind="warning">
					<p>
						This campaign is a draft. <strong>Confirming the first import freezes its rules</strong>
						(price, installments, numbering, overflow policy and barcode mode).
					</p>
				</FormAlert>
			{/if}

			<form
				method="POST"
				action="?/upload"
				enctype="multipart/form-data"
				class="space-y-4"
				use:enhance={() => {
					uploading = true;
					return async ({ update }) => {
						await update();
						uploading = false;
					};
				}}
			>
				<div>
					<label for="file" class={labelClass}>File (.csv or .xlsx)</label>
					<input
						id="file"
						name="file"
						type="file"
						accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
						required
						aria-invalid={fileErrors?.length ? 'true' : undefined}
						aria-describedby={fileErrors?.length ? 'file-hint file-error' : 'file-hint'}
						class="{inputClass} file:mr-3 file:rounded file:border-0 file:bg-slate-100 file:px-3 file:py-1"
					/>
					<p id="file-hint" class={hintClass}>
						Up to {Math.round(IMPORT_MAX_FILE_BYTES / 1024 / 1024)} MB and 5,000 rows. Excel: the first
						sheet is read.
					</p>
					<FieldError id="file-error" errors={fileErrors} />
				</div>
				<div>
					<label for="notes" class={labelClass}>Notes (optional)</label>
					<input
						id="notes"
						name="notes"
						type="text"
						maxlength="2000"
						value={form?.values?.notes ?? ''}
						aria-invalid={notesErrors?.length ? 'true' : undefined}
						class={inputClass}
						placeholder="For example: March printing batch"
					/>
					<FieldError id="notes-error" errors={notesErrors} />
				</div>
				<button type="submit" class={primaryButtonClass} disabled={uploading}>
					{uploading ? 'Reading the file…' : 'Upload and review'}
				</button>
			</form>
		</section>
	{/if}

	<section class="{cardClass} space-y-3" aria-labelledby="history-title">
		<h2 id="history-title" class="text-base font-semibold">File imports</h2>
		{#if data.sessions.length === 0}
			<p class="text-sm text-slate-500">No file has been imported in this campaign yet.</p>
		{:else}
			<div class="overflow-x-auto">
				<table class="min-w-full text-sm">
					<thead class="text-left text-xs text-slate-500 uppercase">
						<tr>
							<th class="py-2 pr-4 font-medium">File</th>
							<th class="py-2 pr-4 font-medium">Type</th>
							<th class="py-2 pr-4 font-medium">Status</th>
							<th class="py-2 pr-4 font-medium">Uploaded</th>
							<th class="py-2 font-medium"><span class="sr-only">Open</span></th>
						</tr>
					</thead>
					<tbody class="divide-y divide-slate-100">
						{#each data.sessions as session (session.id)}
							<tr>
								<td class="py-2 pr-4">
									<span class="font-medium">{session.fileName}</span>
									{#if session.notes}<span class="block text-xs text-slate-500"
											>{session.notes}</span
										>{/if}
								</td>
								<td class="py-2 pr-4 text-slate-600">{IMPORT_SOURCE_LABELS[session.sourceType]}</td>
								<td class="py-2 pr-4">
									<StatusBadge
										kind="importSession"
										status={session.rolledBackAt !== null ? 'rolled_back' : session.status}
									/>
								</td>
								<td class="py-2 pr-4 text-slate-600 tabular-nums"
									>{dateTime.format(new Date(session.createdAt))}</td
								>
								<td class="py-2 text-right">
									<a href={sessionHref(session.id)} class={secondaryButtonClass}>
										{session.status === 'draft' || session.status === 'validated'
											? 'Review'
											: 'View'}
									</a>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>
		{/if}
	</section>
</div>
