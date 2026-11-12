import { createHash, randomBytes } from 'node:crypto';
import { ConflictException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { Algorithm, hash, verify } from '@node-rs/argon2';
import { and, eq, isNull } from 'drizzle-orm';

import { DATABASE } from '../../db/database.module';
import type { Database } from '../../db/client';
import { refreshTokens, users } from '../../db/schema';
import type { AuthUser, LoginInput, RegisterInput } from '@statusbeam/contracts';
import { JwtService } from './jwt.service';

export const REFRESH_COOKIE_NAME = 'sb_refresh';
export const REFRESH_COOKIE_PATH = '/v1/auth';
export const REFRESH_TOKEN_TTL_DAYS = 30;

const ARGON2_OPTIONS = {
  algorithm: Algorithm.Argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  user: AuthUser;
}

function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current !== null && current !== undefined; depth += 1) {
    if (typeof current === 'object' && current !== null) {
      if ('code' in current && (current as { code?: unknown }).code === '23505') {
        return true;
      }
      if (
        'message' in current &&
        typeof (current as { message?: unknown }).message === 'string' &&
        (current as { message: string }).message.includes('duplicate key value')
      ) {
        return true;
      }
      current = (current as { cause?: unknown }).cause;
      continue;
    }
    break;
  }
  return false;
}

@Injectable()
export class AuthService {
  public constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly jwt: JwtService,
  ) {}

  public async register(input: RegisterInput): Promise<IssuedTokens> {
    const email = input.email.toLowerCase();
    const passwordHash = await hash(input.password, ARGON2_OPTIONS);

    let created: typeof users.$inferSelect;
    try {
      const rows = await this.db.insert(users).values({ email, passwordHash }).returning();
      const row = rows[0];
      if (!row) {
        throw new Error('user insert returned no row');
      }
      created = row;
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException('an account with this email already exists');
      }
      throw error;
    }

    return this.issueTokens(created.id, created.email, randomBytes(16).toString('hex'));
  }

  public async login(input: LoginInput): Promise<IssuedTokens> {
    const rows = await this.db
      .select()
      .from(users)
      .where(eq(users.email, input.email.toLowerCase()))
      .limit(1);
    const user = rows[0];

    if (!user) {
      // Run a dummy verify to keep the response time similar for unknown accounts.
      await hash(input.password, ARGON2_OPTIONS);
      throw new UnauthorizedException('invalid email or password');
    }

    const valid = await verify(user.passwordHash, input.password).catch(() => false);
    if (!valid) {
      throw new UnauthorizedException('invalid email or password');
    }

    return this.issueTokens(user.id, user.email, randomBytes(16).toString('hex'));
  }

  public async refresh(rawToken: string | undefined): Promise<IssuedTokens> {
    if (!rawToken) {
      throw new UnauthorizedException('missing refresh token');
    }

    const tokenHash = hashRefreshToken(rawToken);
    const rows = await this.db
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.tokenHash, tokenHash))
      .limit(1);
    const stored = rows[0];

    if (!stored) {
      throw new UnauthorizedException('invalid refresh token');
    }

    if (stored.revokedAt) {
      await this.revokeFamily(stored.familyId);
      throw new UnauthorizedException('refresh token reuse detected; session revoked');
    }

    if (stored.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException('refresh token expired');
    }

    const userRows = await this.db.select().from(users).where(eq(users.id, stored.userId)).limit(1);
    const user = userRows[0];
    if (!user) {
      throw new UnauthorizedException('account no longer exists');
    }

    await this.db
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(eq(refreshTokens.id, stored.id));

    return this.issueTokens(user.id, user.email, stored.familyId);
  }

  public async logout(rawToken: string | undefined): Promise<void> {
    if (!rawToken) {
      return;
    }
    await this.db
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(refreshTokens.tokenHash, hashRefreshToken(rawToken)),
          isNull(refreshTokens.revokedAt),
        ),
      );
  }

  private async issueTokens(
    userId: string,
    email: string,
    familyId: string,
  ): Promise<IssuedTokens> {
    const accessToken = await this.jwt.issueAccessToken(userId);
    const refreshToken = randomBytes(48).toString('base64url');

    await this.db.insert(refreshTokens).values({
      userId,
      familyId,
      tokenHash: hashRefreshToken(refreshToken),
      expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000),
    });

    return { accessToken, refreshToken, user: { id: userId, email } };
  }

  private async revokeFamily(familyId: string): Promise<void> {
    await this.db
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(refreshTokens.familyId, familyId), isNull(refreshTokens.revokedAt)));
  }
}

export type { IssuedTokens };
