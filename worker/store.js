// 基于 Durable Objects 的虚拟文件系统 + 应用设置存储
// 选择 DO 而非 KV 的原因：DO 声明在 wrangler.toml 里即可使用，
// 无需像 KV 那样先创建命名空间再填 id —— 一键部署按钮开箱即用。
//
// 键格式（DO storage）：
//   file:<path>  -> JSON { c:内容, b:是否二进制, m:mime, s:size, t:updatedAt }
//   __secret     -> 会话签名密钥（首次访问自动生成）
//   __pwd        -> 管理员密码哈希 sha256(secret + ':' + password)
//   __smtp       -> JSON SMTP 配置 { host, port, user, pass, from }
// 目录不单独存储，由文件路径推导。

import { DurableObject } from 'cloudflare:workers';
import { normalizePath, mimeType, dirname, sha256Hex, randomHex } from './utils.js';

const FILE_PREFIX = 'file:';
const KEY_SECRET = '__secret';
const KEY_PWD = '__pwd';
const KEY_SMTP = '__smtp';
const DO_NAME = 'main';

export class FileStore extends DurableObject {
  // ---------- 文件 ----------
  async listFiles() {
    const entries = await this.ctx.storage.list({ prefix: FILE_PREFIX });
    const files = [];
    for (const [key, raw] of entries) {
      let rec = {};
      try { rec = JSON.parse(raw); } catch { continue; }
      const path = key.slice(FILE_PREFIX.length);
      files.push({
        path,
        content: rec.c ?? '',
        binary: !!rec.b,
        mime: rec.m || mimeType(path),
        size: rec.s ?? (rec.c ? rec.c.length : 0),
        updatedAt: rec.t || null,
      });
    }
    return files;
  }

  async listFilePaths() {
    const entries = await this.ctx.storage.list({ prefix: FILE_PREFIX });
    return [...entries.keys()].map((k) => k.slice(FILE_PREFIX.length));
  }

  async readFile(path) {
    path = normalizePath(path);
    const raw = await this.ctx.storage.get(FILE_PREFIX + path);
    if (raw == null) return null;
    let rec = {};
    try { rec = JSON.parse(raw); } catch { return null; }
    return {
      path,
      content: rec.c ?? '',
      binary: !!rec.b,
      mime: rec.m || mimeType(path),
      updatedAt: rec.t || null,
    };
  }

  async writeFile(path, content, opts = {}) {
    path = normalizePath(path);
    const binary = !!opts.binary;
    const rec = {
      c: typeof content === 'string' ? content : String(content),
      b: binary,
      m: opts.mime || mimeType(path),
      s: typeof content === 'string' ? content.length : content.byteLength,
      t: new Date().toISOString(),
    };
    await this.ctx.storage.put(FILE_PREFIX + path, JSON.stringify(rec));
    return { path, binary, mime: rec.m, size: rec.s, updatedAt: rec.t };
  }

  async deleteFile(path) {
    await this.ctx.storage.delete(FILE_PREFIX + normalizePath(path));
  }

  async deletePrefix(prefix) {
    prefix = normalizePath(prefix);
    const entries = await this.ctx.storage.list({ prefix: FILE_PREFIX + prefix });
    const keys = [...entries.keys()];
    if (keys.length) await this.ctx.storage.delete(keys);
    return keys.length;
  }

  // ---------- 鉴权与设置 ----------
  async getSecret() {
    let secret = await this.ctx.storage.get(KEY_SECRET);
    if (!secret) {
      secret = randomHex(32);
      await this.ctx.storage.put(KEY_SECRET, secret);
    }
    return secret;
  }

  async getPasswordHash() {
    return (await this.ctx.storage.get(KEY_PWD)) || null;
  }

  // 设置新密码；rotateSecret=true 时同时轮换会话密钥，使旧登录态全部失效
  async setPassword(password, rotateSecret = false) {
    let secret = await this.getSecret();
    if (rotateSecret) {
      secret = randomHex(32);
      await this.ctx.storage.put(KEY_SECRET, secret);
    }
    const hash = sha256Hex(secret + ':' + password);
    await this.ctx.storage.put(KEY_PWD, hash);
    return hash;
  }

  // 校验密码是否正确
  async verifyPassword(password) {
    const hash = await this.ctx.storage.get(KEY_PWD);
    if (!hash) return false;
    const secret = await this.getSecret();
    return sha256Hex(secret + ':' + password) === hash;
  }

  async getSmtp() {
    const raw = await this.ctx.storage.get(KEY_SMTP);
    if (!raw) return null;
    try { return JSON.parse(raw); } catch { return null; }
  }

  async setSmtp(cfg) {
    await this.ctx.storage.put(KEY_SMTP, JSON.stringify(cfg || {}));
    return true;
  }
}

// ---------- 供 Worker 其它模块调用的封装（DO RPC） ----------
function fs(env) {
  return env.FILE_STORE.get(env.FILE_STORE.idFromName(DO_NAME));
}

export async function listFiles(env) { return fs(env).listFiles(); }
export async function listFilePaths(env) { return fs(env).listFilePaths(); }
export async function readFile(env, path) { return fs(env).readFile(path); }
export async function writeFile(env, path, content, opts) { return fs(env).writeFile(path, content, opts); }
export async function deleteFile(env, path) { return fs(env).deleteFile(path); }
export async function deletePrefix(env, prefix) { return fs(env).deletePrefix(prefix); }

export async function getSecret(env) { return fs(env).getSecret(); }
export async function getPasswordHash(env) { return fs(env).getPasswordHash(); }
export async function setPassword(env, password, rotate) { return fs(env).setPassword(password, rotate); }
export async function verifyPassword(env, password) { return fs(env).verifyPassword(password); }
export async function getSmtp(env) { return fs(env).getSmtp(); }
export async function setSmtp(env, cfg) { return fs(env).setSmtp(cfg); }

// 返回目录树结构，供文件管理器渲染
export function buildTree(paths) {
  const root = { name: '', path: '/', type: 'dir', children: [] };
  const dirMap = new Map([['/', root]]);
  const sorted = [...paths].sort();

  function ensureDir(dirPath) {
    if (dirMap.has(dirPath)) return dirMap.get(dirPath);
    const parentPath = dirname(dirPath);
    const parent = ensureDir(parentPath);
    const node = { name: dirPath.split('/').filter(Boolean).pop(), path: dirPath, type: 'dir', children: [] };
    parent.children.push(node);
    dirMap.set(dirPath, node);
    return node;
  }

  for (const p of sorted) {
    const d = dirname(p);
    const parent = ensureDir(d);
    parent.children.push({
      name: p.split('/').filter(Boolean).pop(),
      path: p,
      type: 'file',
    });
  }
  // 目录排在文件前面
  function sortNodes(nodes) {
    nodes.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    nodes.forEach((n) => n.type === 'dir' && sortNodes(n.children));
  }
  sortNodes(root.children);
  return root;
}
