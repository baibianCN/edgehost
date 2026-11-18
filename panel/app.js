'use strict';
/* ================= 基础工具 ================= */
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];

function toast(msg, isError = false) {
  let t = $('#toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'toast';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.className = 'show' + (isError ? ' error' : '');
  clearTimeout(t._tm);
  t._tm = setTimeout(() => t.classList.remove('show'), 2200);
}

async function api(path, opts = {}) {
  const res = await fetch('/__api' + path, {
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    credentials: 'same-origin',
    ...opts,
  });
  let data = null;
  try { data = await res.json(); } catch { /* 空响应 */ }
  if (res.status === 401 && data && data.needLogin) {
    showLogin(!!data.needSetup);
    throw new Error(data.error || '未登录');
  }
  return { ok: res.ok, status: res.status, data: data || {} };
}

const FILE_ICONS = {
  php: '🐘', html: '🌐', css: '🎨', js: '⚙️', json: '📋', md: '📝',
  png: '🖼️', jpg: '🖼️', jpeg: '🖼️', gif: '🖼️', webp: '🖼️', svg: '🖼️', ico: '🖼️',
  mp3: '🎵', wav: '🎵', ogg: '🎵', m4a: '🎵', flac: '🎵',
  mp4: '🎬', webm: '🎬', mov: '🎬',
  pdf: '📕', zip: '🗜️', txt: '📄',
};
const TEXT_EXT = new Set(['php','html','htm','css','js','json','md','txt','xml','svg','csv','sql','ini','log']);
const MEDIA_IMG = new Set(['png','jpg','jpeg','gif','webp','svg','ico']);
const MEDIA_AUDIO = new Set(['mp3','wav','ogg','m4a','flac']);
const MEDIA_VIDEO = new Set(['mp4','webm','mov']);

function extOf(path) {
  const i = path.lastIndexOf('.');
  return i === -1 ? '' : path.slice(i + 1).toLowerCase();
}
function baseName(path) { return path.split('/').filter(Boolean).pop() || ''; }
function parentDir(path) {
  const p = path.split('/').filter(Boolean);
  p.pop();
  return '/' + p.join('/');
}

/* ================= 登录状态 ================= */
// setupMode=true 时登录页显示「首次设置密码」表单
let setupMode = false;

function showLogin(mode) {
  setupMode = !!mode;
  $('#login-page').classList.remove('hidden');
  $('#app').classList.add('hidden');
  $('#setup-form').classList.toggle('hidden', !setupMode);
  $('#login-form').classList.toggle('hidden', setupMode);
  $('#login-hint').textContent = '';
  setTimeout(() => {
    const el = setupMode ? $('#setup-password') : $('#login-password');
    el && el.focus();
  }, 50);
}
function showApp() {
  $('#login-page').classList.add('hidden');
  $('#app').classList.remove('hidden');
}

// 首次使用：设置管理员密码
$('#setup-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const p1 = $('#setup-password').value;
  const p2 = $('#setup-password2').value;
  const hint = $('#login-hint');
  if (p1 !== p2) { hint.textContent = '两次输入的密码不一致'; return; }
  if (p1.length < 6) { hint.textContent = '密码至少 6 位'; return; }
  hint.textContent = '正在设置…';
  try {
    const { ok, data } = await api('/setup', {
      method: 'POST',
      body: JSON.stringify({ password: p1 }),
    });
    if (ok && data.ok) {
      hint.textContent = '';
      $('#setup-password').value = '';
      $('#setup-password2').value = '';
      toast('🎉 密码设置成功，欢迎使用 EdgeHost！');
      await boot();
    } else {
      hint.textContent = data.error || '设置失败';
    }
  } catch (err) {
    hint.textContent = err.message || '网络错误';
  }
});

$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const password = $('#login-password').value;
  const hint = $('#login-hint');
  hint.textContent = '验证中…';
  try {
    const { ok, data } = await api('/login', {
      method: 'POST',
      body: JSON.stringify({ password }),
    });
    if (ok && data.ok) {
      hint.textContent = '';
      $('#login-password').value = '';
      await boot();
    } else {
      hint.textContent = data.error || '登录失败';
    }
  } catch (err) {
    hint.textContent = err.message || '网络错误';
  }
});

$('#btn-logout').addEventListener('click', async () => {
  await api('/logout', { method: 'POST', body: '{}' });
  showLogin();
});

/* ================= 标签页切换 ================= */
$$('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    $$('.tab').forEach((t) => t.classList.remove('active'));
    tab.classList.add('active');
    const view = tab.dataset.view;
    ['files', 'console', 'preview', 'settings', 'about'].forEach((v) => {
      $('#view-' + v).classList.toggle('hidden', v !== view);
    });
    if (view === 'preview') refreshPreview();
    if (view === 'settings') loadSettings();
  });
});

