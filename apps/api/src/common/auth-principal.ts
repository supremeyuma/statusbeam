import { createParamDecorator, SetMetadata } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';

export interface AuthUserPrincipal {
  kind: 'user';
  userId: string;
}

export interface AuthApiKeyPrincipal {
  kind: 'apiKey';
  apiKeyId: string;
  projectId: string;
  scopes: string[];
}

export type AuthPrincipal = AuthUserPrincipal | AuthApiKeyPrincipal;

export interface AuthenticatedRequest {
  auth?: AuthPrincipal;
}

export const ALLOW_API_KEY_KEY = 'statusbeam:allowApiKey';
export const REQUIRED_SCOPES_KEY = 'statusbeam:requiredScopes';

export const AllowApiKey = (): MethodDecorator & ClassDecorator =>
  SetMetadata(ALLOW_API_KEY_KEY, true);

export const RequireScopes = (...scopes: string[]): MethodDecorator & ClassDecorator =>
  SetMetadata(REQUIRED_SCOPES_KEY, scopes);

export const CurrentAuth = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthPrincipal => {
    const request = context.switchToHttp().getRequest<{ auth?: AuthPrincipal }>();
    if (!request.auth) {
      throw new Error('CurrentAuth used without AuthorizationGuard');
    }
    return request.auth;
  },
);
