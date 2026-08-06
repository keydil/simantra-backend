// Bikin/-perbarui SATU akun superadmin dari environment variable. Ini jalur
// resmi untuk menyalakan akun pertama di database PRODUKSI yang masih kosong.
//
// SENGAJA tidak memakai prisma/seed.ts: seed itu meng-hardcode
// admin@simantra.local / admin12345 dan beberapa akun demo lain — aman di dev,
// tidak boleh sekali pun menyentuh produksi.
//
// Jalankan (dari mesin lokal, DATABASE_URL diarahkan ke DB produksi):
//   BOOTSTRAP_EMAIL=... BOOTSTRAP_PASSWORD=... node scripts/bootstrap-superadmin.mjs
// atau taruh ketiganya di sebuah file env lalu:
//   node --env-file=.env.production scripts/bootstrap-superadmin.mjs

import { PrismaClient } from '@prisma/client';
import argon2 from 'argon2';

const prisma = new PrismaClient();

async function main() {
  const email = process.env.BOOTSTRAP_EMAIL?.trim().toLowerCase();
  const password = process.env.BOOTSTRAP_PASSWORD;
  const fullName = process.env.BOOTSTRAP_NAME?.trim() || 'Super Admin';

  if (!email || !password) {
    console.error('ERROR: BOOTSTRAP_EMAIL dan BOOTSTRAP_PASSWORD wajib diisi.');
    process.exit(1);
  }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    console.error(`ERROR: '${email}' bukan alamat email yang valid.`);
    process.exit(1);
  }
  // Samakan dengan lantai validasi API (@MinLength(8) di semua DTO password).
  if (password.length < 8) {
    console.error('ERROR: BOOTSTRAP_PASSWORD minimal 8 karakter.');
    process.exit(1);
  }

  const passwordHash = await argon2.hash(password);
  const existing = await prisma.tenantUser.findUnique({ where: { email } });

  if (existing && existing.role !== 'superadmin') {
    // Jangan diam-diam menaikkan hak akun yang sudah ada — itu kejutan yang
    // berbahaya. Minta operator sadar dan memilih email lain.
    console.error(
      `ERROR: ${email} sudah ada dengan role '${existing.role}'. Script ini menolak mengubah role akun yang sudah ada.`,
    );
    process.exit(1);
  }

  const user = await prisma.tenantUser.upsert({
    where: { email },
    // Dijalankan ulang = reset password superadmin. Berguna kalau terkunci
    // dan email reset pun tidak bisa dipakai.
    update: { passwordHash, mustChangePassword: true, isActive: true },
    create: {
      email,
      passwordHash,
      fullName,
      role: 'superadmin',
      tenantId: null, // superadmin tidak terikat tenant mana pun
      mustChangePassword: true,
    },
  });

  // Password TIDAK ikut dicetak — nilainya sudah ada di tangan pemanggil, dan
  // output shell gampang sekali bocor lewat log CI atau screenshot.
  console.log(existing ? 'Superadmin diperbarui:' : 'Superadmin dibuat:');
  console.log(`  email : ${user.email}`);
  console.log(`  nama  : ${user.fullName}`);
  console.log('  Wajib ganti password saat login pertama.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
