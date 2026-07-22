import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, QueueEntry, QueueEntryStatus } from '@prisma/client';
import { AuthUser } from '../auth/auth.types';
import { toWireEntry } from '../common/wire';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { CallNextDto, ListEntriesQueryDto, UpdateEntryDto, UpdateEntryStatusDto } from './dto/queue-entries.dto';

/** State machine transisi status (§3.2 DESIGN.md) — timestamp SELALU server. */
const ALLOWED_TRANSITIONS: Record<QueueEntryStatus, QueueEntryStatus[]> = {
  waiting: ['serving', 'cancelled'],
  serving: ['completed', 'no_show', 'cancelled'],
  completed: [],
  no_show: [],
  cancelled: [],
};

const DEFAULT_STATUSES: QueueEntryStatus[] = ['waiting', 'serving'];

@Injectable()
export class QueueEntriesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
  ) {}

  async listByTenant(tenantId: string, query: ListEntriesQueryDto) {
    const statuses = this.parseStatuses(query.status);
    const entries = await this.prisma.queueEntry.findMany({
      where: {
        tenantId,
        status: { in: statuses },
        ...(query.queue_id ? { queueId: query.queue_id } : {}),
        ...(query.since ? { enteredAt: { gte: new Date(query.since) } } : {}),
      },
      orderBy: { enteredAt: 'asc' },
      take: query.limit ?? 100,
    });
    return entries.map(toWireEntry);
  }

  /** View queue_status_summary (dipakai getStatusSummary lama). */
  async summary(tenantId: string) {
    return this.prisma.$queryRaw`
      SELECT queue_id, tenant_id, queue_name,
             total_in_queue::int    AS total_in_queue,
             currently_serving::int AS currently_serving,
             waiting_count::int     AS waiting_count,
             latest_entry_time
      FROM queue_status_summary
      WHERE tenant_id = ${tenantId}::uuid`;
  }

  /** 4 count paralel operator-panel lama jadi 1 call (§4.5). */
  async statsToday(queueId: string, caller: AuthUser) {
    await this.getQueueScoped(queueId, caller);
    const rows = await this.prisma.$queryRaw<{ status: QueueEntryStatus; n: number }[]>`
      SELECT status, count(*)::int AS n
      FROM queue_entries
      WHERE queue_id = ${queueId}::uuid AND entered_at >= date_trunc('day', now())
      GROUP BY status`;
    const stats = { waiting: 0, serving: 0, completed: 0, no_show: 0, cancelled: 0 };
    for (const r of rows) stats[r.status] = r.n;
    return stats;
  }

  /**
   * Panggil antrian berikutnya — ATOMIK: `FOR UPDATE SKIP LOCKED` supaya dua
   * operator yang menekan "panggil" bersamaan tidak mendapat tiket yang sama
   * (menutup race pilih-lalu-update di operator-panel lama, §4.5).
   */
  async callNext(queueId: string, dto: CallNextDto, caller: AuthUser) {
    const { entry, queue, tenant } = await this.prisma.$transaction(async (tx) => {
      const queue = await tx.queue.findUnique({
        where: { id: queueId },
        include: { tenant: true },
      });
      if (!queue) throw new NotFoundException('Layanan tidak ditemukan');
      this.assertTenantScope(queue.tenantId, caller);

      const candidates = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM queue_entries
        WHERE queue_id = ${queueId}::uuid AND status = 'waiting'
        ORDER BY priority DESC, entered_at ASC
        LIMIT 1
        FOR UPDATE SKIP LOCKED`;
      if (candidates.length === 0) {
        throw new NotFoundException('Tidak ada antrian yang menunggu');
      }

      const entry = await tx.queueEntry.update({
        where: { id: candidates[0].id },
        data: {
          status: 'serving',
          startedAt: new Date(),
          ...(dto.service_window !== undefined ? { serviceWindow: dto.service_window } : {}),
        },
      });
      return { entry, queue, tenant: queue.tenant };
    });

    // emit SETELAH commit (§5.2)
    this.realtime.emitEntryCalled(tenant, entry, queue);
    return toWireEntry(entry);
  }

  async updateStatus(id: string, dto: UpdateEntryStatusDto, caller: AuthUser) {
    const existing = await this.getEntryScoped(id, caller);

    if (!ALLOWED_TRANSITIONS[existing.status].includes(dto.status)) {
      throw new BadRequestException(
        `Transisi status ${existing.status} → ${dto.status} tidak diizinkan`,
      );
    }

    const data: Prisma.QueueEntryUpdateInput = { status: dto.status };
    if (dto.status === 'serving') data.startedAt = new Date();
    if (dto.status === 'completed') data.completedAt = new Date();

    const updated = await this.prisma.queueEntry.update({
      where: { id },
      data,
      include: { queue: true, tenant: true },
    });

    if (dto.status === 'serving') {
      this.realtime.emitEntryCalled(updated.tenant, updated, updated.queue);
    } else {
      this.realtime.emitEntryUpdated(updated.tenant, updated);
    }
    return toWireEntry(updated);
  }

  async update(id: string, dto: UpdateEntryDto, caller: AuthUser) {
    await this.getEntryScoped(id, caller);
    const updated = await this.prisma.queueEntry.update({
      where: { id },
      data: {
        ...(dto.notes !== undefined ? { notes: dto.notes } : {}),
        ...(dto.customer_name !== undefined ? { customerName: dto.customer_name } : {}),
        ...(dto.service_window !== undefined ? { serviceWindow: dto.service_window } : {}),
      },
      include: { tenant: true },
    });
    this.realtime.emitEntryUpdated(updated.tenant, updated);
    return toWireEntry(updated);
  }

  // ── Internal ─────────────────────────────────────────────────────────────
  private parseStatuses(csv: string | undefined): QueueEntryStatus[] {
    if (!csv) return DEFAULT_STATUSES;
    const valid = Object.keys(ALLOWED_TRANSITIONS) as QueueEntryStatus[];
    const parsed = csv
      .split(',')
      .map((s) => s.trim())
      .filter((s): s is QueueEntryStatus => (valid as string[]).includes(s));
    if (parsed.length === 0) {
      throw new BadRequestException(`Parameter status tidak valid: ${csv}`);
    }
    return parsed;
  }

  private assertTenantScope(tenantId: string, caller: AuthUser) {
    if (caller.role !== 'superadmin' && tenantId !== caller.tenantId) {
      throw new ForbiddenException('Tidak punya akses ke tenant ini');
    }
  }

  private async getEntryScoped(id: string, caller: AuthUser): Promise<QueueEntry> {
    const entry = await this.prisma.queueEntry.findUnique({ where: { id } });
    if (!entry) throw new NotFoundException('Tiket tidak ditemukan');
    this.assertTenantScope(entry.tenantId, caller);
    return entry;
  }

  private async getQueueScoped(id: string, caller: AuthUser) {
    const queue = await this.prisma.queue.findUnique({ where: { id } });
    if (!queue) throw new NotFoundException('Layanan tidak ditemukan');
    this.assertTenantScope(queue.tenantId, caller);
    return queue;
  }
}