/* ================= 文件树 ================= */
let currentPath = null;

async function loadTree() {
  const { ok, data } = await api('/tree');
  const treeEl = $('#file-tree');
  if (!ok) { treeEl.innerHTML = '<div class="empty-tip">加载失败</div>'; return; }

  const paths = [];
  (function walk(n) { if (n.type === 'file') paths.push(n.path); (n.children || []).forEach(walk); })(data.tree);

  if (paths.length === 0) {
    treeEl.innerHTML = `<div class="empty-tip">站点还没有文件<br>点上面「✨ 生成演示站」<br>或上传 / 新建文件</div>`;
    return;
  }
  treeEl.innerHTML = '';
  renderNodes(treeEl, data.tree.children || []);

  function renderNodes(container, nodes) {
    for (const node of nodes) {
      const row = document.createElement('div');
      row.className = 'tree-item' + (node.path === currentPath ? ' active' : '');
      const icon = node.type === 'dir' ? '📁' : (FILE_ICONS[extOf(node.name)] || '📄');
      row.innerHTML = `<span class="icon">${icon}</span><span class="name"></span>`;
      row.querySelector('.name').textContent = node.name;
      if (node.type === 'file') {
        row.addEventListener('click', () => openFile(node.path));
      }
      container.appendChild(row);
      if (node.type === 'dir' && node.children && node.children.length) {
        const child = document.createElement('div');
        child.className = 'tree-children';
        renderNodes(child, node.children);
        container.appendChild(child);
      }
    }
  }
}

/* ================= 文件编辑 ================= */
const codeEl = $('#code');
const lineNums = $('#line-nums');

function updateLineNums() {
  const n = codeEl.value.split('\n').length;
  lineNums.textContent = Array.from({ length: n }, (_, i) => i + 1).join('\n');
}
codeEl.addEventListener('input', updateLineNums);
codeEl.addEventListener('scroll', () => { lineNums.scrollTop = codeEl.scrollTop; });
codeEl.addEventListener('keydown', (e) => {
  if (e.key === 'Tab') {
    e.preventDefault();
    const s = codeEl.selectionStart, en = codeEl.selectionEnd;
    codeEl.value = codeEl.value.slice(0, s) + '    ' + codeEl.value.slice(en);
    codeEl.selectionStart = codeEl.selectionEnd = s + 4;
    updateLineNums();
  }
  if ((e.metaKey || e.ctrlKey) && e.key === 's') {
    e.preventDefault();
    saveFile();
  }
});

async function openFile(path) {
  currentPath = path;
  const { ok, data } = await api('/file?path=' + encodeURIComponent(path));
  await loadTree();
  if (!ok) { toast(data.error || '读取失败', true); return; }

  const ext = extOf(path);
  $('#editor-empty').classList.add('hidden');
  $('#media-viewer').classList.add('hidden');
  $('#current-path').textContent = path;

  // 文本文件 -> 编辑器
  if (TEXT_EXT.has(ext) || !data.file.binary) {
    $('#editor').classList.remove('hidden');
    codeEl.value = data.file.binary ? '[二进制文件，无法文本编辑]' : data.file.content;
    codeEl.readOnly = !!data.file.binary;
    updateLineNums();
    setEditorButtons(['save', 'delete', 'download']);
    $('#btn-save').classList.toggle('hidden', !!data.file.binary);
    $('#editor-status').textContent = `${data.file.mime || ''} · ${(data.file.content || '').length} 字符 · ${data.file.updatedAt || ''}`;
  } else {
    // 媒体文件 -> 预览
    showMedia(path, data.file);
    setEditorButtons(['delete', 'download']);
  }
}

function setEditorButtons(btns) {
  ['save', 'delete', 'download', 'view-media'].forEach((b) => {
    $('#btn-' + b).classList.add('hidden');
  });
  btns.forEach((b) => $('#btn-' + b).classList.remove('hidden'));
}

function showMedia(path, file) {
  $('#editor').classList.add('hidden');
  $('#media-viewer').classList.remove('hidden');
  $('#media-path').textContent = path;
  const ext = extOf(path);
  const url = path + '?raw=1';
  let inner = '';
  if (MEDIA_IMG.has(ext)) inner = `<img src="${url}" alt="${path}">`;
  else if (MEDIA_AUDIO.has(ext)) inner = `<audio controls src="${url}"></audio>`;
  else if (MEDIA_VIDEO.has(ext)) inner = `<video controls src="${url}"></video>`;
  else inner = `<div class="media-link">此文件类型不支持内联预览<br>可直接在网站中通过 <code>${path}</code> 引用</div>`;
  inner += `<div class="media-link" style="margin-top:14px">文件地址：<a href="${url}" target="_blank" style="color:#4f8cff">${url}</a></div>`;
  $('#media-body').innerHTML = inner;
}
$('#btn-media-close').addEventListener('click', () => {
  $('#media-viewer').classList.add('hidden');
  $('#editor-empty').classList.remove('hidden');
});

