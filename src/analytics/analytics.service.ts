import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { AuthUser } from '../auth/auth.types';
import { toWireAnalytics } from '../common/wire';
import { PrismaService } from '../prisma/prisma.service';
import { AnalyticsRangeQueryDto, QueueAnalyticsQueryDto } from './dto/analytics.dto';

@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Padanan analyticsQueries.getByTenantAndDate. */
  async listByTenant(tenantId: string, query: AnalyticsRangeQueryDto) {
    const rows = await this.prisma.analyticsDaily.findMany({
      where: {
        tenantId,
        ...(query.from || query.to
          ? {
              date: {
                ...(query.from ? { gte: new Date(query.from) } : {}),
                ...(query.to ? { lte: new Date(query.to) } : {}),
              },
            }
          : {}),
      },
      orderBy: { date: 'desc' },
    });
    return rows.map(toWireAnalytics);
  }

  /** Padanan analyticsQueries.getQueueAnalytics. */
  async listByQueue(queueId: string, query: QueueAnalyticsQueryDto, caller: AuthUser) {
    const queue = await this.prisma.queue.findUnique({ where: { id: queueId } });
    if (!queue) throw new NotFoundException('Layanan tidak ditemukan');
    if (caller.role !== 'superadmin' && queue.tenantId !== caller.tenantId) {
      throw new ForbiddenException('Tidak punya akses ke layanan ini');
    }

    const days = query.days ?? 30;
    const start = new Date();
    start.setDate(start.getDate() - days);

    const rows = await this.prisma.analyticsDaily.findMany({
      where: { queueId, date: { gte: start } },
      orderBy: { date: 'asc' },
    });
    return rows.map(toWireAnalytics);
  }

  /** Cron 00:15 tiap hari — agregasi kemarin. Di Supabase tidak pernah ada
   *  pengisi analytics_daily yang ter-version-control; sekarang jadi kode
   *  repo (L8, §4.7). */
  @Cron('15 0 * * *')
  async aggregateYesterday() {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const n = await this.aggregateForDate(yesterday);
    this.logger.log(`Agregasi analytics harian selesai: ${n} baris di-upsert`);
  }

  /**
   * Backfill rentang hari (inklusif), hari per hari. Dipakai tombol "Perbarui
   * data analitik" — cron cuma mengisi kemarin, jadi data historis dan
   * environment yang cron-nya belum pernah nyala tidak akan pernah terisi
   * tanpa ini. Idempoten (setiap hari lewat aggregateForDate yang upsert).
   */
  async aggregateRange(fromDate: Date, toDate: Date): Promise<{ days: number; upserted: number }> {
    const cursor = new Date(fromDate);
    cursor.setHours(0, 0, 0, 0);
    const end = new Date(toDate);
    end.setHours(0, 0, 0, 0);

    let days = 0;
    let upserted = 0;
    // Cap keras: DTO sudah membatasi ≤366, tapi ini jaring pengaman kalau
    // dipanggil langsung dari kode dengan rentang keliru.
    const MAX_DAYS = 366;
    while (cursor <= end && days < MAX_DAYS) {
      upserted += await this.aggregateForDate(new Date(cursor));
      days += 1;
      cursor.setDate(cursor.getDate() + 1);
    }
    return { days, upserted };
  }

  /** Upsert analytics_daily per tenant×queue utk satu tanggal (idempoten —
   *  aman dijalankan ulang). */
  async aggregateForDate(date: Date): Promise<number> {
    const dayStart = new Date(date);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);
    // Label kolom `date` dihitung dari tanggal LOKAL sebagai string — kalau
    // pakai ${dayStart}::date, Postgres meng-cast timestamp UTC-nya dan label
    // bergeser ke kemarin untuk timezone timur (mis. WIB).
    const pad = (n: number) => String(n).padStart(2, '0');
    const dateLabel = `${dayStart.getFullYear()}-${pad(dayStart.getMonth() + 1)}-${pad(dayStart.getDate())}`;

    const affected = await this.prisma.$executeRaw`
      WITH day_entries AS (
        SELECT * FROM queue_entries
        WHERE entered_at >= ${dayStart} AND entered_at < ${dayEnd}
      ), base AS (
        SELECT tenant_id, queue_id,
          count(*)::int AS total,
          (count(*) FILTER (WHERE status = 'completed'))::int AS completed,
          (count(*) FILTER (WHERE status = 'no_show'))::int  AS no_show,
          (count(*) FILTER (WHERE status = 'cancelled'))::int AS cancelled,
          avg(EXTRACT(EPOCH FROM (completed_at - started_at)) / 60.0)
            FILTER (WHERE status = 'completed' AND started_at IS NOT NULL AND completed_at IS NOT NULL)
            AS avg_minutes
        FROM day_entries
        GROUP BY tenant_id, queue_id
      ), hours AS (
        SELECT tenant_id, queue_id,
          EXTRACT(HOUR FROM entered_at)::int AS hr,
          count(*)::int AS n,
          ROW_NUMBER() OVER (
            PARTITION BY tenant_id, queue_id
            ORDER BY count(*) DESC, EXTRACT(HOUR FROM entered_at) ASC
          ) AS rn
        FROM day_entries
        GROUP BY tenant_id, queue_id, EXTRACT(HOUR FROM entered_at)
      )
      INSERT INTO analytics_daily
        (tenant_id, queue_id, date, total_entries, completed_entries,
         no_show_entries, cancelled_entries, average_service_time_minutes,
         peak_hour, peak_count)
      SELECT b.tenant_id, b.queue_id, ${dateLabel}::date, b.total, b.completed,
             b.no_show, b.cancelled, round(b.avg_minutes::numeric, 2),
             h.hr, h.n
      FROM base b
      LEFT JOIN hours h
        ON h.tenant_id = b.tenant_id AND h.queue_id = b.queue_id AND h.rn = 1
      ON CONFLICT (tenant_id, queue_id, date) DO UPDATE SET
        total_entries = EXCLUDED.total_entries,
        completed_entries = EXCLUDED.completed_entries,
        no_show_entries = EXCLUDED.no_show_entries,
        cancelled_entries = EXCLUDED.cancelled_entries,
        average_service_time_minutes = EXCLUDED.average_service_time_minutes,
        peak_hour = EXCLUDED.peak_hour,
        peak_count = EXCLUDED.peak_count`;
    return affected;
  }
}
