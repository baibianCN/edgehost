// PHP 执行引擎：把 KV 中的虚拟文件挂载进 php-wasm 的临时文件系统并执行目标脚本
// 依赖 php-cloud-wasm（PHP 编译为 WebAssembly，在 Workers V8 isolate 内运行）

import { PhpCloudflare } from 'php-cloud-wasm/php8.3-cloudflare.mjs';
import { connect } from 'cloudflare:sockets';
import { dirname } from './utils.js';
import { getSmtp } from './store.js';

const WEB_ROOT = '/www';

// 在每次请求开始时注入的请求上下文（$_SERVER / $_GET / $_POST / $_COOKIE 等）
const BOOTSTRAP = `<?php
error_reporting(E_ALL);
ini_set('display_errors', '1');

$GLOBALS['__cf_ctx'] = json_decode(vrzno_shared('ctx') ?: '{}', true) ?: [];
$_SERVER = $GLOBALS['__cf_ctx']['server'] ?? [];
$_GET    = $GLOBALS['__cf_ctx']['get'] ?? [];
$_POST   = $GLOBALS['__cf_ctx']['post'] ?? [];
$_COOKIE = $GLOBALS['__cf_ctx']['cookie'] ?? [];
$_FILES  = [];
$_REQUEST = array_merge($_GET, $_POST);

if (in_array(strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET'), ['POST','PUT','PATCH','DELETE'])) {
    $raw = $GLOBALS['__cf_ctx']['body'] ?? '';
    $ct  = strtolower($_SERVER['CONTENT_TYPE'] ?? '');
    if (strpos($ct, 'application/json') !== false) {
        $j = json_decode($raw, true);
        if (is_array($j)) { $_POST = $j; $_REQUEST = array_merge($_GET, $_POST); }
    } elseif (strpos($ct, 'application/x-www-form-urlencoded') !== false) {
        parse_str($raw, $p); $_POST = $p; $_REQUEST = array_merge($_GET, $_POST);
    }
}

// 让 echo/print 正常输出；把 notices/warnings 也显示出来方便调试
// 让 include/require 的相对/缺省路径以站点根为准，贴近真实虚拟主机行为
set_include_path('/www' . PATH_SEPARATOR . get_include_path());

set_error_handler(function ($no, $str, $file, $line) {
    echo "\\n<div class='php-diag' style='font:12px monospace;color:#c0392b;background:#fff3f3;padding:6px 10px;border-left:3px solid #c0392b;margin:4px 0'>";
    echo '[PHP ' . $no . '] ' . htmlspecialchars($str) . ' @ line ' . $line;
    echo "</div>\\n";
    return true;
});

// 供用户脚本调用的辅助函数：显式设置 HTTP 响应头（写入输出元信息）
if (!function_exists('cf_header')) {
    function cf_header($header) {
        echo "\\n<!--CFHEAD:" . str_replace("-->", "", $header) . "-->\\n";
    }
}

// ==================== 外网 HTTP 桥（基于 Vrzno fetch） ====================
// 部署到 Cloudflare 后，PHP 可自由请求任意 HTTP/HTTPS API。
// 本地 dev 环境下目标须在白名单/同网络，详见 README。
if (!function_exists('cf_http')) {
    /**
     * 发起 HTTP 请求。$opts 可含 method/headers/body，对应 fetch 的 RequestInit。
     * 返回 ['status'=>int,'ok'=>bool,'body'=>string,'headers'=>array]
     */
    function cf_http($url, $opts = []) {
        $v = new Vrzno();
        $fetch = $v->fetch;
        // Vrzno 把 PHP 数组转为 JS 数组，关联数组会丢键名；
        // 因此 headers 统一转成 [[k,v],...] 序列格式（fetch 标准支持）
        if (isset($opts['headers']) && is_array($opts['headers'])) {
            $h = [];
            foreach ($opts['headers'] as $k => $val) { $h[] = [$k, $val]; }
            $opts['headers'] = $h;
        }
        $resp = vrzno_await($fetch($url, $opts));
        return [
            'status' => (int)$resp->status,
            'ok'     => (bool)$resp->ok,
            'body'   => vrzno_await($resp->text()),
        ];
    }
    function http_get($url, $headers = []) {
        return cf_http($url, ['method' => 'GET', 'headers' => $headers]);
    }
    function http_post($url, $body = '', $headers = []) {
        return cf_http($url, ['method' => 'POST', 'body' => $body, 'headers' => $headers]);
    }
    function http_json($url, $data, $headers = []) {
        $headers['Content-Type'] = 'application/json';
        $r = cf_http($url, ['method' => 'POST', 'body' => json_encode($data), 'headers' => $headers]);
        $r['json'] = json_decode($r['body'], true);
        return $r;
    }
}

// ==================== QQ 邮箱 / SMTP 发信桥 ====================
// PHP 侧调用 cf_mail()，实际由 Workers 侧的 cloudflare:sockets TCP 连接完成 SMTP 会话。
// 需在环境变量配置：SMTP_HOST/SMTP_PORT/SMTP_USER/SMTP_PASS(QQ邮箱为授权码)。
if (!function_exists('cf_mail')) {
    /**
     * 发送邮件。返回 true 或抛出带原因的异常。
     * $opt 可含 from/name/html/charset
     */
    function cf_mail($to, $subject, $body, $opt = []) {
        $req = [
            'to'      => $to,
            'subject' => $subject,
            'body'    => $body,
            'from'    => $opt['from']  ?? '',
            'name'    => $opt['name']  ?? '',
            'html'    => $opt['html']  ?? false,
        ];
        echo "\\n<!--CFMAIL:" . base64_encode(json_encode($req)) . "-->\\n";
        return true;
    }
}
`;

