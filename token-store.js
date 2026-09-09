// เก็บ token ของทีมภายนอกไว้ใน tokens.json (ไม่อยู่ใน git, chmod 600)
// แยกจาก .env.local เพื่อให้เพิ่ม/แก้/ลบผ่านหน้าเว็บได้โดยไม่ต้อง restart service
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const FILE = process.env.TOKENS_FILE || path.join(__dirname, 'tokens.json');
const MIN_LEN = 16;

let cache = null;
let cacheMtime = 0;
let dirty = false;

function blank() {
  return { tokens: [] };
}

// อ่านใหม่เมื่อไฟล์ถูกแก้จากข้างนอก (แก้มือบน server ได้โดยไม่ต้อง restart)
function load() {
  let mtime = 0;
  try {
    mtime = fs.statSync(FILE).mtimeMs;
  } catch (e) {
    if (cache) return cache;
    cache = seedFromEnv();
    if (cache.tokens.length > 0) save();
    return cache;
  }
  if (cache && mtime === cacheMtime) return cache;
  try {
    const data = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    cache = Array.isArray(data.tokens) ? data : blank();
  } catch (e) {
    console.error('อ่าน tokens.json ไม่ได้ ใช้ค่าว่างแทน:', e.message);
    cache = blank();
  }
  cacheMtime = mtime;
  return cache;
}

// ครั้งแรกสุด: ย้าย token จาก API_TOKENS ใน .env.local เข้าไฟล์ให้อัตโนมัติ
function seedFromEnv() {
  const raw = process.env.API_TOKENS || '';
  const tokens = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((pair, i) => {
      const idx = pair.lastIndexOf(':');
      const label = idx > 0 ? pair.slice(0, idx) : `token-${i + 1}`;
      const token = idx > 0 ? pair.slice(idx + 1) : pair;
      return token.length >= MIN_LEN ? newRecord(label, token, 'ย้ายมาจาก API_TOKENS ใน .env.local') : null;
    })
    .filter(Boolean);
  if (tokens.length > 0) console.log(`✓ ย้าย ${tokens.length} token จาก .env.local เข้า ${path.basename(FILE)}`);
  return { tokens };
}

function newRecord(label, token, note) {
  return {
    id: 'tk_' + crypto.randomBytes(5).toString('hex'),
    label: String(label || '').trim() || 'ไม่ระบุชื่อ',
    token: token || crypto.randomBytes(24).toString('hex'),
    note: String(note || '').trim(),
    enabled: true,
    createdAt: new Date().toISOString(),
    lastUsedAt: null,
    useCount: 0,
  };
}

function save() {
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(cache, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, FILE);   // เขียนแบบ atomic กันไฟล์พังถ้าดับกลางคัน
  try {
    cacheMtime = fs.statSync(FILE).mtimeMs;
  } catch (e) { /* ไม่เป็นไร รอบหน้าอ่านใหม่ */ }
  dirty = false;
}

// เทียบ token แบบไม่รั่วเวลา
function sameToken(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  if (x.length !== y.length) return false;
  return crypto.timingSafeEqual(x, y);
}

module.exports = {
  file: FILE,

  list() {
    return load().tokens;
  },

  // ใช้ตอนตรวจสิทธิ์ — คืน record ที่ยังเปิดใช้อยู่เท่านั้น
  findByToken(token) {
    if (!token || token.length < MIN_LEN) return null;
    return load().tokens.find((t) => t.enabled && sameToken(t.token, token)) || null;
  },

  create({ label, note }) {
    const store = load();
    const rec = newRecord(label, null, note);
    store.tokens.push(rec);
    save();
    return rec;
  },

  // แก้ได้เฉพาะ label / note / enabled และ "ออก token ใหม่" (rotate)
  update(id, { label, note, enabled, rotate }) {
    const store = load();
    const rec = store.tokens.find((t) => t.id === id);
    if (!rec) return null;
    if (label !== undefined) rec.label = String(label).trim() || rec.label;
    if (note !== undefined) rec.note = String(note).trim();
    if (enabled !== undefined) rec.enabled = !!enabled;
    if (rotate) {
      rec.token = crypto.randomBytes(24).toString('hex');
      rec.rotatedAt = new Date().toISOString();
    }
    save();
    return rec;
  },

  remove(id) {
    const store = load();
    const i = store.tokens.findIndex((t) => t.id === id);
    if (i === -1) return false;
    store.tokens.splice(i, 1);
    save();
    return true;
  },

  // นับการใช้งาน — เขียนลงไฟล์แบบหน่วง กันเขียนถี่ทุก request
  recordUse(id) {
    const rec = load().tokens.find((t) => t.id === id);
    if (!rec) return;
    rec.lastUsedAt = new Date().toISOString();
    rec.useCount = (rec.useCount || 0) + 1;
    dirty = true;
  },
};

// flush สถิติการใช้งานทุก 30 วินาที
setInterval(() => {
  if (dirty && cache) {
    try { save(); } catch (e) { console.error('บันทึกสถิติ token ไม่สำเร็จ:', e.message); }
  }
}, 30000).unref();
