// Seed data DEMO — bukan identitas (itu tugas prisma/seed.ts). Script ini
// mengisi queue_entries + analytics_daily supaya dashboard analitik (tren,
// jam sibuk, perbandingan status, perbandingan lintas-instansi) punya bentuk
// yang representatif utk testing/demo, bukan flat/kosong.
//
// Idempoten: menghapus dulu queue_entries & analytics_daily milik 3 tenant
// demo di bawah untuk rentang tanggal yang di-seed, baru menulis ulang —
// aman dijalankan berkali-kali, TIDAK menyentuh tenant/tanggal lain.
//
// Jalankan: npm run seed:demo   (butuh prisma/seed.ts sudah pernah jalan
// dulu utk tenant "dinkes", tapi script ini tetap upsert sendiri kalau belum)
import { PrismaClient, Prisma, QueueEntryStatus } from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();

const DAYS_BACK = 13; // 14 hari termasuk hari ini
const BUSINESS_HOURS = [8, 9, 10, 11, 12, 13, 14, 15];

type Tier = 'high' | 'medium' | 'low';
const TIER_RANGE: Record<Tier, [number, number]> = {
  high: [15, 30],
  medium: [8, 18],
  low: [3, 10],
};

interface TenantSpec {
  subdomain: string;
  name: string;
  tier: Tier;
  queues: { name: string; displayName: string; serviceCode: string; colorCode: string }[];
}

const TENANTS: TenantSpec[] = [
  {
    subdomain: 'dinkes',
    name: 'Dinas Kesehatan',
    tier: 'high',
    queues: [
      { name: 'Pendaftaran', displayName: 'Loket Pendaftaran', serviceCode: 'A', colorCode: '#3B82F6' },
      { name: 'Layanan Umum', displayName: 'Loket Layanan Umum', serviceCode: 'B', colorCode: '#10B981' },
    ],
  },
  {
    subdomain: 'disdik',
    name: 'Dinas Pendidikan',
    tier: 'medium',
    queues: [
      { name: 'Legalisir Ijazah', displayName: 'Loket Legalisir', serviceCode: 'A', colorCode: '#8B5CF6' },
      { name: 'Layanan Umum', displayName: 'Loket Layanan Umum', serviceCode: 'B', colorCode: '#F59E0B' },
    ],
  },
  {
    subdomain: 'dinsos',
    name: 'Dinas Sosial',
    tier: 'low',
    queues: [
      { name: 'Bantuan Sosial', displayName: 'Loket Bantuan Sosial', serviceCode: 'A', colorCode: '#EF4444' },
      { name: 'Layanan Umum', displayName: 'Loket Layanan Umum', serviceCode: 'B', colorCode: '#06B6D4' },
    ],
  },
];

const randInt = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min;
const round2 = (n: number) => Math.round(n * 100) / 100;
const startOfDay = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };

/** Bias jam masuk ke 1-2 "jam sibuk" per layanan, supaya chart Jam Sibuk
 *  punya puncak yang jelas, bukan rata di semua jam. */
function weightedHour(peakHours: number[]): number {
  const weights = BUSINESS_HOURS.map((h) => (peakHours.includes(h) ? 4 : 1));
  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < BUSINESS_HOURS.length; i++) {
    r -= weights[i];
    if (r <= 0) return BUSINESS_HOURS[i];
  }
  return BUSINESS_HOURS[BUSINESS_HOURS.length - 1];
}

interface DayAgg {
  tenantId: string;
  queueId: string;
  date: Date;
  total: number;
  completed: number;
  noShow: number;
  cancelled: number;
  serviceMinSum: number;
  serviceMinWeight: number;
  hourCounts: Map<number, number>;
}