async function saveFile() {
  if (!currentPath) return;
  const { ok, data } = await api('/file?path=' + encodeURIComponent(currentPath), {
    method: 'PUT',
    body: JSON.stringify({ content: codeEl.value }),
  });
  if (ok && data.ok) {
    toast('已保存 ' + currentPath);
    $('#editor-status').textContent = '保存成功 ' + new Date().toLocaleString();
    loadTree();
  } else {
    toast(data.error || '保存失败', true);
  }
}
$('#btn-save').addEventListener('click', saveFile);

$('#btn-delete').addEventListener('click', async () => {
  if (!currentPath) return;
  if (!confirm('确定删除 ' + currentPath + ' ？')) return;
  const { ok, data } = await api('/file?path=' + encodeURIComponent(currentPath), {
    method: 'DELETE',
  });
  if (ok) {
    toast('已删除');
    currentPath = null;
    $('#editor').classList.add('hidden');
    $('#media-viewer').classList.add('hidden');
    $('#editor-empty').classList.remove('hidden');
    loadTree();
  } else {
    toast(data.error || '删除失败', true);
  }
});

$('#btn-download').addEventListener('click', () => {
  if (currentPath) window.open(currentPath + '?raw=1', '_blank');
});

/* ================= 新建文件 / 文件夹 ================= */
$('#btn-new-file').addEventListener('click', async () => {
  const name = prompt('新文件路径，例如 /index.php 或 /css/style.css：');
  if (!name) return;
  let p = name.trim();
  if (!p.startsWith('/')) p = '/' + p;
  const { ok, data } = await api('/file?path=' + encodeURIComponent(p), {
    method: 'PUT',
    body: JSON.stringify({ content: defaultContent(p) }),
  });
  if (ok) { toast('已创建'); loadTree(); openFile(p); }
  else toast(data.error || '创建失败', true);
});

$('#btn-new-folder').addEventListener('click', () => {
  toast('文件夹会在上传或创建其中的文件时自动出现');
  $('#btn-new-file').click();
});

$('#btn-init').addEventListener('click', async () => {
  if (!confirm('将生成一个演示站点（仅当站点为空时），继续？')) return;
  const { ok, data } = await api('/init', { method: 'POST', body: '{}' });
  if (ok) { toast('演示站已生成'); loadTree(); }
  else toast(data.error || '生成失败', true);
});

function defaultContent(path) {
  switch (extOf(path)) {
    case 'php': return `<?php\necho "<h1>Hello from PHP!</h1>";\necho "时间: " . date("H:i:s");\n`;
    case 'html': return `<!DOCTYPE html>\n<html><head><meta charset="utf-8"><title>新页面</title></head>\n<body><h1>新页面</h1></body></html>\n`;
    case 'css': return `body { font-family: system-ui; }\n`;
    case 'js': return `console.log('hello');\n`;
    case 'json': return `{}\n`;
    case 'md': return `# 标题\n\n内容\n`;
    default: return '';
  }
}

/* ================= 上传（图片/音频/视频/任意文件） ================= */
$('#btn-upload').addEventListener('click', () => $('#upload-input').click());

$('#upload-input').addEventListener('change', async (e) => {
  const files = [...e.target.files];
  if (!files.length) return;
  toast(`上传 ${files.length} 个文件…`);
  const payload = { files: [] };
  for (const f of files) {
    const buf = await f.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let bin = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    const safeName = f.name.replace(/[^\w.\-一-龥]/g, '_');
    payload.files.push({
      path: '/' + safeName,
      content: btoa(bin),
      binary: true,
      mime: f.type || 'application/octet-stream',
    });
  }
  try {
    const { ok, data } = await api('/upload', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    if (ok) {
      toast(`已上传 ${data.written.length} 个文件`);
      loadTree();
      if (payload.files.length === 1) openFile(payload.files[0].path);
    } else {
      toast(data.error || '上传失败', true);
    }
  } catch (err) {
    toast(err.message || '上传失败', true);
  }
  e.target.value = '';
});

/* ================= PHP 控制台 ================= */
$('#btn-run').addEventListener('click', async () => {
  const out = $('#console-output');
  out.textContent = '运行中…';
  try {
    const { ok, data } = await api('/run', {
      method: 'POST',
      body: JSON.stringify({ code: $('#console-code').value }),
    });
    if (ok) {
      let text = data.output || '(无输出)';
      if (data.headers && Object.keys(data.headers).length) {
        text = '// 响应头\n' + JSON.stringify(data.headers, null, 2) + '\n\n' + text;
      }
      out.textContent = text;
    } else {
      out.textContent = '错误: ' + (data.error || '未知');
    }
  } catch (err) {
    out.textContent = '错误: ' + err.message;
  }
});

/* ================= 网站预览 ================= */
function refreshPreview() {
  const u = $('#preview-url').value || '/';
  $('#preview-frame').src = u;
  $('#preview-open').href = u;
}
$('#btn-preview-go').addEventListener('click', refreshPreview);
$('#preview-url').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') refreshPreview();
});

