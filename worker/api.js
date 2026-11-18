// 管理面板 JSON API
// 路由：
//   POST /__api/login      登录
//   POST /__api/logout     退出
//   GET  /__api/me         当前状态
//   GET  /__api/files      列出全部文件（含内容）
//   GET  /__api/tree       文件树
//   GET  /__api/file?path= 读取单个文件
//   PUT  /__api/file       写入文件 { path, content, binary? }
//   DELETE /__api/file?path= 删除文件
//   POST /__api/upload     上传文件（multipart 或 base64 JSON）
//   POST /__api/run        在线运行一段 PHP（调试用）

import { json } from './utils.js';
import * as store from './store.js';
import { executePhp } from './php-engine.js';
import {
  isAuthorized, makeToken, cookieHeader, clearCookieHeader,
} from './auth.js';
import { getSecret } from './store.js';

async function issueSession(env) {
  const secret = await getSecret(env);
  const token = makeToken(secret);
  return json({ ok: true, token }, 200, { 'Set-Cookie': cookieHeader(token) });
}

export async function handleApi(request, env, url, route) {
  const method = request.method;

  // ---------- 首次使用：设置管理员密码（仅当密码未设置时可用） ----------
  if (route === '/setup' && method === 'POST') {
    const existing = await store.getPasswordHash(env);
    if (existing) return json({ ok: false, error: '密码已设置，请直接登录' }, 403);
    let password = '';
    try { password = (await request.json()).password || ''; } catch { /* ignore */ }
    if (typeof password !== 'string' || password.length < 6) {
      return json({ ok: false, error: '密码至少 6 位' }, 400);
    }
    await store.setPassword(env, password, false);
    return issueSession(env);
  }

  // ---------- 登录（无需鉴权） ----------
  if (route === '/login' && method === 'POST') {
    let password = '';
    try {
      const body = await request.json();
      password = body.password || '';
    } catch {
      const form = await request.formData().catch(() => null);
      password = form?.get('password') || '';
    }
    if (!await store.verifyPassword(env, password)) {
      return json({ ok: false, error: '密码错误' }, 401);
    }
    return issueSession(env);
  }

  // 未登录时：判断是否首次使用（密码尚未设置），让前端显示「设置管理员密码」
  if (!await isAuthorized(request, env)) {
    const needSetup = !(await store.getPasswordHash(env));
    return json({
      ok: false,
      error: needSetup ? '首次使用，请设置管理员密码' : '未登录或会话已过期',
      needLogin: true,
      needSetup,
    }, 401);
  }

  if (route === '/logout' && method === 'POST') {
    return json({ ok: true }, 200, { 'Set-Cookie': clearCookieHeader() });
  }

  if (route === '/me') {
    const smtp = await store.getSmtp(env);
    return json({
      ok: true,
      phpVersion: '8.3',
      authenticated: true,
      smtpConfigured: !!(smtp && smtp.host && smtp.user),
    });
  }

  // ---------- 修改密码（轮换会话密钥，其它设备自动下线） ----------
  if (route === '/password' && method === 'POST') {
    let body;
    try { body = await request.json(); } catch { return json({ ok: false, error: 'JSON 解析失败' }, 400); }
    const { current, next } = body || {};
    if (!await store.verifyPassword(env, current || '')) {
      return json({ ok: false, error: '当前密码不正确' }, 403);
    }
    if (typeof next !== 'string' || next.length < 6) {
      return json({ ok: false, error: '新密码至少 6 位' }, 400);
    }
    await store.setPassword(env, next, true);
    return issueSession(env);
  }

  // ---------- SMTP / 发信设置（图形化配置 QQ 邮箱等） ----------
  if (route === '/settings' && method === 'GET') {
    const smtp = (await store.getSmtp(env)) || {};
    return json({
      ok: true,
      smtp: {
        host: smtp.host || '',
        port: smtp.port || 465,
        user: smtp.user || '',
        pass: smtp.pass ? '••••••' : '',   // 不回传明文
        hasPass: !!smtp.pass,
        from: smtp.from || '',
      },
    });
  }

  if (route === '/settings' && method === 'PUT') {
    let body;
    try { body = await request.json(); } catch { return json({ ok: false, error: 'JSON 解析失败' }, 400); }
    const s = body.smtp || {};
    const old = (await store.getSmtp(env)) || {};
    const cfg = {
      host: String(s.host || '').trim(),
      port: Number(s.port) || 465,
      user: String(s.user || '').trim(),
      // 密码留空表示保持不变
      pass: s.pass && s.pass !== '••••••' ? String(s.pass) : (old.pass || ''),
      from: String(s.from || '').trim(),
    };
    await store.setSmtp(env, cfg);
    return json({ ok: true });
  }

  if (route === '/files' && method === 'GET') {
    const files = await store.listFiles(env);
    return json({ ok: true, files });
  }

  if (route === '/tree' && method === 'GET') {
    const paths = await store.listFilePaths(env);
    return json({ ok: true, tree: store.buildTree(paths) });
  }

  if (route === '/file') {
    const path = url.searchParams.get('path') || '/index.php';
    if (method === 'GET') {
      const file = await store.readFile(env, path);
      if (!file) return json({ ok: false, error: '文件不存在' }, 404);
      return json({ ok: true, file });
    }
    if (method === 'PUT') {
      let body;
      try { body = await request.json(); }
      catch { return json({ ok: false, error: '请求体必须是 JSON' }, 400); }
      const content = body.content ?? '';
      if (typeof content !== 'string') return json({ ok: false, error: 'content 必须是字符串' }, 400);
      const meta = await store.writeFile(env, path, content, {
        binary: !!body.binary,
        mime: body.mime,
      });
      // 自动补全首页：首次创建 index.php 时写入示例内容由前端负责
      return json({ ok: true, file: meta });
    }
    if (method === 'DELETE') {
      await store.deleteFile(env, path);
      return json({ ok: true });
    }
  }

  if (route === '/upload' && method === 'POST') {
    const contentType = request.headers.get('content-type') || '';
    // JSON 方式：{ files: [{ path, content(base64), binary }] }
    if (contentType.includes('application/json')) {
      let body;
      try { body = await request.json(); }
      catch { return json({ ok: false, error: 'JSON 解析失败' }, 400); }
      const incoming = Array.isArray(body.files) ? body.files : [];
      const written = [];
      for (const f of incoming) {
        const meta = await store.writeFile(env, f.path, f.content ?? '', {
          binary: !!f.binary, mime: f.mime,
        });
        written.push(meta);
      }
      return json({ ok: true, written });
    }
    // multipart 方式
    const form = await request.formData().catch(() => null);
    if (!form) return json({ ok: false, error: '上传失败' }, 400);
    const written = [];
    for (const [name, value] of form.entries()) {
      if (typeof value === 'string') continue;
      const dir = form.get('dir') || '/';
      const filePath = (dir === '/' ? '' : dir) + '/' + name;
      const bytes = new Uint8Array(await value.arrayBuffer());
      const b64 = bytesToBase64(bytes);
      const meta = await store.writeFile(env, filePath, b64, {
        binary: true, mime: value.type || 'application/octet-stream',
      });
      written.push(meta);
    }
    return json({ ok: true, written });
  }

  if (route === '/init' && method === 'POST') {
    // 初始化默认站点（如果站点为空）
    const existing = await store.listFilePaths(env);
    if (existing.length > 0) {
      return json({ ok: false, error: '站点已有文件，跳过初始化' }, 400);
    }
    for (const f of DEFAULT_SITE) {
      await store.writeFile(env, f.path, f.content, { mime: f.mime });
    }
    return json({ ok: true, written: DEFAULT_SITE.map((f) => f.path) });
  }

  if (route === '/run' && method === 'POST') {
    // 在线执行一段 PHP 代码（调试控制台）
    let body;
    try { body = await request.json(); }
    catch { return json({ ok: false, error: 'JSON 解析失败' }, 400); }
    let code = body.code || '';
    if (!code.includes('<?php')) code = '<?php\n' + code;
    const files = await store.listFiles(env);
    const fakeUrl = new URL(body.path || '/__run.php', url.origin);
    const fakeReq = new Request(fakeUrl, { method: 'POST' });
    try {
      const result = await executePhp({
        files: files.map((f) => ({ path: f.path, content: f.content, binary: f.binary })),
        targetPath: '/__run.php',
        request: fakeReq,
        url: fakeUrl,
        bodyText: '',
        inlineCode: code,
        env,
      });
      return json({ ok: true, output: result.body, headers: result.headers, mail: result.mailResults });
    } catch (e) {
      return json({ ok: false, error: e?.message || String(e) }, 500);
    }
  }

  return json({ ok: false, error: '接口不存在' }, 404);
}

