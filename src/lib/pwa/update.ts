/**
 * Service worker update flow (SAN-116). A new worker waits instead of calling `skipWaiting()` on
 * its own, so assets never change under an open tab. The page shows "Nueva versión disponible" and,
 * on click, asks the waiting worker to take over (SKIP_WAITING) and reloads once it controls the page.
 */

export const SKIP_WAITING_MESSAGE = 'SKIP_WAITING';

/** True when the message is the page's request to activate the waiting worker. */
export function isSkipWaitingMessage(data: unknown): boolean {
	return (
		typeof data === 'object' &&
		data !== null &&
		(data as { type?: unknown }).type === SKIP_WAITING_MESSAGE
	);
}

export interface WaitingWorkerLike {
	postMessage(message: unknown): void;
}

export interface RegistrationLike {
	waiting: WaitingWorkerLike | null;
	installing: (WaitingWorkerLike & EventTargetLike & { state: string }) | null;
	addEventListener(type: 'updatefound', listener: () => void): void;
}

interface EventTargetLike {
	addEventListener(type: 'statechange', listener: () => void): void;
}

/**
 * Calls `onAvailable` when an updated worker is installed and waiting while another worker already
 * controls the page (on first install there is nothing to update, so no prompt).
 */
export function watchForUpdate(
	registration: RegistrationLike,
	hasController: () => boolean,
	onAvailable: () => void
): void {
	if (registration.waiting && hasController()) onAvailable();
	registration.addEventListener('updatefound', () => {
		const worker = registration.installing;
		if (!worker) return;
		worker.addEventListener('statechange', () => {
			if (worker.state === 'installed' && hasController()) onAvailable();
		});
	});
}

export interface ControllerContainerLike {
	addEventListener(type: 'controllerchange', listener: () => void): void;
}

/** Tells the waiting worker to activate, then reloads once (when it becomes the controller). */
export function applyUpdate(
	registration: Pick<RegistrationLike, 'waiting'>,
	container: ControllerContainerLike,
	reload: () => void
): void {
	const waiting = registration.waiting;
	if (!waiting) return;
	let reloaded = false;
	container.addEventListener('controllerchange', () => {
		if (reloaded) return;
		reloaded = true;
		reload();
	});
	waiting.postMessage({ type: SKIP_WAITING_MESSAGE });
}
