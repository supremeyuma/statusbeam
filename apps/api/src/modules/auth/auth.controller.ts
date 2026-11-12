import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBody, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { z } from 'zod';

import { requestSchema, responseSchema } from '../../common/openapi-schema';
import type { Request, Response } from 'express';

import { authResponseSchema, loginInputSchema, registerInputSchema } from '@statusbeam/contracts';
import { APP_CONFIG } from '../../common/config.module';
import type { AppConfig } from '../../common/config';
import { ZodValidationPipe } from '../../common/zod-validation.pipe';
import {
  AuthService,
  REFRESH_COOKIE_NAME,
  REFRESH_COOKIE_PATH,
  REFRESH_TOKEN_TTL_DAYS,
} from './auth.service';

type CookieRequest = Request & { cookies?: unknown };

function readRefreshCookie(req: CookieRequest): string | undefined {
  if (typeof req.cookies !== 'object' || req.cookies === null) {
    return undefined;
  }
  const value = (req.cookies as Record<string, unknown>)[REFRESH_COOKIE_NAME];
  return typeof value === 'string' ? value : undefined;
}

const registerBody = requestSchema(registerInputSchema);
const loginBody = requestSchema(loginInputSchema);
const authResponse = responseSchema(authResponseSchema);

@ApiTags('auth')
@Controller('v1/auth')
export class AuthController {
  public constructor(
    private readonly auth: AuthService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  @Post('register')
  @ApiBody({ schema: registerBody })
  @ApiCreatedResponse({ schema: authResponse })
  public async register(
    @Body(new ZodValidationPipe(registerInputSchema)) input: z.infer<typeof registerInputSchema>,
    @Res({ passthrough: true }) res: Response,
  ): Promise<z.infer<typeof authResponseSchema>> {
    const tokens = await this.auth.register(input);
    this.setRefreshCookie(res, tokens.refreshToken);
    return { accessToken: tokens.accessToken, user: tokens.user };
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ThrottlerGuard)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiBody({ schema: loginBody })
  @ApiOkResponse({ schema: authResponse })
  public async login(
    @Body(new ZodValidationPipe(loginInputSchema)) input: z.infer<typeof loginInputSchema>,
    @Res({ passthrough: true }) res: Response,
  ): Promise<z.infer<typeof authResponseSchema>> {
    const tokens = await this.auth.login(input);
    this.setRefreshCookie(res, tokens.refreshToken);
    return { accessToken: tokens.accessToken, user: tokens.user };
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOkResponse({ schema: authResponse })
  public async refresh(
    @Req() req: CookieRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<z.infer<typeof authResponseSchema>> {
    const tokens = await this.auth.refresh(readRefreshCookie(req));
    this.setRefreshCookie(res, tokens.refreshToken);
    return { accessToken: tokens.accessToken, user: tokens.user };
  }

  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  public async logout(
    @Req() req: CookieRequest,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.auth.logout(readRefreshCookie(req));
    res.clearCookie(REFRESH_COOKIE_NAME, {
      path: REFRESH_COOKIE_PATH,
      sameSite: 'strict',
      secure: this.config.isProduction,
    });
  }

  private setRefreshCookie(res: Response, token: string): void {
    res.cookie(REFRESH_COOKIE_NAME, token, {
      httpOnly: true,
      secure: this.config.isProduction,
      sameSite: 'strict',
      path: REFRESH_COOKIE_PATH,
      maxAge: REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
    });
  }
}
