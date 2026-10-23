import { describe, it, expect } from 'vitest';
import { loginSchema } from './auth';

describe('loginSchema', () => {
	it('accepts valid credentials and trims email', () => {
		const result = loginSchema.safeParse({
			email: '  user@firefighters.local  ',
			password: 'password123'
		});

		expect(result.success).toBe(true);
		if (result.success) {
			expect(result.data.email).toBe('user@firefighters.local');
			expect(result.data.password).toBe('password123');
		}
	});

	it('rejects empty or whitespace-only email', () => {
		const emptyResult = loginSchema.safeParse({
			email: '',
			password: 'password123'
		});
		expect(emptyResult.success).toBe(false);

		const whitespaceResult = loginSchema.safeParse({
			email: '   ',
			password: 'password123'
		});
		expect(whitespaceResult.success).toBe(false);
	});

	it('rejects invalid email formats', () => {
		const result = loginSchema.safeParse({
			email: 'not-an-email',
			password: 'password123'
		});
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error.flatten().fieldErrors.email).toBeDefined();
		}
	});

	it('rejects empty password', () => {
		const result = loginSchema.safeParse({
			email: 'admin@firefighters.local',
			password: ''
		});
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error.flatten().fieldErrors.password).toBeDefined();
		}
	});
});
