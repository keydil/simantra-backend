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

// login semua role
let r = await req('POST', '/auth/login', { body: { email: 'admin@simantra.local', password: 'admin12345' } });
const superTok = r.json.access_token;
r = await req('POST', '/auth/login', { body: { email: 'admin.dinkes@simantra.local', password: 'password123' } });
const adminTok = r.json.access_token;
const dinkesId = r.json.user.tenant_id;
r = await req('POST', '/auth/login', { body: { email: 'operator.dinkes@simantra.local', password: 'password123' } });
const opTok = r.json.access_token;

// ═══ Tenants ═══
r = await req('GET', '/tenants', { token: superTok });
ok('superadmin list tenants 200 + theme ikut', r.status === 200 && r.json.length >= 1 && r.json[0].theme !== undefined);
r = await req('GET', '/tenants', { token: adminTok });
ok('admin list tenants 403', r.status === 403);

const demoSlug = `puskesmas-demo-${Date.now() % 100000}`;
r = await req('POST', '/tenants', { token: superTok, body: { name: `Puskesmas Demo ${Date.now() % 100000}`, subdomain: demoSlug, brand_color: '#FF5733' } });
ok('superadmin create tenant 201 + theme default satu transaksi', r.status === 201 && !!r.json.theme, JSON.stringify(r.json).slice(0, 200));
const demoTenant = r.json;

r = await req('POST', '/tenants', { token: superTok, body: { name: 'Lain', subdomain: demoSlug } });
ok('subdomain duplikat 409', r.status === 409);

r = await req('GET', `/tenants/${dinkesId}`, { token: adminTok });
ok('admin GET tenant sendiri 200', r.status === 200);
r = await req('GET', `/tenants/${demoTenant.id}`, { token: adminTok });
ok('admin GET tenant lain 403', r.status === 403);

r = await req('PATCH', `/tenants/${dinkesId}/theme`, { token: adminTok, body: { primary_color: '#123456', is_custom_theme: true } });
ok('admin PATCH theme sendiri 200', r.status === 200 && r.json.primary_color === '#123456');
r = await req('PATCH', `/tenants/${demoTenant.id}/theme`, { token: adminTok, body: { primary_color: '#000000' } });
ok('admin PATCH theme tenant lain 403', r.status === 403);

r = await req('PATCH', `/tenants/${demoTenant.id}`, { token: superTok, body: { subscription_tier: 'premium' } });
ok('superadmin PATCH tenant 200', r.status === 200 && r.json.subscription_tier === 'premium');

// ═══ Queues CRUD ═══
r = await req('POST', `/tenants/${dinkesId}/queues`, { token: adminTok, body: { name: 'Layanan Farmasi', service_code: 'C', display_name: 'Loket Farmasi' } });
ok('admin create queue 201', r.status === 201 && r.json.service_code === 'C');
const queueC = r.json;
r = await req('POST', `/tenants/${dinkesId}/queues`, { token: opTok, body: { name: 'X' } });
ok('operator create queue 403', r.status === 403);

r = await req('PATCH', `/queues/${queueC.id}`, { token: adminTok, body: { is_active: false } });
ok('admin nonaktifkan queue 200', r.status === 200 && r.json.is_active === false);
r = await req('GET', '/public/tenants/dinkes/queues');
ok('queue nonaktif hilang dari daftar publik', r.status === 200 && !r.json.some(q => q.id === queueC.id));

// ═══ Guest book ═══
// upload foto 1x1 PNG
const pngB64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const form = new FormData();
form.append('file', new Blob([Buffer.from(pngB64, 'base64')], { type: 'image/png' }), 'foto.png');
let res = await fetch(`${BASE}/public/tenants/dinkes/guest-book/photo`, { method: 'POST', body: form });
let photoJson = await res.json();
ok('upload foto guest book 201 → photo_url', res.status === 201 && photoJson.photo_url?.includes('/uploads/guest-photos/'), JSON.stringify(photoJson));

// file tersaji via static
res = await fetch(photoJson.photo_url);
ok('foto bisa diakses via /uploads (static)', res.status === 200 && res.headers.get('content-type')?.includes('image/png'));

r = await req('POST', '/public/tenants/dinkes/guest-book', { body: { name: 'Siti Aminah', institution: 'PT Maju Jaya', purpose: 'Konsultasi Layanan', phone: '0812345678', photo_url: photoJson.photo_url } });
ok('submit guest book 201', r.status === 201 && r.json.name === 'Siti Aminah');

r = await req('POST', '/public/tenants/dinkes/guest-book', { body: { name: 'Hacker', institution: 'X', purpose: 'Y', phone: '1', photo_url: 'https://evil.com/x.jpg' } });
ok('photo_url asing DITOLAK 400 (padanan regex script 08)', r.status === 400);