function buildContext(url, request, bodyText) {
  const headers = {};
  request.headers.forEach((v, k) => { headers[k] = v; });
  const server = {
    REQUEST_METHOD: request.method,
    REQUEST_URI: url.pathname + url.search,
    SCRIPT_NAME: url.pathname,
    PHP_SELF: url.pathname,
    DOCUMENT_ROOT: WEB_ROOT,
    SERVER_NAME: url.hostname,
    SERVER_PORT: url.port || (url.protocol === 'https:' ? '443' : '80'),
    REQUEST_SCHEME: url.protocol.replace(':', ''),
    HTTPS: url.protocol === 'https:' ? 'on' : 'off',
    HTTP_HOST: url.host,
    QUERY_STRING: url.search.replace(/^\?/, ''),
    CONTENT_TYPE: request.headers.get('content-type') || '',
    CONTENT_LENGTH: String(bodyText ? bodyText.length : 0),
    REMOTE_ADDR: request.headers.get('cf-connecting-ip') || '',
    HTTP_USER_AGENT: request.headers.get('user-agent') || '',
    HTTP_ACCEPT: request.headers.get('accept') || '',
    HTTP_ACCEPT_LANGUAGE: request.headers.get('accept-language') || '',
    HTTP_COOKIE: request.headers.get('cookie') || '',
    HTTP_REFERER: request.headers.get('referer') || '',
    ...headers,
  };
  const get = {};
  for (const [k, v] of url.searchParams.entries()) {
    if (k.endsWith('[]')) {
      const key = k.slice(0, -2);
      (get[key] ||= []).push(v);
    } else get[k] = v;
  }
  const cookie = {};
  const cookieHeader = request.headers.get('cookie') || '';
  for (const pair of cookieHeader.split(';')) {
    const idx = pair.indexOf('=');
    if (idx > 0) cookie[pair.slice(0, idx).trim()] = decodeURIComponentSafe(pair.slice(idx + 1).trim());
  }
  return { server, get, cookie, body: bodyText || '' };
}

function decodeURIComponentSafe(s) { try { return decodeURIComponent(s); } catch { return s; } }

