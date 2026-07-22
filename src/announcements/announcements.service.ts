import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Announcement, Prisma } from '@prisma/client';
import { toWireAnnouncement, toWirePublicAnnouncement } from '../common/wire';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { CreateAnnouncementDto, UpdateAnnouncementDto } from './dto/announcements.dto';

@Injectable()
export class AnnouncementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
  ) {}

  async listAll() {
    const rows = await this.prisma.announcement.findMany({
      orderBy: [{ priority: 'desc' }, { publishedAt: 'desc' }],
    });
    return rows.map(toWireAnnouncement);
  }

  async create(dto: CreateAnnouncementDto, createdBy: string) {
    this.validateTarget(dto.target_tenants, dto.specific_tenant_ids);
    const row = await this.prisma.announcement.create({
      data: {
        title: dto.title,
        description: dto.description,
        announcementType: dto.announcement_type ?? 'update',
        targetTenants: dto.target_tenants ?? 'all',
        specificTenantIds: dto.specific_tenant_ids ?? [],
        isActive: dto.is_active ?? true,
        priority: dto.priority ?? 0,
        expiresAt: dto.expires_at ? new Date(dto.expires_at) : null,
        createdBy,
      },
    });
    await this.broadcast(row);
    return toWireAnnouncement(row);
  }

  async update(id: string, dto: UpdateAnnouncementDto) {
    const existing = await this.prisma.announcement.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Pengumuman tidak ditemukan');

    const target = dto.target_tenants ?? existing.targetTenants;
    const ids = dto.specific_tenant_ids ?? existing.specificTenantIds;
    this.validateTarget(target, ids);

    const row = await this.prisma.announcement.update({
      where: { id },
      data: {
        ...(dto.title !== undefined ? { title: dto.title } : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        ...(dto.announcement_type !== undefined ? { announcementType: dto.announcement_type } : {}),
        ...(dto.target_tenants !== undefined ? { targetTenants: dto.target_tenants } : {}),
        ...(dto.specific_tenant_ids !== undefined
          ? { specificTenantIds: dto.specific_tenant_ids }
          : {}),
        ...(dto.is_active !== undefined ? { isActive: dto.is_active } : {}),
        ...(dto.priority !== undefined ? { priority: dto.priority } : {}),
        ...(dto.expires_at !== undefined ? { expiresAt: new Date(dto.expires_at) } : {}),
      },
    });
    await this.broadcast(row);
    return toWireAnnouncement(row);
  }

  async softDelete(id: string) {
    const existing = await this.prisma.announcement.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Pengumuman tidak ditemukan');
    const row = await this.prisma.announcement.update({
      where: { id },
      data: { isActive: false },
    });
    await this.broadcast(row);
    return toWireAnnouncement(row);
  }

  /** Logika getActive(tenantId) lama: aktif, belum expired, target 'all'
   *  ATAU specific mengandung tenant, sort priority (§4.6). */
  async listActiveForTenant(tenantId: string) {
    const rows = await this.activeForTenantQuery(tenantId);
    return rows.map(toWireAnnouncement);
  }

  /** Subset publik utk display board: hanya maintenance/warning. */
  async listActiveForTenantPublic(slug: string) {
    const tenant = await this.prisma.tenant.findFirst({
      where: { subdomain: slug, isActive: true },
      select: { id: true },
    });
    if (!tenant) throw new NotFoundException('Instansi tidak ditemukan atau tidak aktif');
    const rows = await this.activeForTenantQuery(tenant.id, ['maintenance', 'warning']);
    return rows.map(toWirePublicAnnouncement);
  }

  // ── Internal ─────────────────────────────────────────────────────────────
  private activeForTenantQuery(
    tenantId: string,
    types?: ('maintenance' | 'warning')[],
  ) {
    const where: Prisma.AnnouncementWhereInput = {
      isActive: true,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      AND: [
        {
          OR: [
            { targetTenants: 'all' },
            { targetTenants: 'specific', specificTenantIds: { has: tenantId } },
          ],
        },
      ],
      ...(types ? { announcementType: { in: types } } : {}),
    };
    return this.prisma.announcement.findMany({
      where,
      orderBy: [{ priority: 'desc' }, { publishedAt: 'desc' }],
    });
  }

  private validateTarget(
    target: 'all' | 'specific' | undefined,
    ids: string[] | undefined,
  ) {
    if (target === 'specific' && (!ids || ids.length === 0)) {
      throw new BadRequestException(
        'specific_tenant_ids wajib diisi bila target_tenants = specific',
      );
    }
  }

  /** Resolve tenant target lalu pancarkan announcement.updated (§5.2). */
  private async broadcast(row: Announcement) {
    const tenants = await this.prisma.tenant.findMany({
      where: {
        isActive: true,
        ...(row.targetTenants === 'specific' ? { id: { in: row.specificTenantIds } } : {}),
      },
      select: { id: true, subdomain: true },
    });
    this.realtime.emitAnnouncementUpdated(row, tenants);
  }
}
