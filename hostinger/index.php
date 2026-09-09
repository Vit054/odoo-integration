<?php
/**
 * CFF Odoo API proxy — https://flowtica.link/odoo-api/  ->  VPS (monitor.flowtica.link/odoo/)
 *
 * ทำไมต้องมีตัวนี้:
 *   - ทีมภายนอกเรียกโดเมนเดียวกับเว็บบริษัท ไม่ต้องรู้ IP ของ VPS
 *   - เครือข่ายออฟฟิศบล็อก HTTPS ตรงไป IP ของ VPS แต่ต่อ flowtica.link ได้ปกติ
 *     (Hostinger ยิงแบบ server-to-server จึงไม่ติด firewall ออฟฟิศ)
 *
 * ตัว proxy ไม่ตรวจสิทธิ์เอง — แค่ส่ง Authorization: Bearer ของผู้เรียกต่อไปให้แอปบน VPS
 * ตรวจ แล้วแนบ X-Proxy-Secret เพิ่มเพื่อพิสูจน์ว่ามาจากทางนี้จริง
 * ค่าเชื่อมต่ออยู่ใน config.php (ไม่อยู่ใน git + กัน deploy ทับด้วย PRESERVE_DIRS)
 */

$cfgFile = __DIR__ . '/config.php';
if (!is_file($cfgFile)) {
    http_response_code(500);
    header('Content-Type: application/json; charset=utf-8');
    exit(json_encode(['success' => false, 'error' => 'ยังไม่ได้ตั้งค่า: ไม่พบ config.php'], JSON_UNESCAPED_UNICODE));
}
require $cfgFile;

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

$path = isset($_GET['__p']) ? ltrim((string) $_GET['__p'], '/') : '';
if (strpos($path, '..') !== false) {
    http_response_code(400);
    exit(json_encode(['success' => false, 'error' => 'bad path'], JSON_UNESCAPED_UNICODE));
}

// เปิดหน้าเปล่า ๆ = บอกวิธีใช้สั้น ๆ (ไม่แตะ upstream)
if ($path === '') {
    exit(json_encode([
        'name'     => 'CFF Odoo API',
        'base_url' => 'https://flowtica.link/odoo-api',
        'auth'     => 'ทุก request ต้องมี header: Authorization: Bearer <token>',
        'endpoints' => [
            'GET  /api/odoo/tables',
            'GET  /api/odoo/schema/{table}',
            'POST /api/odoo/query  {"sql":"SELECT ..."}',
        ],
    ], JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT));
}

$query = $_GET;
unset($query['__p']);
$url = rtrim(ODOO_UPSTREAM, '/') . '/' . $path;
if ($query) {
    $url .= '?' . http_build_query($query);
}

// ---- header ที่ส่งต่อ ----
$headers = ['X-Proxy-Secret: ' . ODOO_PROXY_SECRET];
$auth = null;
if (!empty($_SERVER['HTTP_AUTHORIZATION'])) {
    $auth = $_SERVER['HTTP_AUTHORIZATION'];
} elseif (!empty($_SERVER['REDIRECT_HTTP_AUTHORIZATION'])) {
    $auth = $_SERVER['REDIRECT_HTTP_AUTHORIZATION'];
}
if ($auth !== null) {
    $headers[] = 'Authorization: ' . $auth;
}
$headers[] = 'Content-Type: ' . ($_SERVER['CONTENT_TYPE'] ?? 'application/json');
$headers[] = 'Accept: application/json';
// ส่ง IP ผู้เรียกจริงต่อไปด้วย ไม่งั้น log ฝั่ง VPS เห็นแต่ IP ของ Hostinger (ตรวจย้อนหลังไม่ได้)
// ใช้ชื่อ X-Client-IP เพราะ Caddy บน VPS จะเขียนทับ X-Forwarded-For ที่มาจากต้นทางที่ไม่ได้ประกาศเป็น trusted proxy
$headers[] = 'X-Client-IP: ' . ($_SERVER['REMOTE_ADDR'] ?? 'unknown');

$method = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');
$body = in_array($method, ['POST', 'PUT', 'PATCH'], true) ? file_get_contents('php://input') : null;

$ch = curl_init($url);
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_CONNECTTIMEOUT => 15,
    CURLOPT_TIMEOUT        => 90,   // /query ฝั่ง VPS มี statement_timeout 20 วิอยู่แล้ว
    CURLOPT_FOLLOWLOCATION => false,
    CURLOPT_CUSTOMREQUEST  => $method,
    CURLOPT_HTTPHEADER     => $headers,
]);
if ($body !== null && $body !== '') {
    curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
}

$out   = curl_exec($ch);
$code  = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
$ctype = (string) curl_getinfo($ch, CURLINFO_CONTENT_TYPE);
$err  = curl_error($ch);
curl_close($ch);

if ($out === false || $code === 0) {
    http_response_code(502);
    exit(json_encode([
        'success' => false,
        'error'   => 'ต่อเซิร์ฟเวอร์ API ไม่ได้: ' . ($err ?: 'ไม่ทราบสาเหตุ'),
    ], JSON_UNESCAPED_UNICODE));
}

http_response_code($code);
header("Content-Type: " . ($ctype ?: "application/json; charset=utf-8"));
echo $out;
