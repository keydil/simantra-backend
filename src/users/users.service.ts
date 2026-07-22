import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, TenantUser } from '@prisma/client';
import * as argon2 from 'argon2';
import { AuthUser } from '../auth/auth.types';
import { toWireUser } from '../common/wire';
import { PrismaService } from '../prisma/prisma.service';
import { CreateUserDto, ListUsersQueryDto, ResetPasswordDto, UpdateUserDto } from './dto/users.dto';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async listByTenant(tenantId: string, query: ListUsersQueryDto) {
    const users = await this.prisma.tenantUser.findMany({
      where: {
        tenantId,
        ...(query.is_active !== undefined ? { isActive: query.is_active === 'true' } : {}),
        ...(query.role ? { role: query.role } : {}),
      },
      orderBy: { createdAt: 'desc' },
    });
    return users.map(toWireUser);
  }

  async listSuperadmins() {
    const users = await this.prisma.tenantUser.findMany({
      where: { role: 'superadmin' },
      orderBy: { createdAt: 'desc' },
    });
    return users.map(toWireUser);
  }

  /**
   * Fix permanen ghost account (UI_UX 3.3 / §2.3 DESIGN.md): credential +
   * profil = satu baris satu insert, tidak ada dua sistem yang bisa drift.
   * Aturan role/tenant diporting dari app/api/admin/create-tenant-user/route.ts.
   */
  async create(dto: CreateUserDto, caller: AuthUser) {
    let tenantId: string | null;

    if (caller.role === 'superadmin') {
      tenantId = dto.role === 'superadmin' ? null : (dto.tenant_id ?? null);
      if (dto.role !== 'superadmin' && !tenantId) {
        throw new BadRequestException('tenant_id wajib diisi untuk role selain superadmin');
      }
    } else {
      // caller admin — tenant DIPAKSA tenant sendiri, role dibatasi
      if (dto.role !== 'admin' && dto.role !== 'operator') {
        throw new ForbiddenException('Admin hanya boleh membuat akun dengan role admin atau operator');
      }
      if (!caller.tenantId) {
        throw new ForbiddenException('Akun admin tidak terikat instansi manapun');
      }
      tenantId = caller.tenantId;
    }

    if (tenantId) {
      const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
      if (!tenant || !tenant.isActive) {
        throw new BadRequestException('Instansi tidak ditemukan atau tidak aktif');
      }
    }

    try {
      const user = await this.prisma.tenantUser.create({
        data: {
          tenantId,
          email: dto.email,
          passwordHash: await argon2.hash(dto.password),
          fullName: dto.full_name ?? null,
          role: dto.role,
          isActive: true,
          mustChangePassword: true,
        },
      });
      return toWireUser(user);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('Email sudah terdaftar');
      }
      throw e;
    }
  }

  async update(id: string, dto: UpdateUserDto, caller: AuthUser) {
    const target = await this.getTargetForWrite(id, caller);

    if (dto.role === 'superadmin' && caller.role !== 'superadmin') {
      throw new ForbiddenException('Hanya superadmin yang boleh memberikan role superadmin');
    }
    if (dto.is_active === false && target.id === caller.id) {
      throw new ForbiddenException('Tidak bisa menonaktifkan akun sendiri');
    }

    const updated = await this.prisma.tenantUser.update({
      where: { id: target.id },
      data: {
        ...(dto.full_name !== undefined ? { fullName: dto.full_name } : {}),
        ...(dto.role !== undefined ? { role: dto.role } : {}),
        ...(dto.is_active !== undefined ? { isActive: dto.is_active } : {}),
      },
    });

    // Deaktivasi berlaku instan, bukan menunggu access token kedaluwarsa (L6)
    if (dto.is_active === false) {
      await this.revokeAllForUser(target.id);
    }
    return toWireUser(updated);
  }

  /** Jalur resmi pengganti insiden "reset password superadmin via SQL"
   *  (script 12 project lama). */
  async resetPassword(id: string, dto: ResetPasswordDto, caller: AuthUser) {
    const target = await this.getTargetForWrite(id, caller);

    const updated = await this.prisma.tenantUser.update({
      where: { id: target.id },
      data: {
        passwordHash: await argon2.hash(dto.new_password),
        mustChangePassword: true,
      },
    });
    await this.revokeAllForUser(target.id);
    return toWireUser(updated);
  }

  async softDelete(id: string, caller: AuthUser) {
    const target = await this.getTargetForWrite(id, caller);
    if (target.id === caller.id) {
      throw new ForbiddenException('Tidak bisa menonaktifkan akun sendiri');
    }
    const updated = await this.prisma.tenantUser.update({
      where: { id: target.id },
      data: { isActive: false },
    });
    await this.revokeAllForUser(target.id);
    return toWireUser(updated);
  }

  // ── Internal ─────────────────────────────────────────────────────────────
  private async getTargetForWrite(id: string, caller: AuthUser): Promise<TenantUser> {
    const target = await this.prisma.tenantUser.findUnique({ where: { id } });
    if (!target) throw new NotFoundException('Pengguna tidak ditemukan');

    if (caller.role !== 'superadmin') {
      // admin: hanya user non-superadmin di tenant sendiri
      if (target.role === 'superadmin' || target.tenantId !== caller.tenantId) {
        throw new ForbiddenException('Tidak punya akses ke pengguna ini');
      }
    }
    return target;
  }

  private revokeAllForUser(userId: string) {
    return this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}
