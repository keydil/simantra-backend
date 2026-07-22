const BASE = 'http://localhost:3002/api/v1';
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name} ${extra}`); }
};
const req = async (method, path, { token, body } = {}) => {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch {}
  return { status: res.status, json };
};

// 1. Login superadmin
let r = await req('POST', '/auth/login', { body: { email: 'admin@simantra.local', password: 'admin12345' } });
ok('login superadmin 200', r.status === 200 && !!r.json.access_token, JSON.stringify(r.json));
const superTok = r.json.access_token;
const superRefresh = r.json.refresh_token;
ok('claims: role superadmin, tenant null', r.json.user.role === 'superadmin' && r.json.user.tenant_id === null);

// 2. Wrong password
r = await req('POST', '/auth/login', { body: { email: 'admin@simantra.local', password: 'salah-total' } });
ok('login password salah 401', r.status === 401);

// 3. /auth/me superadmin
r = await req('GET', '/auth/me', { token: superTok });
ok('GET /auth/me 200', r.status === 200 && r.json.email === 'admin@simantra.local');

// 4. Unauthenticated blocked
r = await req('GET', '/users/superadmins');
ok('tanpa token 401', r.status === 401);

// 5. Login admin dinkes + tenant_slug validation
r = await req('POST', '/auth/login', { body: { email: 'admin.dinkes@simantra.local', password: 'password123', tenant_slug: 'dinkes' } });
ok('login admin dinkes (slug cocok) 200', r.status === 200);
const adminTok = r.json.access_token;
const tenantId = r.json.user.tenant_id;

r = await req('POST', '/auth/login', { body: { email: 'admin.dinkes@simantra.local', password: 'password123', tenant_slug: 'tenant-lain' } });
ok('login admin dengan slug salah 401', r.status === 401);

// 6. Admin lists own tenant users
r = await req('GET', `/tenants/${tenantId}/users`, { token: adminTok });
ok('admin list users tenant sendiri 200', r.status === 200 && Array.isArray(r.json) && r.json.length >= 2);
ok('respons tidak bocorkan password_hash', r.status === 200 && r.json.every(u => !('password_hash' in u) && !('passwordHash' in u)));

// 7. Admin blocked from other tenantId (fake uuid)
r = await req('GET', `/tenants/00000000-0000-4000-8000-000000000000/users`, { token: adminTok });
ok('admin akses tenant lain 403', r.status === 403);

// 8. Operator blocked by role
r = await req('POST', '/auth/login', { body: { email: 'operator.dinkes@simantra.local', password: 'password123' } });
const opTok = r.json.access_token;
r = await req('GET', `/tenants/${tenantId}/users`, { token: opTok });
ok('operator list users 403 (role)', r.status === 403);

// 9. Admin can't create superadmin
r = await req('POST', '/users', { token: adminTok, body: { email: 'evil@simantra.local', password: 'password123', role: 'superadmin' } });
ok('admin buat superadmin 403', r.status === 403);

// 10. Ghost-account-fix flow: admin creates a new admin (role admin supaya
// bisa menguji guard must_change_password pada endpoint yang sudah ada)
const newEmail = `petugas.baru.${Date.now()}@simantra.local`;
r = await req('POST', '/users', { token: adminTok, body: { email: newEmail, password: 'rahasia-awal-123', full_name: 'Petugas Baru', role: 'admin' } });
ok('admin buat user baru 201', r.status === 201 && r.json.must_change_password === true, JSON.stringify(r.json));
const newUserId = r.json.id;

// 10b. New user CAN login (anti-ghost!) but is gated
r = await req('POST', '/auth/login', { body: { email: newEmail, password: 'rahasia-awal-123' } });
ok('user baru BISA login (bukan ghost)', r.status === 200);
const newTok = r.json.access_token;

r = await req('GET', `/tenants/${tenantId}/users`, { token: newTok });
ok('user baru diblokir guard must_change_password (403)', r.status === 403 && r.json?.error === 'MUST_CHANGE_PASSWORD', JSON.stringify(r.json));

r = await req('GET', '/auth/me', { token: newTok });
ok('user baru tetap boleh GET /auth/me', r.status === 200);

r = await req('POST', '/auth/change-password', { token: newTok, body: { old_password: 'rahasia-awal-123', new_password: 'password-pilihan-sendiri' } });
ok('change-password 201', (r.status === 200 || r.status === 201) && r.json.user.must_change_password === false, JSON.stringify(r.json));
const newTok2 = r.json.access_token;

r = await req('GET', '/auth/me', { token: newTok2 });
ok('setelah ganti password: must_change_password false', r.status === 200 && r.json.must_change_password === false);

// 11. Duplicate email 409
r = await req('POST', '/users', { token: adminTok, body: { email: newEmail, password: 'password123', role: 'operator' } });
ok('email duplikat 409', r.status === 409);

// 12. Refresh rotation + reuse detection
r = await req('POST', '/auth/refresh', { body: { refresh_token: superRefresh } });
ok('refresh 200 (rotasi)', (r.status === 200 || r.status === 201) && !!r.json.refresh_token);
const rotated = r.json.refresh_token;
r = await req('POST', '/auth/refresh', { body: { refresh_token: superRefresh } });
ok('refresh token lama dipakai ulang 401 (reuse detection)', r.status === 401);
r = await req('POST', '/auth/refresh', { body: { refresh_token: rotated } });
ok('token hasil rotasi ikut mati setelah reuse terdeteksi', r.status === 401);

// 13. Deactivation revokes sessions: superadmin deactivates the new user
r = await req('POST', '/auth/login', { body: { email: 'admin@simantra.local', password: 'admin12345' } });
const superTok2 = r.json.access_token;
r = await req('PATCH', `/users/${newUserId}`, { token: superTok2, body: { is_active: false } });
ok('superadmin nonaktifkan user 200', r.status === 200 && r.json.is_active === false);
r = await req('POST', '/auth/login', { body: { email: newEmail, password: 'password-pilihan-sendiri' } });
ok('user nonaktif tidak bisa login 401', r.status === 401);

// 14. Self-deactivation forbidden
const meRes = await req('GET', '/auth/me', { token: superTok2 });
r = await req('PATCH', `/users/${meRes.json.id}`, { token: superTok2, body: { is_active: false } });
ok('nonaktifkan diri sendiri 403', r.status === 403);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
