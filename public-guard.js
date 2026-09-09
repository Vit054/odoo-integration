// หน้าด่านสำหรับ "โหมดเปิดสาธารณะ" (PUBLIC_MODE=1) — ใช้ตอน deploy บน VPS ที่ออกอินเทอร์เน็ต
// บน intranet (192.168.101.104) ไม่ต้องเปิดโหมดนี้ พฤติกรรมเดิมทุกอย่าง
//
// ป้องกัน 4 ชั้น:
//   1) เปิดเฉพาะ endpoint ชุดที่แจกทีมภายนอก (tables / schema / query / insert) — ที่เหลือ 404
//   2) ทุก request ต้องมี Authorization: Bearer <token> (แจก token แยกรายทีม เพิกถอนรายทีมได้)
//   3) ถ้าตั้ง PROXY_SECRET ไว้ ต้องมี header X-Proxy-Secret ตรงกัน (กันคนยิงข้าม proxy)
//   4) จำกัดจำนวน request ต่อนาที ต่อ token+IP
// ทุก request ถูก log ชื่อทีม/เมธอด/พาธ/สถานะ ไว้ใน journald (journalctl -u odoo-api)

const ALLOWED_PATHS = [
  /^\/tables\/?$/,
  /^\/schema\/[a-z0-9_]+\/?$/i,
  /^\/query\/?$/,
  /^\/insert\/[a-z0-9_]+\/?$/i,
];

// API_TOKENS="ทีมA:token1,ทีมB:token2"  (ใส่แค่ token เฉย ๆ ก็ได้ ชื่อจะเป็น token-1, token-2)
function parseTokens(raw) {
  return String(raw || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((pair, i) => {
      const idx = pair.lastIndexOf(':');
      if (idx > 0) return { label: pair.slice(0, idx), token: pair.slice(idx + 1) };
      return { label: `token-${i + 1}`, token: pair };
    })
    .filter((t) => t.token.length >= 16); // กัน token สั้นเกินไปจนเดาได้
}

// เทียบ token แบบไม่รั่วเวลา (timing-safe)
const crypto = require('crypto');
function sameToken(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  if (x.length !== y.length) return false;
  return crypto.timingSafeEqual(x, y);
}

// นับ request แบบ sliding window ในหน่วยความจำ (ไม่พึ่ง dependency เพิ่ม)
const hits = new Map();
function rateLimited(key, perMin) {
  const now = Date.now();
  const windowStart = now - 60000;
  const list = (hits.get(key) || []).filter((t) => t > windowStart);
  list.push(now);
  hits.set(key, list);
  return list.length > perMin;
}
setInterval(() => {
  const cutoff = Date.now() - 60000;
  for (const [k, list] of hits) {
    const keep = list.filter((t) => t > cutoff);
    if (keep.length === 0) hits.delete(k); else hits.set(k, keep);
  }
}, 60000).unref();

function createPublicGuard() {
  const tokens = parseTokens(process.env.API_TOKENS);
  const proxySecret = process.env.PROXY_SECRET || '';
  const perMin = parseInt(process.env.RATE_LIMIT_PER_MIN, 10) || 60;

  if (tokens.length === 0) {
    throw new Error('PUBLIC_MODE=1 แต่ยังไม่ได้ตั้ง API_TOKENS — ไม่ยอมเปิดบริการโดยไม่มี token');
  }
  console.log(`✓ โหมดสาธารณะ: ${tokens.length} token (${tokens.map((t) => t.label).join(', ')}), ` +
    `จำกัด ${perMin} req/นาที, proxy secret ${proxySecret ? 'เปิด' : 'ปิด'}`);

  return function publicGuard(req, res, next) {
    const started = Date.now();
    const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.ip;

    if (!ALLOWED_PATHS.some((re) => re.test(req.path))) {
      return res.status(404).json({ success: false, error: 'ไม่มี endpoint นี้ในชุดสาธารณะ' });
    }
    if (proxySecret && req.headers['x-proxy-secret'] !== proxySecret) {
      console.warn(`[api] ปฏิเสธ (proxy secret ไม่ตรง) ${req.method} ${req.path} จาก ${ip}`);
      return res.status(403).json({ success: false, error: 'ต้องเรียกผ่าน https://flowtica.link/odoo-api/' });
    }

    const h = req.headers.authorization || '';
    const provided = h.startsWith('Bearer ') ? h.slice(7).trim() : '';
    const match = provided && tokens.find((t) => sameToken(t.token, provided));
    if (!match) {
      console.warn(`[api] ปฏิเสธ (token ไม่ถูกต้อง) ${req.method} ${req.path} จาก ${ip}`);
      return res.status(401).json({ success: false, error: 'ต้องส่ง Authorization: Bearer <token>' });
    }

    if (rateLimited(`${match.label}|${ip}`, perMin)) {
      console.warn(`[api] ชนลิมิต ${match.label} จาก ${ip}`);
      return res.status(429).json({ success: false, error: `เรียกเกิน ${perMin} ครั้ง/นาที` });
    }

    req.apiClient = match.label;
    res.on('finish', () => {
      console.log(`[api] ${match.label} ${ip} ${req.method} ${req.originalUrl} ` +
        `→ ${res.statusCode} (${Date.now() - started}ms)`);
    });
    next();
  };
}

module.exports = { createPublicGuard, ALLOWED_PATHS };