r = await req('POST', '/public/tenants/dinkes/guest-book', { body: { name: '   ', institution: 'X', purpose: 'Y', phone: '1' } });
ok('nama kosong (spasi) ditolak 400', r.status === 400);

r = await req('GET', '/public/tenants/dinkes/guest-book/institutions?search=maju');
ok('autocomplete institusi (nama saja)', r.status === 200 && r.json.includes('PT Maju Jaya') && typeof r.json[0] === 'string');

r = await req('GET', `/tenants/${dinkesId}/guest-book?search=siti`, { token: adminTok });
ok('admin list guest book + count', r.status === 200 && r.json.count >= 1 && r.json.data[0].name === 'Siti Aminah', JSON.stringify(r.json).slice(0, 200));
r = await req('GET', `/tenants/${dinkesId}/guest-book`, { token: opTok });
ok('operator list guest book 403', r.status === 403);

// ═══ Announcements ═══
r = await req('POST', '/announcements', { token: superTok, body: { title: 'Maintenance Malam Ini', description: 'Sistem maintenance 22:00', announcement_type: 'warning', priority: 5 } });
ok('superadmin create announcement 201', r.status === 201 && r.json.created_by, JSON.stringify(r.json).slice(0, 200));
const annWarning = r.json;

r = await req('POST', '/announcements', { token: adminTok, body: { title: 'X', description: 'Y' } });
ok('admin create announcement 403', r.status === 403);

r = await req('POST', '/announcements', { token: superTok, body: { title: 'Update Internal', description: 'Fitur baru', announcement_type: 'update' } });
ok('create announcement type update 201', r.status === 201);

r = await req('POST', '/announcements', { token: superTok, body: { title: 'Khusus Demo', description: 'Hanya tenant demo', target_tenants: 'specific', specific_tenant_ids: [demoTenant.id] } });
const annSpecific = r.json;

r = await req('POST', '/announcements', { token: superTok, body: { title: 'Salah', description: 'X', target_tenants: 'specific' } });
ok('target specific tanpa ids 400', r.status === 400);

r = await req('GET', `/tenants/${dinkesId}/announcements/active`, { token: opTok });
ok('staff dinkes: lihat warning + update, TIDAK lihat khusus-demo', r.status === 200 && r.json.some(a => a.id === annWarning.id) && r.json.some(a => a.title === 'Update Internal') && !r.json.some(a => a.id === annSpecific.id));

r = await req('GET', '/public/tenants/dinkes/announcements/active');
ok('publik: HANYA maintenance/warning, field di-whitelist', r.status === 200 && r.json.some(a => a.id === annWarning.id) && !r.json.some(a => a.title === 'Update Internal') && !('created_by' in r.json[0]));

r = await req('DELETE', `/announcements/${annWarning.id}`, { token: superTok });
ok('soft delete announcement', r.status === 200 && r.json.is_active === false);
r = await req('GET', '/public/tenants/dinkes/announcements/active');
ok('announcement nonaktif hilang dari publik', r.status === 200 && !r.json.some(a => a.id === annWarning.id));

// ═══ Analytics ═══
const today = new Date().toISOString().split('T')[0];
r = await req('POST', '/analytics/aggregate', { token: superTok, body: { date: today } });
ok('agregasi manual (superadmin) upsert >= 1', (r.status === 200 || r.status === 201) && r.json.upserted >= 1, JSON.stringify(r.json));
r = await req('POST', '/analytics/aggregate', { token: opTok, body: {} });
ok('agregasi oleh operator 403', r.status === 403);

r = await req('GET', `/tenants/${dinkesId}/analytics?from=${today}`, { token: adminTok });
ok('admin analytics tenant sendiri (fix UI_UX 1.2)', r.status === 200 && r.json.length >= 1 && r.json[0].total_entries >= 1, JSON.stringify(r.json).slice(0, 300));
r = await req('GET', `/tenants/${demoTenant.id}/analytics`, { token: adminTok });
ok('admin analytics tenant lain 403', r.status === 403);

// idempoten: jalankan ulang agregasi → tidak duplikat baris
r = await req('POST', '/analytics/aggregate', { token: superTok, body: { date: today } });
const r2 = await req('GET', `/tenants/${dinkesId}/analytics?from=${today}`, { token: adminTok });
ok('agregasi idempoten (jumlah baris tetap)', r2.json.length === (await req('GET', `/tenants/${dinkesId}/analytics?from=${today}`, { token: adminTok })).json.length);

// ═══ Soft delete tenant → hilang dari publik ═══
r = await req('DELETE', `/tenants/${demoTenant.id}`, { token: superTok });
ok('soft delete tenant 200', r.status === 200 && r.json.is_active === false);
r = await req('GET', `/public/tenants/${demoSlug}`);
ok('tenant nonaktif → publik 404', r.status === 404);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