async function upsertTenant(spec: TenantSpec) {
  const tenant = await prisma.tenant.upsert({
    where: { subdomain: spec.subdomain },
    update: {},
    create: {
      name: spec.name,
      subdomain: spec.subdomain,
      description: `Tenant demo untuk development (${spec.name})`,
      theme: { create: {} },
    },
  });

  await prisma.tenantUser.upsert({
    where: { email: `admin.${spec.subdomain}@simantra.local` },
    update: {},
    create: {
      email: `admin.${spec.subdomain}@simantra.local`,
      passwordHash: await argon2.hash('password123'),
      fullName: `Admin ${spec.name}`,
      role: 'admin',
      tenantId: tenant.id,
    },
  });
  await prisma.tenantUser.upsert({
    where: { email: `operator.${spec.subdomain}@simantra.local` },
    update: {},
    create: {
      email: `operator.${spec.subdomain}@simantra.local`,
      passwordHash: await argon2.hash('password123'),
      fullName: `Operator ${spec.name}`,
      role: 'operator',
      tenantId: tenant.id,
    },
  });

  const existingQueues = await prisma.queue.findMany({ where: { tenantId: tenant.id } });
  if (existingQueues.length > 0) return { tenant, queues: existingQueues };

  await prisma.queue.createMany({
    data: spec.queues.map((q) => ({
      tenantId: tenant.id,
      name: q.name,
      displayName: q.displayName,
      serviceCode: q.serviceCode,
      colorCode: q.colorCode,
    })),
  });
  const queues = await prisma.queue.findMany({ where: { tenantId: tenant.id } });
  return { tenant, queues };
}

