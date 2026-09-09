// หน้าด่านสำหรับ "โหมดเปิดสาธารณะ" (PUBLIC_MODE=1) — ใช้ตอน deploy บน VPS ที่ออกอินเทอร์เน็ต
// บน intranet (192.168.101.104) ไม่ต้องเปิดโหมดนี้ พฤติกรรมเดิมทุกอย่าง
//
// ป้องกัน 4 ชั้น:
//   1) เปิดเฉพาะ endpoint ชุดที่แจกทีมภายนอก (tables / schema / query / insert)
//      + ชุดจัดการ token (/tokens) ที่ตรวจสิทธิ์ด้วย ADMIN_TOKEN ใน router — ที่เหลือ 404
//   2) ทุก request ของทีมภายนอกต้องมี Authorization: Bearer <token> (ดูรายชื่อจาก tokens.json)
//   3) ถ้าตั้ง PROXY_SECRET ไว้ ต้องมี header X-Proxy-Secret ตรงกัน (กันคนยิงข้าม proxy)
//   4) จำกัดจำนวน request ต่อนาที ต่อ token+IP
// ทุก request ถูก log ชื่อทีม/เมธอด/พาธ/สถานะ ไว้ใน journald (journalctl -u odoo-api)

const tokenStore = require('./token-store');

const ALLOWED_PATHS = [
  /^\/tables\/?$/,
  /^\/schema\/[a-z0-9_]+\/?$/i,
  /^\/query\/?$/,
  /^\/insert\/[a-z0-9_]+\/?$/i,
];

// ชุดจัดการ token — ตรวจ ADMIN_TOKEN ที่ router (requireToken) ไม่ใช่ token ของทีมภายนอก
const ADMIN_PATHS = [
  /^\/tokens\/?$/,
  /^\/tokens\/[A-Za-z0-9_-]+\/?$/,
];

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
  const proxySecret = process.env.PROXY_SECRET || '';
  const perMin = parseInt(process.env.RATE_LIMIT_PER_MIN, 10) || 60;
  const adminPerMin = parseInt(process.env.ADMIN_RATE_LIMIT_PER_MIN, 10) || 30;

  const n = tokenStore.list().length;
  if (n === 0) {
    console.warn('⚠ ยังไม่มี token ในระบบ — API ปิดรับทุก request จนกว่าจะสร้าง token ที่หน้า /tokens');
  }
  if (!process.env.ADMIN_TOKEN) {
    console.warn('⚠ ไม่ได้ตั้ง ADMIN_TOKEN — หน้าจัดการ token ใช้ไม่ได้ (และ Write API ปิดสนิท)');
  }
  console.log(`✓ โหมดสาธารณะ: ${n} token, จำกัด ${perMin} req/นาที (แอดมิน ${adminPerMin}), ` +
    `proxy secret ${proxySecret ? 'เปิด' : 'ปิด'}`);

  return function publicGuard(req, res, next) {
    const started = Date.now();
    // X-Client-IP = IP ผู้เรียกจริงที่ proxy ฝั่ง Hostinger แนบมา
    // (ใช้ชื่อนี้เพราะ Caddy เขียนทับ X-Forwarded-For ที่มาจากต้นทางนอก trusted_proxies)
    const ip = req.headers['x-client-ip'] ||
      (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.ip;

    const isAdmin = ADMIN_PATHS.some((re) => re.test(req.path));
    if (!isAdmin && !ALLOWED_PATHS.some((re) => re.test(req.path))) {
      return res.status(404).json({ success: false, error: 'ไม่มี endpoint นี้ในชุดสาธารณะ' });
    }
    if (proxySecret && req.headers['x-proxy-secret'] !== proxySecret) {
      console.warn(`[api] ปฏิเสธ (proxy secret ไม่ตรง) ${req.method} ${req.path} จาก ${ip}`);
      return res.status(403).json({ success: false, error: 'ต้องเรียกผ่าน https://flowtica.link/odoo-api/' });
    }

    // ชุดจัดการ token: จำกัดอัตราแล้วปล่อยให้ router ตรวจ ADMIN_TOKEN เอง
    if (isAdmin) {
      if (rateLimited(`admin|${ip}`, adminPerMin)) {
        console.warn(`[api] แอดมินชนลิมิต จาก ${ip}`);
        return res.status(429).json({ success: false, error: `เรียกเกิน ${adminPerMin} ครั้ง/นาที` });
      }
      res.on('finish', () => {
        console.log(`[api] (แอดมิน) ${ip} ${req.method} ${req.originalUrl} ` +
          `→ ${res.statusCode} (${Date.now() - started}ms)`);
      });
      return next();
    }

    const h = req.headers.authorization || '';
    const provided = h.startsWith('Bearer ') ? h.slice(7).trim() : '';
    const match = tokenStore.findByToken(provided);
    if (!match) {
      console.warn(`[api] ปฏิเสธ (token ไม่ถูกต้องหรือถูกปิด) ${req.method} ${req.path} จาก ${ip}`);
      return res.status(401).json({ success: false, error: 'ต้องส่ง Authorization: Bearer <token>' });
    }

    if (rateLimited(`${match.id}|${ip}`, perMin)) {
      console.warn(`[api] ชนลิมิต ${match.label} จาก ${ip}`);
      return res.status(429).json({ success: false, error: `เรียกเกิน ${perMin} ครั้ง/นาที` });
    }

    req.apiClient = match.label;
    tokenStore.recordUse(match.id);
    res.on('finish', () => {
      console.log(`[api] ${match.label} ${ip} ${req.method} ${req.originalUrl} ` +
        `→ ${res.statusCode} (${Date.now() - started}ms)`);
    });
    next();
  };
}

module.exports = { createPublicGuard, ALLOWED_PATHS, ADMIN_PATHS };