function bytesToBase64(bytes) {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

const DEFAULT_SITE = [
  {
    path: '/index.php',
    mime: 'text/html',
    content: `<?php
$name = $_GET['name'] ?? '世界';
?>
<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>我的 EdgeHost 站点</title>
<style>
*{box-sizing:border-box}body{margin:0;font-family:system-ui,sans-serif;background:linear-gradient(135deg,#0f1420,#1a2340);color:#e7ecf3;min-height:100vh;display:flex;align-items:center;justify-content:center;text-align:center}
.card{padding:56px;max-width:600px}h1{font-size:44px;margin:0 0 8px;background:linear-gradient(90deg,#60a5fa,#a78bfa);-webkit-background-clip:text;color:transparent}
p{color:#aeb9cc;line-height:1.8}.badge{display:inline-block;background:#1e293b;border:1px solid #334155;padding:6px 14px;border-radius:20px;font-size:13px;color:#93c5fd;margin-bottom:24px}
code{background:#0b0f18;padding:2px 8px;border-radius:5px;color:#7dd3fc}
a{color:#60a5fa}
</style>
</head>
<body>
<div class="card">
<div class="badge">⚡ 由 Cloudflare Workers + PHP-WASM 驱动</div>
<h1>你好，<?= htmlspecialchars($name) ?>！</h1>
<p>这是你的 PHP 虚拟主机首页。它运行在 Cloudflare 全球边缘节点上，<strong>没有服务器、没有容器</strong>。</p>
<p>PHP 版本：<code><?= PHP_VERSION ?></code></p>
<p>试试访问 <a href="/?name=EdgeHost">/?name=EdgeHost</a> · <a href="/api-demo.php">外网 API 请求演示</a></p>
</div>
</body>
</html>`,
  },
  {
    path: '/info.php',
    mime: 'text/html',
    content: `<?php
header('Content-Type', 'text/html; charset=utf-8');
echo '<h1>PHP 信息</h1>';
echo '<pre>';
echo 'PHP 版本: ' . PHP_VERSION . "\\n";
echo '运行平台: ' . PHP_OS . "\\n";
echo 'SERVER_NAME: ' . ($_SERVER['SERVER_NAME'] ?? '-') . "\\n";
echo 'REQUEST_URI: ' . ($_SERVER['REQUEST_URI'] ?? '-') . "\\n";
echo '静态方法列表:\\n';
echo '  json_encode / json_decode: ' . (function_exists('json_encode') ? '可用' : '不可用') . "\\n";
echo '  parse_str: ' . (function_exists('parse_str') ? '可用' : '不可用') . "\\n";
echo '</pre>';
`,
  },
  {
    path: '/api-demo.php',
    mime: 'text/html',
    content: `<?php
// 演示：PHP 直连外网 API（与真实虚拟主机行为一致）
$apis = [
    ['title' => '本机出口 IP', 'url' => 'https://api.ipify.org?format=json'],
    ['title' => 'Zen 语录(GitHub)', 'url' => 'https://api.github.com/zen'],
    ['title' => '公开测试接口', 'url' => 'https://postman-echo.com/get?from=edgehost'],
];
?><!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>外网请求演示</title>
<style>body{font-family:system-ui;background:#0f1420;color:#e7ecf3;padding:40px}h1{font-size:26px}.item{background:#1a2340;border:1px solid #334155;border-radius:10px;padding:16px;margin:14px 0}.item h3{margin:0 0 8px;font-size:15px;color:#93c5fd}pre{background:#0b0f18;padding:10px;border-radius:6px;overflow:auto;color:#7dd3fc}a{color:#60a5fa}</style></head>
<body><h1>⚡ PHP 直连外网 API 演示</h1>
<p>以下数据由 PHP 通过 cf_http() 实时请求外网获得：</p>
<?php foreach ($apis as $a): ?>
<div class="item"><h3><?= htmlspecialchars($a['title']) ?></h3>
<pre><?php
    $r = cf_http($a['url']);
    echo 'HTTP ' . $r['status'] . "\\n";
    echo htmlspecialchars(substr($r['body'], 0, 500));
?></pre></div>
<?php endforeach; ?>
<p><a href="/">← 返回首页</a></p>
</body></html>`,
  },
];
