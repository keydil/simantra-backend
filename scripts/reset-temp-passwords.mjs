// Regenerate password sementara SEMUA user + tulis ulang
// migration-output/temp-passwords.csv. Dipakai kalau CSV hasil migrasi
// hilang sebelum sempat dibagikan (tanpa CSV, tidak ada yang bisa login).
//
// Jalankan: node --env-file=.env scripts/reset-temp-passwords.mjs

import { randomBytes } from 'crypto';
import { mkdir, writeFile } from 'fs/promises';
import { resolve } from 'path';
import { PrismaClient } from '@prisma/client';
import argon2 from 'argon2';

const prisma = new PrismaClient();

async function main() {
  const users = await prisma.tenantUser.findMany({ orderBy: [{ role: 'asc' }, { email: 'asc' }] });
  if (users.length === 0) {
    console.error('ERROR: tidak ada user di DB — jalankan migrate:supabase dulu.');
    process.exit(1);
  }

  const csvLines = ['email,temp_password,role,tenant_id'];
  for (const u of users) {
    const tempPassword = randomBytes(9).toString('base64url'); // 12 char
    await prisma.tenantUser.update({
      where: { id: u.id },
      data: {
        passwordHash: await argon2.hash(tempPassword),
        mustChangePassword: true,
      },
    });
    csvLines.push(`${u.email},${tempPassword},${u.role},${u.tenantId ?? ''}`);
    console.log(`reset: ${u.email} (${u.role})`);
  }

  // Semua refresh token lama tidak berlaku lagi
  await prisma.refreshToken.updateMany({
    where: { revokedAt: null },
    data: { revokedAt: new Date() },
  });

  await mkdir(resolve('migration-output'), { recursive: true });
  await writeFile(resolve('migration-output/temp-passwords.csv'), csvLines.join('\n'), 'utf8');
  console.log(`\n${users.length} user di-reset. CSV: migration-output/temp-passwords.csv`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
