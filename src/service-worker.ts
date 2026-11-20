/// <reference types="@sveltejs/kit" />
/// <reference no-default-lib="true"/>
/// <reference lib="esnext" />
/// <reference lib="webworker" />

import { build, files, version } from '$service-worker';
import {
	OFFLINE_URL,
	cacheName,
	isCacheableAsset,
	isHandledRequest,
	isNavigationRequest,
	isPrecachablePath,
	staleCacheNames
} from '$lib/pwa/cache-policy';
import { isSkipWaitingMessage } from '$lib/pwa/update';

declare const self: ServiceWorkerGlobalScope;

const CACHE = cacheName(version);
const PRECACHE = [...build, ...files].filter(isPrecachablePath);
const PRECACHED_PATHS: ReadonlySet<string> = new Set(PRECACHE);

self.addEventListener('install', (event) => {
	event.waitUntil(
		// No skipWaiting() here: an updated worker waits until the page asks for it (SKIP_WAITING),
		// so an open tab never gets its assets swapped mid-session.
		caches.open(CACHE).then((cache) => cache.addAll(PRECACHE))
	);
});

self.addEventListener('message', (event) => {
	if (isSkipWaitingMessage(event.data)) void self.skipWaiting();
});

self.addEventListener('activate', (event) => {
	event.waitUntil(
		caches
			.keys()
			.then((names) => Promise.all(staleCacheNames(names, version).map((n) => caches.delete(n))))
			.then(() => self.clients.claim())
	);
});

self.addEventListener('fetch', (event) => {
	const { request } = event;
	const url = new URL(request.url);
	if (!isHandledRequest(request, url, self.location.origin)) return;

	if (isNavigationRequest(request)) {
		// Network-first and never stored: HTML may contain per-user data. Offline shows a static page.
		event.respondWith(
			fetch(request).catch(async () => {
				const fallback = await caches.match(OFFLINE_URL);
				return fallback ?? Response.error();
			})
		);
		return;
	}

	if (isCacheableAsset(request, url, self.location.origin, PRECACHED_PATHS)) {
		event.respondWith(caches.match(url.pathname).then((hit) => hit ?? fetch(request)));
	}
	// Anything else falls through to the network untouched.
});
