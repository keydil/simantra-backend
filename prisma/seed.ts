// Seed dev: 1 superadmin + 1 tenant demo (dinkes) + admin & operator-nya.
// Password seed HANYA untuk dev. Akun yang dibuat via API (POST /users)
// otomatis kena alur must_change_password — akun seed sengaja tidak, supaya
// gampang dipakai testing.
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();

async function main() {
  const superadmin = await prisma.tenantUser.upsert({
    where: { email: 'admin@simantra.local' },
    update: {},
    create: {
      email: 'admin@simantra.local',
      passwordHash: await argon2.hash('admin12345'),
      fullName: 'Super Admin',
      role: 'superadmin',
      tenantId: null,
    },
  });

  const tenant = await prisma.tenant.upsert({
    where: { subdomain: 'dinkes' },
    update: {},
    create: {
      name: 'Dinas Kesehatan',
      subdomain: 'dinkes',
      description: 'Tenant demo untuk development',
      theme: { create: {} },
    },
  });

  const admin = await prisma.tenantUser.upsert({
    where: { email: 'admin.dinkes@simantra.local' },
    update: {},
    create: {
      email: 'admin.dinkes@simantra.local',
      passwordHash: await argon2.hash('password123'),
      fullName: 'Admin Dinkes',
      role: 'admin',
      tenantId: tenant.id,
    },
  });

  const operator = await prisma.tenantUser.upsert({
    where: { email: 'operator.dinkes@simantra.local' },
    update: {},
    create: {
      email: 'operator.dinkes@simantra.local',
      passwordHash: await argon2.hash('password123'),
      fullName: 'Operator Dinkes',
      role: 'operator',
      tenantId: tenant.id,
    },
  });

  // 2 layanan demo utk tenant dinkes (tidak ada unique alami → cek dulu)
  const existingQueues = await prisma.queue.count({ where: { tenantId: tenant.id } });
  if (existingQueues === 0) {
    await prisma.queue.createMany({
      data: [
        {
          tenantId: tenant.id,
          name: 'Pendaftaran',
          displayName: 'Loket Pendaftaran',
          serviceCode: 'A',
          colorCode: '#3B82F6',
        },
        {
          tenantId: tenant.id,
          name: 'Layanan Umum',
          displayName: 'Loket Layanan Umum',
          serviceCode: 'B',
          colorCode: '#10B981',
        },
      ],
    });
  }
  const queues = await prisma.queue.findMany({ where: { tenantId: tenant.id } });

  console.log('Seed selesai:');
  console.log(`  queues     : ${queues.map((q) => `${q.serviceCode}-${q.name}`).join(', ')}`);
  console.log(`  superadmin : ${superadmin.email} / admin12345`);
  console.log(`  tenant     : ${tenant.name} (slug: ${tenant.subdomain})`);
  console.log(`  admin      : ${admin.email} / password123`);
  console.log(`  operator   : ${operator.email} / password123`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
