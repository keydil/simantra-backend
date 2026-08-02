import { createHash, randomBytes } from 'crypto';
import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Tenant, TenantTheme, TenantUser } from '@prisma/client';
import * as argon2 from 'argon2';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { toWireUser } from '../common/wire';
import { ChangePasswordDto, LoginDto } from './dto/auth.dto';
import { JwtPayload } from './auth.types';

/** Cooldown minimum antar pengiriman email reset untuk user yang sama —
 *  meredam email-bombing lintas IP (di luar @Throttle per-route). */
const RESET_EMAIL_COOLDOWN_MS = 60_000;

export interface RequestMeta {
  userAgent?: string;
  ip?: string;
}

type UserWithTenant = TenantUser & { tenant: (Tenant & { theme?: TenantTheme | null }) | null };

@Injectable()
export class AuthService {
  private readonly refreshTtlDays: number;
  private readonly resetTokenTtlMinutes: number;
  private readonly frontendBaseUrl: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly mail: MailService,
    config: ConfigService,
  ) {
    this.refreshTtlDays = Number(config.get('REFRESH_TTL_DAYS') ?? 7);
    this.resetTokenTtlMinutes = Number(config.get('RESET_TOKEN_TTL_MINUTES') ?? 60);
    this.frontendBaseUrl = config.get<string>('FRONTEND_BASE_URL') ?? 'http://localhost:3000';
  }

  // ── Login ────────────────────────────────────────────────────────────────
  async login(dto: LoginDto, meta: RequestMeta) {
    const user = await this.prisma.tenantUser.findUnique({
      where: { email: dto.email },
      include: { tenant: true },
    });

    // Pesan sengaja identik untuk "email tidak ada" vs "password salah"
    if (!user || !user.isActive) {
      throw new UnauthorizedException('Email atau password salah');
    }
    const passwordOk = await argon2.verify(user.passwordHash, dto.password);
    if (!passwordOk) {
      throw new UnauthorizedException('Email atau password salah');
    }
    if (user.tenant && !user.tenant.isActive) {
      throw new UnauthorizedException('Instansi tidak aktif');
    }
    if (dto.tenant_slug && user.role !== 'superadmin' && user.tenant?.subdomain !== dto.tenant_slug) {
      throw new UnauthorizedException('Akun tidak terdaftar di instansi ini');
    }

    await this.prisma.tenantUser.update({
      where: { id: user.id },
      data: { lastLogin: new Date() },
    });

    return this.issueTokens(user, meta);
  }

  // ── Refresh (rotating + reuse detection) ─────────────────────────────────
  async refresh(rawToken: string | undefined, meta: RequestMeta) {
    if (!rawToken) throw new UnauthorizedException('Refresh token tidak ditemukan');

    const row = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: this.hashToken(rawToken) },
      include: { user: { include: { tenant: true } } },
    });
    if (!row) throw new UnauthorizedException('Refresh token tidak valid');

    // Token lama yang sudah dirotasi dipakai lagi → indikasi pencurian token:
    // matikan semua sesi user tsb (standard rotation reuse detection)
    if (row.revokedAt) {
      await this.revokeAllForUser(row.userId);
      throw new UnauthorizedException('Refresh token sudah tidak berlaku');
    }
    if (row.expiresAt < new Date()) {
      throw new UnauthorizedException('Refresh token kedaluwarsa');
    }

    // Re-cek is_active user & tenant di titik refresh (L6 DESIGN.md)
    const user = row.user;
    if (!user.isActive || (user.tenant && !user.tenant.isActive)) {
      await this.revokeAllForUser(user.id);
      throw new UnauthorizedException('Akun atau instansi sudah tidak aktif');
    }

    await this.prisma.refreshToken.update({
      where: { id: row.id },
      data: { revokedAt: new Date() },
    });

    return this.issueTokens(user, meta);
  }

  // ── Logout ───────────────────────────────────────────────────────────────
  async logout(rawToken: string | undefined) {
    if (rawToken) {
      await this.prisma.refreshToken.updateMany({
        where: { tokenHash: this.hashToken(rawToken), revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
    return { success: true };
  }

  // ── Ganti password (juga meng-clear must_change_password) ────────────────
  async changePassword(userId: string, dto: ChangePasswordDto, meta: RequestMeta) {
    if (dto.old_password === dto.new_password) {
      throw new BadRequestException('Password baru tidak boleh sama dengan password lama');
    }

    const user = await this.prisma.tenantUser.findUnique({
      where: { id: userId },
      include: { tenant: true },
    });
    if (!user || !user.isActive) throw new UnauthorizedException('Akun tidak ditemukan');

    const passwordOk = await argon2.verify(user.passwordHash, dto.old_password);
    if (!passwordOk) throw new UnauthorizedException('Password lama salah');

    const updated = await this.prisma.tenantUser.update({
      where: { id: user.id },
      data: {
        passwordHash: await argon2.hash(dto.new_password),
        mustChangePassword: false,
      },
      include: { tenant: true },
    });

    // Semua sesi lain dimatikan; sesi ini dapat pasangan token baru
    await this.revokeAllForUser(user.id);
    return this.issueTokens(updated, meta);
  }

  // ── Forgot password (self-service, semua role) ────────────────────────────
  // Selalu "sukses" dari sudut pandang caller (controller balas pesan generik
  // apa pun yang terjadi di sini) — anti user-enumeration, sama seperti login().
  async forgotPassword(email: string): Promise<void> {
    const user = await this.prisma.tenantUser.findUnique({ where: { email } });
    if (!user || !user.isActive) return;

    const recent = await this.prisma.passwordResetToken.findFirst({
      where: { userId: user.id, usedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
    if (recent && Date.now() - recent.createdAt.getTime() < RESET_EMAIL_COOLDOWN_MS) {
      return;
    }

    // Token outstanding lama tidak boleh nyangkut kalau user minta reset lagi
    await this.prisma.passwordResetToken.updateMany({
      where: { userId: user.id, usedAt: null },
      data: { usedAt: new Date() },
    });

    const rawToken = randomBytes(48).toString('base64url');
    await this.prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: this.hashToken(rawToken),
        expiresAt: new Date(Date.now() + this.resetTokenTtlMinutes * 60 * 1000),
      },
    });

    const resetUrl = `${this.frontendBaseUrl}/auth/reset-password?token=${rawToken}`;
    await this.mail.sendPasswordResetEmail(user.email, resetUrl);
  }

  // ── Reset password lewat token dari email ─────────────────────────────────
  async resetPassword(rawToken: string, newPassword: string) {
    const row = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash: this.hashToken(rawToken) },
      include: { user: { include: { tenant: true } } },
    });

    const invalid = () =>
      new BadRequestException({
        statusCode: 400,
        message: 'Link reset tidak valid atau sudah kedaluwarsa',
        error: 'INVALID_RESET_TOKEN',
      });

    if (!row || row.usedAt || row.expiresAt < new Date()) {
      throw invalid();
    }

    const user = row.user;
    if (!user.isActive) {
      throw invalid();
    }

    await this.prisma.tenantUser.update({
      where: { id: user.id },
      data: {
        passwordHash: await argon2.hash(newPassword),
        mustChangePassword: false,
      },
    });
    await this.prisma.passwordResetToken.update({
      where: { id: row.id },
      data: { usedAt: new Date() },
    });
    await this.revokeAllForUser(user.id);

    const redirectTo = user.role === 'superadmin' ? '/auth/login' : `/${user.tenant?.subdomain}/login`;
    return { message: 'Password berhasil direset', redirect_to: redirectTo };
  }

  // ── Profil sendiri (pengganti fetchUserProfile auth-context.tsx) ─────────
  async me(userId: string) {
    const user = await this.prisma.tenantUser.findUnique({
      where: { id: userId },
      include: { tenant: { include: { theme: true } } },
    });
    if (!user || !user.isActive) throw new UnauthorizedException('Akun tidak ditemukan');
    return toWireUser(user);
  }

  // ── Internal ─────────────────────────────────────────────────────────────
  private async issueTokens(user: UserWithTenant, meta: RequestMeta) {
    const payload: JwtPayload = {
      sub: user.id,
      role: user.role,
      tenant_id: user.tenantId,
      tenant_slug: user.tenant?.subdomain ?? null,
      must_change_password: user.mustChangePassword,
    };
    const accessToken = this.jwt.sign(payload);

    const rawRefresh = randomBytes(48).toString('base64url');
    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: this.hashToken(rawRefresh),
        expiresAt: new Date(Date.now() + this.refreshTtlDays * 24 * 60 * 60 * 1000),
        userAgent: meta.userAgent?.slice(0, 512),
        ip: meta.ip?.slice(0, 64),
      },
    });

    return {
      access_token: accessToken,
      refresh_token: rawRefresh,
      token_type: 'Bearer',
      user: toWireUser(user),
    };
  }

  private revokeAllForUser(userId: string) {
    return this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private hashToken(raw: string) {
    return createHash('sha256').update(raw).digest('hex');
  }

  get refreshCookieMaxAgeMs() {
    return this.refreshTtlDays * 24 * 60 * 60 * 1000;
  }
}
