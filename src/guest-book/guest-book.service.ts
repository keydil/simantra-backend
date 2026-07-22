import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { toWireGuestBookEntry } from '../common/wire';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { CreateGuestBookDto, InstitutionsQueryDto, ListGuestBookQueryDto } from './dto/guest-book.dto';

@Injectable()
export class GuestBookService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  /** Submit publik — padanan guest_book_anon_insert yang sudah diperketat
   *  (script 08), plus rate limit di controller (L9). */
  async createPublic(slug: string, dto: CreateGuestBookDto) {
    const tenant = await this.getActiveTenant(slug);

    if (dto.photo_url && !this.storage.isOwnUploadUrl(dto.photo_url, 'guest-photos')) {
      throw new BadRequestException('photo_url harus berasal dari hasil upload foto buku tamu');
    }

    const entry = await this.prisma.guestBookEntry.create({
      data: {
        tenantId: tenant.id,
        name: dto.name,
        institution: dto.institution,
        purpose: dto.purpose,
        phone: dto.phone,
        photoUrl: dto.photo_url ?? null,
      },
    });
    return toWireGuestBookEntry(entry);
  }

  async uploadPhoto(slug: string, buffer: Buffer, mime: string) {
    await this.getActiveTenant(slug);
    const { url } = await this.storage.saveImage(buffer, mime, 'guest-photos');
    return { photo_url: url };
  }

  /** Autocomplete institusi (dipakai guest-book-form.tsx) — hanya nama,
   *  tidak pernah data pengunjung lain. */
  async listInstitutions(slug: string, query: InstitutionsQueryDto) {
    const tenant = await this.getActiveTenant(slug);
    const rows = await this.prisma.guestBookEntry.findMany({
      where: {
        tenantId: tenant.id,
        ...(query.search
          ? { institution: { contains: query.search, mode: Prisma.QueryMode.insensitive } }
          : {}),
      },
      select: { institution: true },
      distinct: ['institution'],
      orderBy: { institution: 'asc' },
      take: 10,
    });
    return rows.map((r) => r.institution);
  }

  /** Halaman admin buku tamu — filter + pagination + count. */
  async listByTenant(tenantId: string, query: ListGuestBookQueryDto) {
    const limit = query.limit ?? 20;
    const page = query.page ?? 1;
    const where: Prisma.GuestBookEntryWhereInput = {
      tenantId,
      ...(query.from || query.to
        ? {
            createdAt: {
              ...(query.from ? { gte: new Date(query.from) } : {}),
              ...(query.to ? { lte: new Date(query.to) } : {}),
            },
          }
        : {}),
      ...(query.purpose ? { purpose: query.purpose } : {}),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: Prisma.QueryMode.insensitive } },
              { institution: { contains: query.search, mode: Prisma.QueryMode.insensitive } },
            ],
          }
        : {}),
    };

    const [rows, count] = await this.prisma.$transaction([
      this.prisma.guestBookEntry.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.guestBookEntry.count({ where }),
    ]);

    return { data: rows.map(toWireGuestBookEntry), count, page, limit };
  }

  // ── Internal ─────────────────────────────────────────────────────────────
  private async getActiveTenant(slug: string) {
    const tenant = await this.prisma.tenant.findFirst({
      where: { subdomain: slug, isActive: true },
      select: { id: true },
    });
    if (!tenant) throw new NotFoundException('Instansi tidak ditemukan atau tidak aktif');
    return tenant;
  }
}
