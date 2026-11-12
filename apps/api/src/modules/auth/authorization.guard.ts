import {
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { and, eq, isNull, lt, or, sql } from 'drizzle-orm';

import { ALLOW_API_KEY_KEY, REQUIRED_SCOPES_KEY } from '../../common/auth-principal';
import type { AuthPrincipal, AuthenticatedRequest } from '../../common/auth-principal';
import { DATABASE } from '../../db/database.module';
import type { Database } from '../../db/client';
import { apiKeys } from '../../db/schema';
import { hashApiKey } from '../api-keys/api-key.crypto';
import { JwtService } from './jwt.service';

const LAST_USED_WRITE_INTERVAL = sql`interval '1 minute'`;

@Injectable()
export class AuthorizationGuard implements CanActivate {
  public constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    @Inject(DATABASE) private readonly db: Database,
  ) {}

  public async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<
      AuthenticatedRequest & {
        headers: Record<string, string | string[] | undefined>;
        header: (name: string) => string | undefined;
      }
    >();

    const rawApiKey = request.header('x-api-key');
    if (rawApiKey) {
      const allowApiKey = this.reflector.getAllAndOverride<boolean>(ALLOW_API_KEY_KEY, [
        context.getHandler(),
        context.getClass(),
      ]);
      if (!allowApiKey) {
        throw new ForbiddenException('API keys are not accepted on this endpoint');
      }

      request.auth = await this.authenticateApiKey(rawApiKey);
      this.assertScopes(context, request.auth);
      return true;
    }

    const authorization = request.header('authorization');
    if (!authorization?.startsWith('Bearer ')) {
      throw new UnauthorizedException('missing bearer token or API key');
    }

    const token = authorization.slice('Bearer '.length).trim();
    try {
      const { userId } = await this.jwt.verifyAccessToken(token);
      request.auth = { kind: 'user', userId };
      return true;
    } catch {
      throw new UnauthorizedException('invalid or expired access token');
    }
  }

  private assertScopes(context: ExecutionContext, principal: AuthPrincipal): void {
    if (principal.kind !== 'apiKey') {
      return;
    }

    const required =
      this.reflector.getAllAndOverride<string[]>(REQUIRED_SCOPES_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? [];

    const missing = required.filter((scope) => !principal.scopes.includes(scope));
    if (missing.length > 0) {
      throw new ForbiddenException(`missing required scope: ${missing.join(', ')}`);
    }
  }

  private async authenticateApiKey(rawKey: string): Promise<AuthPrincipal> {
    const keyHash = hashApiKey(rawKey);
    const [record] = await this.db
      .select()
      .from(apiKeys)
      .where(and(eq(apiKeys.keyHash, keyHash), isNull(apiKeys.revokedAt)))
      .limit(1);

    if (!record) {
      throw new UnauthorizedException('invalid API key');
    }

    await this.db
      .update(apiKeys)
      .set({ lastUsedAt: new Date() })
      .where(
        and(
          eq(apiKeys.id, record.id),
          or(
            isNull(apiKeys.lastUsedAt),
            lt(apiKeys.lastUsedAt, sql`now() - ${LAST_USED_WRITE_INTERVAL}`),
          ),
        ),
      );

    return {
      kind: 'apiKey',
      apiKeyId: record.id,
      projectId: record.projectId,
      scopes: record.scopes,
    };
  }
}
