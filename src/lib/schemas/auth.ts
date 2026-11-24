import { z } from 'zod';

export const loginSchema = z.object({
	email: z
		.string()
		.trim()
		.min(1, 'El correo electrónico es obligatorio')
		.email('El correo electrónico no es válido'),
	password: z.string().min(1, 'La contraseña es obligatoria')
});

export type LoginInput = z.infer<typeof loginSchema>;