async function main() {
  const now = new Date();
  const today = startOfDay(now);
  const rangeStart = new Date(today);
  rangeStart.setDate(rangeStart.getDate() - DAYS_BACK);
  const rangeEndExclusive = new Date(today);
  rangeEndExclusive.setDate(rangeEndExclusive.getDate() + 1);

  const tenantIds: string[] = [];
  const entryCountByTenant = new Map<string, number>();
  const entries: Prisma.QueueEntryCreateManyInput[] = [];
  const dayAggs: DayAgg[] = [];

  for (const spec of TENANTS) {
    const { tenant, queues } = await upsertTenant(spec);
    tenantIds.push(tenant.id);
    let tenantEntryCount = 0;

    const [minCount, maxCount] = TIER_RANGE[spec.tier];
    // Baseline completion rate acak per-tenant (72-90%) supaya proporsi
    // status TIDAK seragam antar instansi — sisanya dibagi no_show/cancelled.
    const baseCompletionRate = 0.72 + Math.random() * 0.18;

    for (const queue of queues) {
      const peakHours = [
        BUSINESS_HOURS[randInt(0, BUSINESS_HOURS.length - 1)],
        BUSINESS_HOURS[randInt(0, BUSINESS_HOURS.length - 1)],
      ];

      for (let dayOffset = DAYS_BACK; dayOffset >= 0; dayOffset--) {
        const day = new Date(today);
        day.setDate(day.getDate() - dayOffset);
        const isToday = dayOffset === 0;
        const isWeekend = day.getDay() === 0 || day.getDay() === 6;

        let count = randInt(minCount, maxCount);
        if (isWeekend) count = Math.round(count * 0.35);
        if (isToday) count = Math.round(count * 0.5); // hari masih berjalan
        if (count === 0) continue;

        const agg: DayAgg = {
          tenantId: tenant.id,
          queueId: queue.id,
          date: day,
          total: 0,
          completed: 0,
          noShow: 0,
          cancelled: 0,
          serviceMinSum: 0,
          serviceMinWeight: 0,
          hourCounts: new Map(),
        };
        // Sisakan 0-2 tiket hari ini tetap terbuka (waiting/serving), realistis
        // krn hari belum selesai.
        const openFromIndex = isToday ? Math.max(0, count - randInt(0, 2)) : count;

        for (let i = 0; i < count; i++) {
          const hour = weightedHour(peakHours);
          let enteredAt = new Date(day);
          enteredAt.setHours(hour, randInt(0, 59), randInt(0, 59), 0);
          if (isToday && enteredAt > now) {
            enteredAt = new Date(now.getTime() - randInt(0, 60) * 60000);
          }

          const ticketNumber = `${queue.serviceCode ?? 'A'}${String(i + 1).padStart(3, '0')}`;
          let status: QueueEntryStatus;
          let startedAt: Date | null = null;
          let completedAt: Date | null = null;
          let serviceWindow: number | null = null;

          if (i >= openFromIndex) {
            status = Math.random() < 0.5 ? 'waiting' : 'serving';
            if (status === 'serving') {
              startedAt = new Date(enteredAt.getTime() + randInt(2, 20) * 60000);
              serviceWindow = randInt(1, 3);
            }
          } else {
            const r = Math.random();
            const noShowShare = (1 - baseCompletionRate) * 0.6;
            if (r < baseCompletionRate) {
              status = 'completed';
              const waitMin = randInt(2, 25);
              const serviceMin = randInt(3, 30);
              startedAt = new Date(enteredAt.getTime() + waitMin * 60000);
              completedAt = new Date(startedAt.getTime() + serviceMin * 60000);
              serviceWindow = randInt(1, 3);
              agg.serviceMinSum += serviceMin;
              agg.serviceMinWeight += 1;
            } else if (r < baseCompletionRate + noShowShare) {
              status = 'no_show';
              startedAt = new Date(enteredAt.getTime() + randInt(2, 25) * 60000);
              serviceWindow = randInt(1, 3);
            } else {
              status = 'cancelled';
              if (Math.random() < 0.3) {
                startedAt = new Date(enteredAt.getTime() + randInt(2, 15) * 60000);
                serviceWindow = randInt(1, 3);
              }
            }
          }

          entries.push({
            queueId: queue.id,
            tenantId: tenant.id,
            ticketNumber,
            status,
            priority: 0,
            enteredAt,
            startedAt,
            completedAt,
            serviceWindow,
          });

          agg.total++;
          tenantEntryCount++;
          if (status === 'completed') agg.completed++;
          if (status === 'no_show') agg.noShow++;
          if (status === 'cancelled') agg.cancelled++;
          agg.hourCounts.set(hour, (agg.hourCounts.get(hour) ?? 0) + 1);
        }

        dayAggs.push(agg);
      }
    }

    entryCountByTenant.set(spec.subdomain, tenantEntryCount);
  }

  console.log(`Menghapus data demo lama (${TENANTS.map((t) => t.subdomain).join(', ')}), ${rangeStart.toISOString().split('T')[0]} s.d. ${today.toISOString().split('T')[0]})...`);
  await prisma.queueEntry.deleteMany({
    where: { tenantId: { in: tenantIds }, enteredAt: { gte: rangeStart, lt: rangeEndExclusive } },
  });
  await prisma.analyticsDaily.deleteMany({
    where: { tenantId: { in: tenantIds }, date: { gte: rangeStart, lt: rangeEndExclusive } },
  });

  console.log(`Menulis ${entries.length} entri antrean...`);
  await prisma.queueEntry.createMany({ data: entries });

  console.log(`Backfill ${dayAggs.length} baris analytics_daily...`);
  await prisma.analyticsDaily.createMany({
    data: dayAggs.map((agg) => {
      let peakHour: number | null = null;
      let peakCount: number | null = null;
      for (const [hour, n] of agg.hourCounts) {
        if (peakCount === null || n > peakCount) { peakHour = hour; peakCount = n; }
      }
      return {
        tenantId: agg.tenantId,
        queueId: agg.queueId,
        date: agg.date,
        totalEntries: agg.total,
        completedEntries: agg.completed,
        noShowEntries: agg.noShow,
        cancelledEntries: agg.cancelled,
        averageServiceTimeMinutes: agg.serviceMinWeight > 0 ? round2(agg.serviceMinSum / agg.serviceMinWeight) : null,
        peakHour,
        peakCount,
      };
    }),
  });

  console.log('\nSeed demo selesai:');
  for (const spec of TENANTS) {
    console.log(`  ${spec.name} (${spec.subdomain}, tier ${spec.tier}): ${entryCountByTenant.get(spec.subdomain) ?? 0} entri`);
  }
  console.log(`  total: ${entries.length} entri, ${dayAggs.length} baris analytics_daily`);
  console.log('\nLogin admin/operator demo: admin.<slug>@simantra.local / password123 (slug: dinkes, disdik, dinsos)');
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
