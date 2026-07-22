import { io } from 'socket.io-client';

const BASE = 'http://localhost:3002/api/v1';
const WS = 'http://localhost:3002/realtime';
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
const waitEvent = (socket, event, ms = 4000) =>
  new Promise((resolve) => {
    const t = setTimeout(() => resolve(null), ms);
    socket.once(event, (data) => { clearTimeout(t); resolve(data); });
  });
const emitAck = (socket, event, payload, ms = 4000) =>
  new Promise((resolve) => {
    const t = setTimeout(() => resolve(null), ms);
    socket.emit(event, payload, (ack) => { clearTimeout(t); resolve(ack); });
  });

// ═══ REST publik ═══
let r = await req('GET', '/public/tenants/dinkes');
ok('public tenant dinkes 200 + theme', r.status === 200 && r.json.subdomain === 'dinkes' && !!r.json.theme, JSON.stringify(r.json).slice(0, 200));

r = await req('GET', '/public/tenants/tidak-ada');
ok('public tenant tak dikenal 404 (bukan row NULL!)', r.status === 404);

r = await req('GET', '/public/tenants/dinkes/queues');
ok('public queues 200, urut service_code', r.status === 200 && r.json.length === 2 && r.json[0].service_code === 'A');
const queueA = r.json[0];

// Ambil 2 tiket — cek penomoran serial
r = await req('POST', `/public/tenants/dinkes/queues/${queueA.id}/entries`, { body: { customer_name: 'Budi' } });
ok('ambil tiket #1 (201)', r.status === 201 && /^A\d{3}$/.test(r.json.ticket_number), JSON.stringify(r.json));
const t1 = r.json;
r = await req('POST', `/public/tenants/dinkes/queues/${queueA.id}/entries`, { body: {} });
ok('ambil tiket #2 — nomor berurutan', r.status === 201 && parseInt(r.json.ticket_number.slice(1)) === parseInt(t1.ticket_number.slice(1)) + 1);
const t2 = r.json;

r = await req('GET', '/public/tenants/dinkes/entries');
ok('public entries TANPA customer_name', r.status === 200 && r.json.length >= 2 && r.json.every(e => !('customer_name' in e) && !('notes' in e)));

r = await req('GET', `/public/entries/${t1.id}`);
ok('public entry by UUID (capability) → full incl customer_name', r.status === 200 && r.json.customer_name === 'Budi');

r = await req('GET', `/public/entries/${t2.id}/position`);
ok('posisi antrian: 1 di depan t2', r.status === 200 && r.json.ahead === 1, JSON.stringify(r.json));

r = await req('GET', '/public/entries/00000000-0000-4000-8000-000000000000');
ok('entry tak ada 404', r.status === 404);

r = await req('GET', `/public/queues/${queueA.id}`);
ok('public queue by id 200', r.status === 200 && r.json.service_code === 'A');

// ═══ Staff (operator) ═══
r = await req('POST', '/auth/login', { body: { email: 'operator.dinkes@simantra.local', password: 'password123' } });
const opTok = r.json.access_token;
const tenantId = r.json.user.tenant_id;

r = await req('GET', `/tenants/${tenantId}/entries`, { token: opTok });
ok('operator list entries (waiting default) 200', r.status === 200 && r.json.length >= 2);
ok('staff view TERMASUK customer_name', r.json.some(e => e.customer_name === 'Budi'));

r = await req('GET', `/tenants/${tenantId}/entries/summary`, { token: opTok });
ok('summary view 200', r.status === 200 && Array.isArray(r.json) && r.json.some(s => s.waiting_count >= 2), JSON.stringify(r.json));

// tanpa auth → 401
r = await req('GET', `/tenants/${tenantId}/entries`);
ok('staff entries tanpa token 401', r.status === 401);

// ═══ WebSocket ═══
const anonSock = io(WS, { transports: ['websocket'] });
const holderSock = io(WS, { transports: ['websocket'] });
const staffSock = io(WS, { transports: ['websocket'], auth: { token: opTok } });
await new Promise(res => setTimeout(res, 800));

