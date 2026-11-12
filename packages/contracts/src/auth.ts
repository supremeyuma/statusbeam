import { z } from 'zod';

export const passwordSchema = z
  .string()
  .min(12, 'password must be at least 12 characters')
  .max(128, 'password must be at most 128 characters');

export const emailSchema = z.string().trim().email('must be a valid email address').max(254);

export const registerInputSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
});

export const loginInputSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'password is required').max(128),
});

export const authUserSchema = z.object({
  id: z.uuid(),
  email: z.string(),
});

export const authResponseSchema = z.object({
  accessToken: z.string(),
  user: authUserSchema,
});

export type RegisterInput = z.infer<typeof registerInputSchema>;
export type LoginInput = z.infer<typeof loginInputSchema>;
export type AuthUser = z.infer<typeof authUserSchema>;
export type AuthResponse = z.infer<typeof authResponseSchema>;
