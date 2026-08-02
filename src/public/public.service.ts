import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { QueueEntryStatus } from '@prisma/client';
import { toWireEntry, toWirePublicEntry, toWireQueue, toWireTenant } from '../common/wire';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeService } from '../realtime/realtime.service';
import { CreatePublicEntryDto, PublicEntriesQueryDto } from './dto/public.dto';

/**
 * Port 1:1 dari 7 RPC SECURITY DEFINER Supabase (script 05a/06/10) — kontrak
 * yang sama: scoping eksplisit wajib (slug atau UUID capability), filter di
 * WHERE = enforcement (L1), tidak ketemu = 404 (L4, menghapus bug "1 row
 * semua NULL"), kolom sensitif di-hardcode server (L2), penomoran tiket
 * dalam transaksi ber-lock (L3).
 */
@Injectable()
export class PublicService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
  ) {}

  /** RPC get_public_tenant — branding + theme utk kiosk & middleware. */
  async getTenant(slug: string) {
    const tenant = await this.prisma.tenant.findFirst({
      where: { subdomain: slug, isActive: true },
      include: { theme: true },
    });
    if (!tenant) throw new NotFoundException('Instansi tidak ditemukan atau tidak aktif');
    return toWireTenant(tenant);
  }

  /** RPC get_public_queues. */
  async getQueues(slug: string) {
    await this.assertTenantActive(slug);
    const queues = await this.prisma.queue.findMany({
      where: { isActive: true, tenant: { subdomain: slug, isActive: true } },
      orderBy: { serviceCode: 'asc' },
    });
    return queues.map(toWireQueue);
  }

  /**
   * RPC get_public_queue_entries — DTO publik TANPA customer_name/notes.
   *
   * DIBATASI HARI INI. Dulu tanpa batas tanggal sama sekali, padahal urutannya
   * `enteredAt asc` (terlama dulu) dengan cap 500 — begitu satu instansi
   * mengumpulkan >500 entri seumur hidup, 500 slot habis diisi entri `completed`
   * berbulan-bulan lalu dan tiket yang SEDANG dilayani hari ini terpotong,
   * membuat papan display tampak kosong ("0 menunggu", loket "---") walau
   * antreannya jalan. Batas hari ini juga menutup masalah kedua: entri `waiting`
   * terlantar dari hari-hari sebelumnya (tak pernah dipanggil atau dibatalkan)
   * ikut tampil sebagai tiket hantu. take 500 tetap ada sebagai pengaman, tapi
   * sekarang per-hari — jauh di atas volume harian yang wajar.
   */
  async getEntries(slug: string, query: PublicEntriesQueryDto) {
    await this.assertTenantActive(slug);
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const entries = await this.prisma.queueEntry.findMany({
      where: {
        tenant: { subdomain: slug, isActive: true },
        status: { in: this.parseStatuses(query.status) },
        enteredAt: { gte: todayStart },
      },
      orderBy: { enteredAt: 'asc' },
      take: 500,
    });
    return entries.map(toWirePublicEntry);
  }

  /** RPC get_public_queue_entry — UUID tiket = capability pemegangnya,
   *  jadi boleh bentuk penuh (termasuk customer_name miliknya sendiri). */
  async getEntry(id: string) {
    const entry = await this.prisma.queueEntry.findFirst({
      where: { id, tenant: { isActive: true } },
    });
    if (!entry) throw new NotFoundException('Tiket tidak ditemukan');
    return toWireEntry(entry);
  }

  /** RPC count_public_queue_position_ahead + estimasi waktu tunggu. */
  async getPosition(id: string) {
    const entry = await this.prisma.queueEntry.findFirst({
      where: { id, tenant: { isActive: true } },
      select: { queueId: true, enteredAt: true },
    });
    if (!entry) throw new NotFoundException('Tiket tidak ditemukan');
    const ahead = await this.prisma.queueEntry.count({
      where: {
        queueId: entry.queueId,
        status: 'waiting',
        enteredAt: { lt: entry.enteredAt },
      },
    });
    return {
      ahead,
      estimated_wait_minutes: await this.estimateWaitMinutes(entry.queueId, ahead),
    };
  }

  /** RPC get_public_queue. */
  async getQueue(id: string) {
    const queue = await this.prisma.queue.findFirst({
      where: { id, tenant: { isActive: true } },
    });
    if (!queue) throw new NotFoundException('Layanan tidak ditemukan');
    return toWireQueue(queue);
  }

  /**
   * RPC create_public_queue_entry (script 06) — transaksi + row lock FOR
   * UPDATE pada queues supaya penomoran tiket serial per-layanan (L3).
   * status/priority/entered_at di-hardcode server (L2).
   */
  async createEntry(slug: string, queueId: string, dto: CreatePublicEntryDto) {
    const { entry, tenant } = await this.prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.findFirst({
        where: { subdomain: slug, isActive: true },
      });
      if (!tenant) throw new NotFoundException('Instansi tidak ditemukan atau tidak aktif');

      // Lock baris queue — permintaan tiket bersamaan utk layanan yang sama
      // antre di sini, tidak bisa race di count di bawah
      const queues = await tx.$queryRaw<{ id: string; service_code: string | null }[]>`
        SELECT id, service_code FROM queues
        WHERE id = ${queueId}::uuid AND tenant_id = ${tenant.id}::uuid AND is_active = true
        FOR UPDATE`;
      if (queues.length === 0) {
        throw new NotFoundException('Layanan tidak ditemukan atau tidak aktif');
      }

      const counts = await tx.$queryRaw<{ n: number }[]>`
        SELECT count(*)::int AS n FROM queue_entries
        WHERE queue_id = ${queueId}::uuid AND entered_at >= date_trunc('day', now())`;
      const ticketNumber =
        (queues[0].service_code ?? 'A') + String(counts[0].n + 1).padStart(3, '0');

      const entry = await tx.queueEntry.create({
        data: {
          queueId,
          tenantId: tenant.id,
          ticketNumber,
          status: 'waiting',
          priority: 0,
          customerName: dto.customer_name?.trim() || null,
        },
      });
      return { entry, tenant };
    });

    // emit SETELAH commit
    this.realtime.emitEntryCreated(tenant, entry);
    return toWireEntry(entry);
  }

  // ── Internal ─────────────────────────────────────────────────────────────
  /**
   * Estimasi = jumlah antrean di depan × rata-rata waktu layanan NYATA layanan
   * ini (analytics_daily 14 hari terakhir, tertimbang jumlah entry selesai) —
   * bukan queues.estimated_service_time_minutes yang cuma angka config manual
   * admin. Null = belum ada histori sama sekali (tenant/layanan baru); frontend
   * menampilkan "Estimasi belum tersedia", JANGAN diam-diam jatuh ke angka
   * config supaya tidak menyajikan tebakan sebagai data.
   *
   * Asumsi 1 loket serial — jumlah loket paralel belum diperhitungkan.
   */
  private async estimateWaitMinutes(queueId: string, ahead: number): Promise<number | null> {
    if (ahead === 0) return 0;

    const since = new Date();
    since.setDate(since.getDate() - 14);
    const rows = await this.prisma.analyticsDaily.findMany({
      where: {
        queueId,
        date: { gte: since },
        averageServiceTimeMinutes: { not: null },
        completedEntries: { gt: 0 },
      },
      select: { averageServiceTimeMinutes: true, completedEntries: true },
    });
    if (rows.length === 0) return null;

    let sum = 0;
    let weight = 0;
    for (const r of rows) {
      sum += Number(r.averageServiceTimeMinutes) * r.completedEntries;
      weight += r.completedEntries;
    }
    return weight > 0 ? Math.round(ahead * (sum / weight)) : null;
  }

  private async assertTenantActive(slug: string) {
    const tenant = await this.prisma.tenant.findFirst({
      where: { subdomain: slug, isActive: true },
      select: { id: true },
    });
    if (!tenant) throw new NotFoundException('Instansi tidak ditemukan atau tidak aktif');
  }

  private parseStatuses(csv: string | undefined): QueueEntryStatus[] {
    const valid: QueueEntryStatus[] = ['waiting', 'serving', 'completed', 'no_show', 'cancelled'];
    if (!csv) return ['waiting', 'serving'];
    const parsed = csv
      .split(',')
      .map((s) => s.trim())
      .filter((s): s is QueueEntryStatus => (valid as string[]).includes(s));
    if (parsed.length === 0) throw new BadRequestException(`Parameter status tidak valid: ${csv}`);
    return parsed;
  }
}
