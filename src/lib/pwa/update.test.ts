import { describe, expect, it, vi } from 'vitest';
import {
	SKIP_WAITING_MESSAGE,
	applyUpdate,
	isSkipWaitingMessage,
	watchForUpdate,
	type RegistrationLike
} from './update';

function fakeRegistration(waiting: boolean) {
	let updateFound: () => void = () => {};
	let stateChange: () => void = () => {};
	const installing = {
		state: 'installing',
		postMessage: vi.fn(),
		addEventListener: (_: 'statechange', l: () => void) => (stateChange = l)
	};
	const reg = {
		waiting: waiting ? { postMessage: vi.fn() } : null,
		installing: null as RegistrationLike['installing'],
		addEventListener: (_: 'updatefound', l: () => void) => (updateFound = l)
	};
	return {
		reg,
		installing,
		fire() {
			reg.installing = installing;
			updateFound();
		},
		install() {
			installing.state = 'installed';
			stateChange();
		}
	};
}

describe('isSkipWaitingMessage', () => {
	it('accepts only the SKIP_WAITING message', () => {
		expect(isSkipWaitingMessage({ type: SKIP_WAITING_MESSAGE })).toBe(true);
		expect(isSkipWaitingMessage({ type: 'OTHER' })).toBe(false);
		expect(isSkipWaitingMessage(null)).toBe(false);
		expect(isSkipWaitingMessage('SKIP_WAITING')).toBe(false);
	});
});

describe('watchForUpdate', () => {
	it('notifies when a worker is already waiting and the page is controlled', () => {
		const f = fakeRegistration(true);
		const onAvailable = vi.fn();
		watchForUpdate(f.reg, () => true, onAvailable);
		expect(onAvailable).toHaveBeenCalledTimes(1);
	});

	it('notifies when a new worker finishes installing under an existing controller', () => {
		const f = fakeRegistration(false);
		const onAvailable = vi.fn();
		watchForUpdate(f.reg, () => true, onAvailable);
		expect(onAvailable).not.toHaveBeenCalled();
		f.fire();
		f.install();
		expect(onAvailable).toHaveBeenCalledTimes(1);
	});

	it('does not prompt on the very first install (no controller)', () => {
		const f = fakeRegistration(false);
		const onAvailable = vi.fn();
		watchForUpdate(f.reg, () => false, onAvailable);
		f.fire();
		f.install();
		expect(onAvailable).not.toHaveBeenCalled();
	});
});

describe('applyUpdate', () => {
	it('posts SKIP_WAITING and reloads once on controllerchange, not before', () => {
		const postMessage = vi.fn();
		let changed: () => void = () => {};
		const reload = vi.fn();
		applyUpdate(
			{ waiting: { postMessage } },
			{ addEventListener: (_, l) => (changed = l) },
			reload
		);
		expect(postMessage).toHaveBeenCalledWith({ type: 'SKIP_WAITING' });
		expect(reload).not.toHaveBeenCalled();
		changed();
		changed();
		expect(reload).toHaveBeenCalledTimes(1);
	});

	it('does nothing without a waiting worker', () => {
		const reload = vi.fn();
		const add = vi.fn();
		applyUpdate({ waiting: null }, { addEventListener: add }, reload);
		expect(add).not.toHaveBeenCalled();
	});
});
