import { Injectable } from '@nestjs/common';
import { SignJWT, jwtVerify } from 'jose';

import { APP_CONFIG } from '../../common/config.module';
import { Inject } from '@nestjs/common';
import type { AppConfig } from '../../common/config';

const ISSUER = 'statusbeam';
const AUDIENCE = 'statusbeam-api';
export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;

@Injectable()
export class JwtService {
  private readonly secret: Uint8Array;

  public constructor(@Inject(APP_CONFIG) config: AppConfig) {
    this.secret = new TextEncoder().encode(config.jwtSecret);
  }

  public async issueAccessToken(userId: string): Promise<string> {
    return new SignJWT({ typ: 'access' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(userId)
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(`${ACCESS_TOKEN_TTL_SECONDS}s`)
      .sign(this.secret);
  }

  public async verifyAccessToken(token: string): Promise<{ userId: string }> {
    const { payload } = await jwtVerify(token, this.secret, {
      issuer: ISSUER,
      audience: AUDIENCE,
    });

    if (typeof payload.sub !== 'string' || payload.typ !== 'access') {
      throw new Error('invalid access token payload');
    }

    return { userId: payload.sub };
  }
}