let ack = await emitAck(anonSock, 'join', { type: 'tenant_public', slug: 'dinkes' });
ok('WS anon join room publik', ack?.ok === true, JSON.stringify(ack));
ack = await emitAck(anonSock, 'join', { type: 'tenant_public', slug: 'tidak-ada' });
ok('WS join slug tak dikenal ditolak', ack?.ok === false);
ack = await emitAck(anonSock, 'join', { type: 'staff' });
ok('WS anon join room staff ditolak', ack?.ok === false);

ack = await emitAck(holderSock, 'join', { type: 'entry', entry_id: t2.id });
ok('WS pemegang tiket join room entry', ack?.ok === true);
ack = await emitAck(staffSock, 'join', { type: 'staff' });
ok('WS operator (JWT) join room staff', ack?.ok === true, JSON.stringify(ack));

// entry.created: ambil tiket ke-3 → anon (publik, tanpa nama) & staff (dengan nama) terima
const pCreatedAnon = waitEvent(anonSock, 'entry.created');
const pCreatedStaff = waitEvent(staffSock, 'entry.created');
r = await req('POST', `/public/tenants/dinkes/queues/${queueA.id}/entries`, { body: { customer_name: 'Citra' } });
const t3 = r.json;
const [evAnon, evStaff] = await Promise.all([pCreatedAnon, pCreatedStaff]);
ok('WS entry.created diterima room publik', evAnon?.ticket_number === t3.ticket_number);
ok('WS payload publik tanpa customer_name', evAnon !== null && !('customer_name' in evAnon), JSON.stringify(evAnon));
ok('WS payload staff dengan customer_name', evStaff?.customer_name === 'Citra');

// entry.called: operator call-next → t1 (tertua) jadi serving; TTS event di 3 room
const pCalledAnon = waitEvent(anonSock, 'entry.called');
r = await req('POST', `/queues/${queueA.id}/call-next`, { token: opTok, body: { service_window: 2 } });
ok('call-next 201 → tiket tertua serving', (r.status === 200 || r.status === 201) && r.json.id === t1.id && r.json.status === 'serving' && r.json.service_window === 2 && !!r.json.started_at, JSON.stringify(r.json));
const evCalled = await pCalledAnon;
ok('WS entry.called diterima (payload entry+queue)', evCalled?.entry?.id === t1.id && evCalled?.queue?.service_code === 'A');

// entry.updated di room entry: t2 dipanggil lalu holder terima entry.called
const pHolderCalled = waitEvent(holderSock, 'entry.called');
r = await req('POST', `/queues/${queueA.id}/call-next`, { token: opTok, body: {} });
ok('call-next kedua → t2', r.json.id === t2.id);
const evHolder = await pHolderCalled;
ok('WS pemegang tiket terima entry.called utk tiketnya', evHolder?.entry?.id === t2.id);

// state machine
r = await req('PATCH', `/entries/${t1.id}/status`, { token: opTok, body: { status: 'completed' } });
ok('serving→completed 200 + completed_at server', r.status === 200 && !!r.json.completed_at);
r = await req('PATCH', `/entries/${t3.id}/status`, { token: opTok, body: { status: 'completed' } });
ok('waiting→completed DITOLAK 400 (state machine)', r.status === 400);
r = await req('PATCH', `/entries/${t3.id}/status`, { token: opTok, body: { status: 'cancelled' } });
ok('waiting→cancelled 200', r.status === 200);

// call-next saat kosong → 404
r = await req('POST', `/queues/${queueA.id}/call-next`, { token: opTok, body: {} });
r = await req('POST', `/queues/${queueA.id}/call-next`, { token: opTok, body: {} });
ok('call-next antrian kosong 404', r.status === 404, JSON.stringify(r.json));

// stats today
r = await req('GET', `/queues/${queueA.id}/stats/today`, { token: opTok });
ok('stats/today 200', r.status === 200 && r.json.completed >= 1 && r.json.cancelled >= 1, JSON.stringify(r.json));

// ═══ Throttle ambil tiket (limit 5/menit) — dijalankan TERAKHIR ═══
let last = null;
for (let i = 0; i < 5; i++) {
  last = await req('POST', `/public/tenants/dinkes/queues/${queueA.id}/entries`, { body: {} });
}
ok('throttle: percobaan ke-6+ dalam 1 menit kena 429', last.status === 429, `status terakhir: ${last.status}`);

anonSock.close(); holderSock.close(); staffSock.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
