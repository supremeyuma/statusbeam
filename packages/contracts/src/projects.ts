import { z } from 'zod';

export const projectNameSchema = z.string().trim().min(1).max(80);

export const projectSlugSchema = z
  .string()
  .trim()
  .min(1)
  .max(48)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'slug must be lowercase words separated by single dashes');

export const createProjectInputSchema = z.object({
  name: projectNameSchema,
  public: z.boolean().default(false),
});

export const updateProjectInputSchema = z
  .object({
    name: projectNameSchema.optional(),
    slug: projectSlugSchema.optional(),
    public: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'at least one field is required',
  });

export const projectResponseSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  slug: z.string(),
  public: z.boolean(),
  createdAt: z.string(),
});

export const projectListResponseSchema = z.array(projectResponseSchema);

export type CreateProjectInput = z.infer<typeof createProjectInputSchema>;
export type UpdateProjectInput = z.infer<typeof updateProjectInputSchema>;
export type ProjectResponse = z.infer<typeof projectResponseSchema>;
