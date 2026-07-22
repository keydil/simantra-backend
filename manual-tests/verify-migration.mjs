// Verifikasi pasca-migrasi Supabase — jalankan dengan server hidup.
// Membaca migration-output/temp-passwords.csv utk tes login (password tidak dicetak).
import { readFile } from 'fs/promises';

const BASE = 'http://localhost:3002/api/v1';
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name} ${extra}`); }
};
const req = async (method, path, { token, body } = {}) => {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch {}
  return { status: res.status, json };
};

const csv = (await readFile('migration-output/temp-passwords.csv', 'utf8')).trim().split('\n').slice(1)
  .map((l) => { const [email, temp, role, tenantId] = l.split(','); return { email, temp, role, tenantId }; });

// 1. Public endpoint tenant produksi
let r = await req('GET', '/public/tenants/dinkes');
ok('public tenant produksi (dinkes) 200 + theme', r.status === 200 && r.json.name === 'Dinas Kesehatan' && !!r.json.theme);

r = await req('GET', '/public/tenants/dinkes/queues');
ok('queues produksi dinkes tampil di kiosk', r.status === 200 && r.json.length >= 1, JSON.stringify(r.json.map(q => q.service_code)));

// 2. Login user migrasi (superadmin lama kalau ada, selain itu baris pertama)
const su = csv.find((c) => c.role === 'superadmin') ?? csv[0];
r = await req('POST', '/auth/login', { body: { email: su.email, password: su.temp } });
ok(`login user migrasi (${su.email}) dengan password sementara`, r.status === 200, `status ${r.status}`);
const tok = r.json?.access_token;
ok('claims harus must_change_password=true', r.json?.user?.must_change_password === true);

// 3. Gate harus aktif
r = await req('GET', '/tenants', { token: tok });
ok('endpoint lain terblokir MUST_CHANGE_PASSWORD', r.status === 403 && r.json?.error === 'MUST_CHANGE_PASSWORD', JSON.stringify(r.json));
r = await req('GET', '/auth/me', { token: tok });
ok('GET /auth/me tetap boleh', r.status === 200 && r.json.email === su.email);

// 4. Password lama Supabase TIDAK boleh berlaku — coba password umum salah
r = await req('POST', '/auth/login', { body: { email: su.email, password: 'password123' } });
ok('password lama/tebakan ditolak 401', r.status === 401);

// 5. Relasi utuh: entry pertama menunjuk queue & tenant yang valid
r = await req('GET', '/public/tenants/dinkes/entries?status=waiting,serving,completed,cancelled,no_show');
if (r.json.length > 0) {
  const e = r.json[0];
  const q = await req('GET', `/public/queues/${e.queue_id}`);
  ok('relasi entry→queue utuh (UUID asli dipertahankan)', q.status === 200 && q.json.tenant_id === e.tenant_id);
} else {
  ok('relasi entry→queue utuh (tenant dinkes tidak punya entry — dilewati)', true);
}

console.log(`\nTotal user di CSV: ${csv.length} (${csv.filter(c => c.role === 'superadmin').length} superadmin)`);
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