/* ================= 设置页 ================= */
async function loadSettings() {
  try {
    const { ok, data } = await api('/settings');
    if (!ok) return;
    const s = data.smtp || {};
    $('#smtp-host').value = s.host || '';
    $('#smtp-port').value = s.port || 465;
    $('#smtp-user').value = s.user || '';
    $('#smtp-pass').value = '';
    $('#smtp-pass-hint').style.display = s.hasPass ? '' : 'none';
    $('#smtp-from').value = s.from || '';
  } catch { /* ignore */ }
  // 域名提示
  const host = location.host;
  $('#domain-site').textContent = location.protocol + '//' + host + '/';
  $('#domain-admin').textContent = location.protocol + '//' + host + '/__admin';
}

$('#password-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const current = $('#pwd-current').value;
  const next = $('#pwd-next').value;
  const next2 = $('#pwd-next2').value;
  if (next !== next2) { toast('两次输入的新密码不一致', true); return; }
  if (next.length < 6) { toast('新密码至少 6 位', true); return; }
  const { ok, data } = await api('/password', {
    method: 'POST',
    body: JSON.stringify({ current, next }),
  });
  if (ok) {
    toast('密码已修改，其它设备已自动退出');
    $('#pwd-current').value = $('#pwd-next').value = $('#pwd-next2').value = '';
  } else {
    toast(data.error || '修改失败', true);
  }
});

$('#smtp-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const smtp = {
    host: $('#smtp-host').value.trim(),
    port: Number($('#smtp-port').value) || 465,
    user: $('#smtp-user').value.trim(),
    pass: $('#smtp-pass').value,
    from: $('#smtp-from').value.trim(),
  };
  if (!smtp.host || !smtp.user) { toast('请填写 SMTP 服务器和邮箱账号', true); return; }
  const { ok, data } = await api('/settings', {
    method: 'PUT',
    body: JSON.stringify({ smtp }),
  });
  if (ok) {
    toast('SMTP 设置已保存');
    $('#smtp-pass').value = '';
    loadSettings();
  } else {
    toast(data.error || '保存失败', true);
  }
});

$('#smtp-test').addEventListener('click', async () => {
  const to = $('#smtp-user').value.trim();
  if (!to) { toast('请先填写邮箱账号', true); return; }
  // 先保存当前设置，避免用户填了没保存就测试
  const smtp = {
    host: $('#smtp-host').value.trim(), port: Number($('#smtp-port').value) || 465,
    user: $('#smtp-user').value.trim(), pass: $('#smtp-pass').value, from: $('#smtp-from').value.trim(),
  };
  await api('/settings', { method: 'PUT', body: JSON.stringify({ smtp }) });
  $('#smtp-pass').value = '';
  toast('正在发送测试邮件…');
  try {
    const { ok, data } = await api('/run', {
      method: 'POST',
      body: JSON.stringify({ code: 'cf_mail(' + JSON.stringify(to) + ', "EdgeHost 测试邮件", "收到这封邮件说明 SMTP 配置成功！时间：" . date("Y-m-d H:i:s")); echo "已提交发送请求，请查收邮箱（含垃圾箱）";' }),
    });
    if (ok) {
      // cf_mail 的发送结果在返回的 mail 字段里
      const mails = data.mail || [];
      const failed = mails.find((m) => m.ok === false);
      if (failed) toast('发送失败：' + (failed.error || '未知原因'), true);
      else toast('✓ 邮件已发出，请查收（含垃圾箱）');
    } else {
      toast(data.error || '测试失败', true);
    }
  } catch (err) {
    toast(err.message || '测试失败', true);
  }
});

/* ================= 启动 ================= */
async function boot() {
  try {
    const res = await fetch('/__api/me', { credentials: 'same-origin' });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.authenticated) {
      showApp();
      await loadTree();
    } else {
      showLogin(!!data.needSetup);
    }
  } catch {
    showLogin(false);
  }
}

// 支持 ?raw=1 直接访问文件（下载/媒体引用用）——由后端处理，这里无需干预
boot();
