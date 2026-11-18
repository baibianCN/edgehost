// 把 panel/ 目录下的 HTML + CSS + JS 打包成一个 JS 模块，供 Worker 内联返回
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const html = readFileSync(resolve(root, 'panel/index.html'), 'utf8');
const css = readFileSync(resolve(root, 'panel/style.css'), 'utf8');
const js = readFileSync(resolve(root, 'panel/app.js'), 'utf8');

const out = html
  .replace('/*__CSS__*/', () => css)
  .replace('/*__JS__*/', () => js);

const target = resolve(root, 'worker/panel.js');
mkdirSync(dirname(target), { recursive: true });
writeFileSync(
  target,
  '// 本文件由 scripts/build-panel.mjs 自动生成，请勿手改\n'
    + 'export const PANEL_HTML = ' + JSON.stringify(out) + ';\n',
);
console.log('✔ worker/panel.js 已生成 (' + (out.length / 1024).toFixed(1) + ' KB)');
