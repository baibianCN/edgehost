// 主入口：一个 Worker 同时承担
//   1) 管理面板（静态页面 + JSON API）
//   2) 用户站点（把 DO 里的 PHP/HTML 当作虚拟主机运行）
//
// 路由约定：
//   /__admin/*        -> 管理面板
//   /__api/*          -> 管理 API（需鉴权）
//   其它所有路径       -> 用户站点内容

import { json, text, html, normalizePath, extname, mimeType, isBinaryMime } from './utils.js';
import * as store from './store.js';
import { executePhp } from './php-engine.js';
import { handleApi } from './api.js';
import { PANEL_HTML } from './panel.js';

// Durable Object 类必须从 Worker 入口导出
export { FileStore } from './store.js';

const ADMIN_PREFIX = '/__admin';
const API_PREFIX = '/__api';

export default {
  async fetch(request, env, ctx) {
    try {
      const url = new URL(request.url);
      const path = normalizePath(url.pathname);

      // CORS 预检
      if (request.method === 'OPTIONS') {
        return new Response(null, { status: 204 });
      }

      // ---------- 管理 API ----------
      if (path.startsWith(API_PREFIX)) {
        return handleApi(request, env, url, path.slice(API_PREFIX.length) || '/');
      }

      // ---------- 管理面板 ----------
      if (path === ADMIN_PREFIX || path.startsWith(ADMIN_PREFIX + '/')) {
        return html(PANEL_HTML);
      }

      // ---------- 用户站点 ----------
      return await serveSite(request, env, url, path);
    } catch (err) {
      console.error('Worker error:', err);
      return html(errorPage(err?.message || String(err)), 500);
    }
  },
};

async function serveSite(request, env, url, path) {
  const files = await store.listFiles(env);

  // 解析要访问的文件：精确匹配 -> 目录 index -> 404
  let target = resolveTarget(path, files);
  if (!target) {
    // 站点尚未初始化：给出友好引导
    if (files.length === 0) {
      return html(welcomePage());
    }
    return html(notFoundPage(path), 404);
  }

  // ?raw=1 直接返回文件原始内容（用于媒体预览/下载）
  const wantRaw = url.searchParams.get('raw') === '1';

  // .php 交给 wasm 引擎执行（raw 模式下直接返回源码）
  if (extname(target.path) === '.php' && !wantRaw) {
    const file = await store.readFile(env, target.path);
    const bodyText = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method)
      ? await request.text()
      : '';
    const result = await executePhp({
      files: files.map((f) => ({ path: f.path, content: f.content, binary: f.binary })),
      targetPath: target.path,
      request,
      url,
      bodyText,
      env,
    });
    const headers = { 'Content-Type': 'text/html; charset=utf-8', ...result.headers };
    return new Response(result.body, { status: 200, headers });
  }

  // 静态文件直接返回
  const file = await store.readFile(env, target.path);
  if (!file) return html(notFoundPage(path), 404);
  const mime = file.mime || mimeType(target.path);
  if (file.binary) {
    const bytes = base64ToBytes(file.content);
    return new Response(bytes, { headers: { 'Content-Type': mime } });
  }
  return text(file.content, 200, mime);
}

function resolveTarget(path, files) {
  const set = new Set(files.map((f) => f.path));
  const cleaned = path.replace(/\/+$/, '') || '/';
  const candidates = [];
  if (cleaned !== '/') candidates.push(cleaned);
  candidates.push((cleaned === '/' ? '' : cleaned) + '/index.php');
  candidates.push((cleaned === '/' ? '' : cleaned) + '/index.html');
  if (cleaned === '/') {
    candidates.push('/index.php', '/index.html');
  }
  for (const c of candidates) {
    const cpath = normalizePath(c);
    if (set.has(cpath)) {
      const f = files.find((x) => x.path === cpath);
      return f;
    }
  }
  return null;
}

function base64ToBytes(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

function welcomePage() {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>站点待初始化 · EdgeHost</title>
<style>${BASE_CSS}</style></head><body>
<div class="center-card">
  <div class="logo">⚡ EdgeHost</div>
  <h1>网站还没内容</h1>
  <p>你已成功部署 PHP 虚拟主机，但站点目录还是空的。</p>
  <p>前往管理面板创建你的第一个 <code>index.php</code> 文件：</p>
  <a class="btn" href="/__admin">打开管理面板 →</a>
  <p class="muted">登录密码默认为 <code>admin</code>，部署后请务必修改。</p>
</div></body></html>`;
}

function notFoundPage(path) {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>404</title>
<style>${BASE_CSS}</style></head><body>
<div class="center-card"><div class="logo">⚡ EdgeHost</div>
<h1>404</h1><p>找不到 <code>${escape(path)}</code></p>
<a class="btn" href="/">返回首页</a></div></body></html>`;
}

function errorPage(msg) {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>运行错误</title>
<style>${BASE_CSS}</style></head><body>
<div class="center-card"><div class="logo">⚡ EdgeHost</div>
<h1>运行错误</h1><pre>${escape(msg)}</pre>
<a class="btn" href="/__admin">管理面板</a></div></body></html>`;
}

function escape(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

const BASE_CSS = `*{box-sizing:border-box}body{margin:0;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;background:#0f1420;color:#e7ecf3;display:flex;align-items:center;justify-content:center;min-height:100vh}
.center-card{max-width:560px;padding:48px;background:#171e2e;border:1px solid #2a3550;border-radius:16px;text-align:center}
.logo{font-size:22px;font-weight:800;margin-bottom:24px}
h1{font-size:30px;margin:0 0 16px}p{line-height:1.7;color:#aeb9cc}code{background:#0b0f18;padding:2px 7px;border-radius:5px;color:#7dd3fc}
.btn{display:inline-block;margin-top:16px;padding:12px 26px;background:#3b82f6;color:#fff;text-decoration:none;border-radius:9px;font-weight:600}
pre{text-align:left;background:#0b0f18;padding:16px;border-radius:8px;overflow:auto;color:#fca5a5}
.muted{font-size:13px;color:#7b879b;margin-top:24px}`;
