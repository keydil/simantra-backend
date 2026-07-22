import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { AllowMustChangePassword } from '../common/decorators/allow-must-change-password.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Public } from '../common/decorators/public.decorator';
import { AuthService, RequestMeta } from './auth.service';
import { AuthUser } from './auth.types';
import { ChangePasswordDto, LoginDto, RefreshDto } from './dto/auth.dto';

export const REFRESH_COOKIE = 'simantra_refresh';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @Post('login')
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.auth.login(dto, this.meta(req));
    this.setRefreshCookie(res, result.refresh_token);
    return result;
  }

  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @HttpCode(HttpStatus.OK)
  @Post('refresh')
  async refresh(
    @Body() dto: RefreshDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const raw = dto.refresh_token ?? req.cookies?.[REFRESH_COOKIE];
    const result = await this.auth.refresh(raw, this.meta(req));
    this.setRefreshCookie(res, result.refresh_token);
    return result;
  }

  // Public: pemegang refresh token berhak me-revoke-nya sendiri, termasuk
  // saat access token sudah kedaluwarsa
  @Public()
  @HttpCode(HttpStatus.OK)
  @Post('logout')
  async logout(
    @Body() dto: RefreshDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const raw = dto.refresh_token ?? req.cookies?.[REFRESH_COOKIE];
    res.clearCookie(REFRESH_COOKIE, { path: '/api/v1/auth' });
    return this.auth.logout(raw);
  }

  @AllowMustChangePassword()
  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return this.auth.me(user.id);
  }

  @AllowMustChangePassword()
  @HttpCode(HttpStatus.OK)
  @Post('change-password')
  async changePassword(
    @CurrentUser() user: AuthUser,
    @Body() dto: ChangePasswordDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.auth.changePassword(user.id, dto, this.meta(req));
    this.setRefreshCookie(res, result.refresh_token);
    return result;
  }

  private setRefreshCookie(res: Response, token: string) {
    res.cookie(REFRESH_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/api/v1/auth',
      maxAge: this.auth.refreshCookieMaxAgeMs,
    });
  }

  private meta(req: Request): RequestMeta {
    return { userAgent: req.headers['user-agent'], ip: req.ip };
  }
}
