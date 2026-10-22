import { Body, Controller, Get, HttpCode, Post, Req, Res, UnauthorizedException } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { zod } from '../common/zod.pipe';
import { env } from '../config/env';
import { AuthService } from './auth.service';
import type { RequestContext } from './context';
import { Ctx, NoTenant, Public } from './decorators';
import { SessionService } from './session.service';
import { TokensService } from './tokens.service';

const COOKIE = 'sf_rt';
const COOKIE_PATH = '/api/v1/auth';

export const passwordSchema = z
  .string()
  .min(10, 'Mínimo 10 caracteres')
  .max(128)
  .regex(/[A-Za-z]/, 'Debe contener letras')
  .regex(/\d/, 'Debe contener números');

const registerSchema = z.object({ email: z.string().email().max(254), password: passwordSchema, name: z.string().trim().min(2).max(120) });
const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1).max(128), mfaCode: z.string().regex(/^\d{6}$/).optional() });
const switchSchema = z.object({ tenantId: z.string().uuid() });
const codeSchema = z.object({ code: z.string().regex(/^\d{6}$/) });
const acceptSchema = z.object({ token: z.string().min(20), name: z.string().trim().min(2).max(120).optional(), password: passwordSchema.optional() });

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
    private readonly tokens: TokensService,
  ) {}

  private setCookie(res: Response, token: string) {
    res.cookie(COOKIE, token, {
      httpOnly: true,
      secure: env().NODE_ENV === 'production',
      sameSite: 'strict',
      path: COOKIE_PATH,
      maxAge: env().JWT_REFRESH_TTL_DAYS * 86_400_000,
    });
  }

  @Public()
  @Throttle({ default: { limit: env().RATE_LIMIT_AUTH_MAX, ttl: env().RATE_LIMIT_TTL_MS } })
  @Post('register')
  async register(@Body(zod(registerSchema)) body: z.infer<typeof registerSchema>) {
    return { user: await this.auth.register(body.email, body.password, body.name) };
  }

  @Public()
  @Throttle({ default: { limit: env().RATE_LIMIT_AUTH_MAX, ttl: env().RATE_LIMIT_TTL_MS } })
  @HttpCode(200)
  @Post('login')
  async login(@Body(zod(loginSchema)) body: z.infer<typeof loginSchema>, @Res({ passthrough: true }) res: Response) {
    const { accessToken, refresh, session } = await this.auth.login(body.email, body.password, body.mfaCode);
    this.setCookie(res, refresh);
    return { accessToken, session, user: session.user, memberships: session.memberships };
  }

  @Public()
  @Throttle({ default: { limit: 30, ttl: env().RATE_LIMIT_TTL_MS } })
  @HttpCode(200)
  @Post('refresh')
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token = req.cookies?.[COOKIE];
    if (!token) throw new UnauthorizedException({ message: 'Sesión caducada', code: 'REFRESH_INVALID' });
    const { accessToken, refresh } = await this.auth.refresh(token);
    this.setCookie(res, refresh);
    return { accessToken };
  }

  @Public()
  @HttpCode(204)
  @Post('logout')
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token = req.cookies?.[COOKIE];
    if (token) await this.tokens.revoke(token);
    res.clearCookie(COOKIE, { path: COOKIE_PATH });
  }

  @ApiBearerAuth()
  @NoTenant()
  @HttpCode(200)
  @Post('switch-tenant')
  async switchTenant(@Ctx() ctx: RequestContext, @Body(zod(switchSchema)) body: z.infer<typeof switchSchema>, @Res({ passthrough: true }) res: Response) {
    const { accessToken, refresh, session } = await this.auth.switchTenant(ctx.userId, body.tenantId);
    this.setCookie(res, refresh);
    return { accessToken, session };
  }

  @ApiBearerAuth()
  @NoTenant()
  @Get('me')
  me(@Ctx() ctx: RequestContext) {
    return this.sessions.build(ctx.userId, ctx.tenantId || null, ctx.impersonationId);
  }

  @ApiBearerAuth()
  @NoTenant()
  @Post('mfa/setup')
  mfaSetup(@Ctx() ctx: RequestContext) {
    return this.auth.mfaSetup(ctx.userId);
  }

  @ApiBearerAuth()
  @NoTenant()
  @HttpCode(204)
  @Post('mfa/enable')
  async mfaEnable(@Ctx() ctx: RequestContext, @Body(zod(codeSchema)) body: z.infer<typeof codeSchema>) {
    await this.auth.mfaEnable(ctx.userId, body.code);
  }

  @ApiBearerAuth()
  @NoTenant()
  @HttpCode(204)
  @Post('mfa/disable')
  async mfaDisable(@Ctx() ctx: RequestContext, @Body(zod(codeSchema)) body: z.infer<typeof codeSchema>) {
    await this.auth.mfaDisable(ctx.userId, body.code);
  }

  /** Pública: el usuario puede no existir aún. Si hay sesión, se valida que el email coincida. */
  @Public()
  @Throttle({ default: { limit: env().RATE_LIMIT_AUTH_MAX, ttl: env().RATE_LIMIT_TTL_MS } })
  @HttpCode(200)
  @Post('invitations/accept')
  async accept(@Req() req: Request, @Body(zod(acceptSchema)) body: z.infer<typeof acceptSchema>, @Res({ passthrough: true }) res: Response) {
    const currentUserId = await this.tokens.userIdFromHeader(req.headers.authorization);
    const { accessToken, refresh, session } = await this.auth.acceptInvitation(body.token, currentUserId, body.name, body.password);
    this.setCookie(res, refresh);
    return { accessToken, session };
  }
}