function base64ToBytes(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function ensureDir(php, dir) {
  if (!dir || dir === '/') return;
  const parts = dir.split('/').filter(Boolean);
  let cur = '';
  for (const part of parts) {
    cur += '/' + part;
    try { await php.mkdir(cur); } catch { /* 已存在则忽略 */ }
  }
}

/**
 * 执行站点 PHP 脚本
 * @param {Object} params
 * @param {Array} params.files 站点全部文件 [{path, content, binary}]
 * @param {string} params.targetPath 目标脚本虚拟路径，如 /index.php
 * @param {Request} params.request
 * @param {URL} params.url
 * @param {string} params.bodyText 请求体文本
 * @param {string} [params.inlineCode] 直接执行的代码（调试控制台用），提供时忽略 targetPath
 * @param {Object} params.env Workers 环境变量（SMTP 配置等）
 * @returns {Promise<{body:string, headers:Object, exitCode:number, mailResults?:Array}>}
 */
export async function executePhp({ files, targetPath, request, url, bodyText, inlineCode, env }) {
  const ctx = buildContext(url, request, bodyText);
  const php = new PhpCloudflare({
    shared: { ctx: JSON.stringify(ctx) },
  });

  let output = '';
  php.addEventListener('output', (e) => { output += Array.isArray(e.detail) ? e.detail.join('') : String(e.detail); });

  // 1) 挂载全部站点文件到 PHP 的临时 FS，保证 include/require 可用
  for (const f of files) {
    const full = WEB_ROOT + f.path;
    await ensureDir(php, dirname(full));
    const data = f.binary ? base64ToBytes(f.content) : f.content;
    await php.writeFile(full, data);
  }
  await ensureDir(php, WEB_ROOT + dirname(targetPath));

  // 2) 注入请求上下文 + 切换到脚本目录 + 引入目标文件
  //    若提供了 inlineCode（在线调试），则直接执行它
  const fullTarget = WEB_ROOT + targetPath;
  // inlineCode 若自带 <?php 标签需去掉，因为 BOOTSTRAP 已经开启了 PHP 模式
  const entry = inlineCode
    ? inlineCode.replace(/^\s*<\?(php)?/i, '')
    : `require ${JSON.stringify(fullTarget)};`;
  const runCode = BOOTSTRAP +
    `\nchdir(${JSON.stringify(WEB_ROOT + dirname(targetPath))});\n` +
    entry;

  const exitCode = await php.run(runCode);

  // 3) 解析通过 cf_header() / cf_mail() 输出的标记
  const headers = {};
  const mailRequests = [];
  const lines = output.split('\n');
  const bodyLines = [];
  for (const line of lines) {
    let m = line.match(/<!--CFHEAD:(.*?)-->/);
    if (m) {
      const h = m[1].trim();
      const ci = h.indexOf(':');
      if (ci > 0) headers[h.slice(0, ci).trim()] = h.slice(ci + 1).trim();
      continue;
    }
    m = line.match(/<!--CFMAIL:([A-Za-z0-9+/=]+)-->/);
    if (m) {
      try {
        mailRequests.push(JSON.parse(atob(m[1])));
      } catch { /* 忽略格式错误的邮件请求 */ }
      continue;
    }
    bodyLines.push(line);
  }

  // 4) 依次发送邮件（SMTP over TCP，由 Workers socket 完成）
  // 配置来源：面板里图形化设置的 SMTP（存于 Durable Object）优先，环境变量兜底
  const mailResults = [];
  const savedSmtp = env ? await getSmtp(env) : null;
  for (const req of mailRequests) {
    try {
      const info = await sendMail(req, env, savedSmtp);
      mailResults.push({ ok: true, to: req.to, info });
    } catch (e) {
      mailResults.push({ ok: false, to: req.to, error: e?.message || String(e) });
    }
  }

  return {
    body: bodyLines.join('\n'),
    headers,
    exitCode: Number(exitCode) || 0,
    mailResults,
  };
}

/* ==================== SMTP 客户端（Workers TCP socket） ==================== */

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

function b64(s) { return btoa(String(s)); }

async function smtpReadLine(reader, buffer) {
  // 读取到 \n 为止，返回单行文本
  for (;;) {
    const idx = buffer.indexOf(10); // \n
    if (idx >= 0) {
      const line = textDecoder.decode(new Uint8Array(buffer.slice(0, idx))).replace(/\r$/, '');
      buffer.splice(0, idx + 1);
      return line;
    }
    const { value, done } = await reader.read();
    if (done) throw new Error('SMTP 连接被服务器关闭');
    for (const b of value) buffer.push(b);
  }
}

async function smtpSend(writer, line) {
  await writer.write(textEncoder.encode(line + '\r\n'));
}

async function readSmtpResponse(reader, buffer) {
  // SMTP 响应可能多行，格式 "250-..." / "250 ..."，读取到 "NNN " 结尾
  let full = '';
  for (;;) {
    const line = await smtpReadLine(reader, buffer);
    full += line + '\n';
    if (/^\d{3} /.test(line)) return full.trimEnd();
  }
}

async function expectOk(reader, buffer, expect, what) {
  const resp = await readSmtpResponse(reader, buffer);
  const code = parseInt(resp.slice(0, 3), 10);
  const wanted = Array.isArray(expect) ? expect : [expect];
  if (!wanted.includes(code)) {
    throw new Error(`${what} 失败: ${resp}`);
  }
  return resp;
}

/**
 * 通过 cloudflare:sockets 走完整 SMTP 会话发信。
 * @param {Object} req {to,subject,body,from?,name?,html?}
 * @param {Object} env Workers 环境（兜底环境变量 SMTP_*）
 * @param {Object} [saved] 面板里配置的 SMTP（优先）
 */
export async function sendMail(req, env, saved) {
  const host = saved?.host || env.SMTP_HOST || env.MAIL_HOST || '';
  const port = Number(saved?.port || env.SMTP_PORT || env.MAIL_PORT || 465);
  const user = saved?.user || env.SMTP_USER || env.MAIL_USER || '';
  const pass = saved?.pass || env.SMTP_PASS || env.MAIL_PASS || '';
  if (!host || !user || !pass) {
    throw new Error('未配置 SMTP：请在管理面板「设置」页填写邮箱信息');
  }

  const from = req.from || user;
  const fromName = req.name || 'EdgeHost';
  const to = req.to;
  const subject = `=?UTF-8?B?${b64(req.subject)}?=`;

  // 构造邮件体（含 MIME 头）
  const ctype = req.html ? 'text/html' : 'text/plain';
  const mime =
`From: =?UTF-8?B?${b64(fromName)}?= <${from}>
To: <${to}>
Subject: ${subject}
MIME-Version: 1.0
Content-Type: ${ctype}; charset=UTF-8
Content-Transfer-Encoding: base64

${b64(req.body)}`;

  const socket = connect(`${host}:${port}`, { secureTransport: 'on', allowHalfOpen: false });
  const reader = socket.readable.getReader();
  const writer = socket.writable.getWriter();
  const buffer = [];

  try {
    await expectOk(reader, buffer, 220, 'SMTP 连接');

    await smtpSend(writer, `EHLO edgehost.worker`);
    await expectOk(reader, buffer, 250, 'EHLO');

    await smtpSend(writer, 'AUTH LOGIN');
    await expectOk(reader, buffer, 334, 'AUTH LOGIN');
    await smtpSend(writer, b64(user));
    await expectOk(reader, buffer, 334, 'SMTP 用户名');
    await smtpSend(writer, b64(pass));
    await expectOk(reader, buffer, 235, 'SMTP 密码认证');

    await smtpSend(writer, `MAIL FROM:<${from}>`);
    await expectOk(reader, buffer, 250, 'MAIL FROM');
    await smtpSend(writer, `RCPT TO:<${to}>`);
    await expectOk(reader, buffer, [250, 251], 'RCPT TO');

    await smtpSend(writer, 'DATA');
    await expectOk(reader, buffer, 354, 'DATA');

    // 点stuffing：行首的 . 要替换成 ..
    const dataLines = mime.split('\n').map((l) => (l.startsWith('.') ? '.' + l : l)).join('\r\n');
    await writer.write(textEncoder.encode(dataLines + '\r\n.\r\n'));
    const sent = await expectOk(reader, buffer, 250, '邮件投递');

    await smtpSend(writer, 'QUIT');
    return sent;
  } finally {
    try { writer.close(); } catch { /* 忽略 */ }
    try { socket.close(); } catch { /* 忽略 */ }
  }
}

export { WEB_ROOT };
