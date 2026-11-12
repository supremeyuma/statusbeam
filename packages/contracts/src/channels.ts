import { z } from 'zod';

export const channelTypeSchema = z.enum(['webhook', 'slack', 'email']);

export const webhookChannelConfigSchema = z.object({
  url: z.string().url().max(2048),
  secret: z.string().min(8).max(256).optional(),
});

export const slackChannelConfigSchema = z.object({
  webhookUrl: z.string().url().max(2048),
});

export const emailChannelConfigSchema = z.object({
  to: z.string().email().max(254),
});

export const channelConfigSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('webhook'), config: webhookChannelConfigSchema }),
  z.object({ type: z.literal('slack'), config: slackChannelConfigSchema }),
  z.object({ type: z.literal('email'), config: emailChannelConfigSchema }),
]);

export const createChannelInputSchema = z.discriminatedUnion('type', [
  z.object({
    projectId: z.uuid(),
    type: z.literal('webhook'),
    config: webhookChannelConfigSchema,
    active: z.boolean().default(true),
  }),
  z.object({
    projectId: z.uuid(),
    type: z.literal('slack'),
    config: slackChannelConfigSchema,
    active: z.boolean().default(true),
  }),
  z.object({
    projectId: z.uuid(),
    type: z.literal('email'),
    config: emailChannelConfigSchema,
    active: z.boolean().default(true),
  }),
]);

export const updateChannelInputSchema = z
  .object({
    config: z
      .union([webhookChannelConfigSchema, slackChannelConfigSchema, emailChannelConfigSchema])
      .optional(),
    active: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'at least one field is required',
  });

export const channelResponseSchema = z.object({
  id: z.uuid(),
  projectId: z.uuid(),
  type: channelTypeSchema,
  config: z.record(z.string(), z.unknown()),
  active: z.boolean(),
  createdAt: z.string(),
});

export const channelListResponseSchema = z.array(channelResponseSchema);

export const notificationFailureSchema = z.object({
  id: z.uuid(),
  jobId: z.string(),
  channelId: z.uuid().nullable(),
  incidentUpdateId: z.uuid().nullable(),
  errorClass: z.string(),
  message: z.string(),
  attempts: z.number(),
  createdAt: z.string(),
});

export const notificationFailureListResponseSchema = z.array(notificationFailureSchema);

export type ChannelType = z.infer<typeof channelTypeSchema>;
export type WebhookChannelConfig = z.infer<typeof webhookChannelConfigSchema>;
export type SlackChannelConfig = z.infer<typeof slackChannelConfigSchema>;
export type EmailChannelConfig = z.infer<typeof emailChannelConfigSchema>;
export type CreateChannelInput = z.infer<typeof createChannelInputSchema>;
export type UpdateChannelInput = z.infer<typeof updateChannelInputSchema>;
export type ChannelResponse = z.infer<typeof channelResponseSchema>;
export type NotificationFailure = z.infer<typeof notificationFailureSchema>;
