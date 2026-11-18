# 🌐 在 Cloudflare 网页界面手动部署（全程不用命令行）

这个教程**不需要敲任何命令**。你先把代码下载到电脑上，然后全程在 **Cloudflare 网页界面**里点鼠标完成部署。每一步都要你自己手动操作。

---

## 开始前准备

1. 一个 **GitHub 账号** —— 没有就去 [github.com/signup](https://github.com/signup) 注册
2. 一个 **Cloudflare 账号** —— 去 [dash.cloudflare.com](https://dash.cloudflare.com/sign-up) 注册，选免费版

---

## 第 1 步：把代码下载到电脑

1. 用浏览器打开项目地址：**https://github.com/baibianCN/edgehost**
2. 点绿色的 **Code** 按钮 → 点 **Download ZIP**
3. 下载完成后，把 ZIP 解压，得到一个 `edgehost` 文件夹，留着后面用

---

## 第 2 步：登录 Cloudflare

1. 浏览器打开 [dash.cloudflare.com](https://dash.cloudflare.com)
2. 用你的账号登录

---

## 第 3 步：创建存储（在 Cloudflare 界面里）

1. 左侧菜单点 **Workers & Pages**
2. 找到 **KV**（或 **Durable Objects**）那一栏，点进去
3. 点 **Create a namespace**（创建命名空间）
4. 名字随便填一个，比如 `edgehost-store`，点 **Add** 创建
5. 创建好后，页面上会显示一个 **Namespace ID**，先复制存到记事本里，等下要用

---

## 第 4 步：创建一个 Worker

1. 左侧 **Workers & Pages** → 点 **Create**（创建）
2. 选 **Worker** → 选 **Start from Hello World**（从示例开始）
3. Worker 名字填一个你自己的，比如 `my-php-host`，点 **Deploy**（部署）
4. 部署好后，进入这个 Worker，点 **Edit code**（编辑代码），会打开一个在线代码编辑器

---

## 第 5 步：把代码放进 Worker

1. 打开你第 1 步解压出来的 `edgehost` 文件夹
2. 用记事本（或任意文本编辑器）打开 `worker` 文件夹里的 `.js` 文件
3. 把里面的内容复制到 Cloudflare 的在线代码编辑器里
4. 按文件之间的引用关系，把需要的代码都放进去，保存

> 提示：项目里的 `worker/index.js` 是入口文件，其它文件（`php-engine.js`、`api.js`、`store.js`、`auth.js`、`utils.js`、`panel.js`）都被它引用，要一起放进去。

---

## 第 6 步：绑定存储到 Worker

1. 在这个 Worker 页面，点 **Settings**（设置）→ **Variables & Bindings**（变量和绑定）
2. 点 **Add binding**（添加绑定）→ 选 **KV namespace**（或 Durable Object）
3. 变量名填 `FILE_STORE`，值选你第 3 步创建的那个 namespace
4. 点 **Save**（保存）

---

## 第 7 步：设置兼容选项

1. 还是在 **Settings** 里，找到 **Compatibility date**（兼容日期），设成 `2025-05-05` 或更新
2. **Compatibility flags**（兼容标志）里加上 `enable_weak_ref`
3. 点 **Save** 保存

---

## 第 8 步：部署并打开面板

1. 确认代码和绑定都弄好后，点 **Deploy**（部署）
2. 部署完成后，浏览器打开：
   ```
   https://my-php-host.你的账号.workers.dev/__admin
   ```
   （把 `my-php-host` 换成你第 4 步填的 Worker 名字）
3. 第一次进入会显示「**设置管理员密码**」页面，输入你想用的密码
4. 进面板后点 **✨ 生成演示站**，新开标签页打开网站根地址，就能看到 PHP 示例站了

---

## 第 9 步（可选）：绑定自己的域名

在 Cloudflare 里点你的 Worker → **Settings** → **Domains & Routes** → **Add** → **Custom Domain**，输入你的域名添加即可。

生效后：`https://你的域名/` 是网站，`https://你的域名/__admin` 是管理面板。

---

## 面板里能干什么

| 功能 | 在哪 |
|---|---|
| 设置 / 修改管理员密码 | 面板「⚙ 设置」页 |
| 配置 QQ 邮箱发信 | 面板「⚙ 设置」页 |
| 新建 / 上传 / 编辑网站文件 | 面板「文件管理」 |
| 实时运行 PHP 代码 | 面板「PHP 控制台」 |
| 预览网站 | 面板「网站预览」 |

---

## 说明

- 全过程都在 Cloudflare 网页界面操作，不用安装任何软件、不用打开终端。
- 部署完成后，网站文件和密码等都在网页面板里图形化管理。
- 如果某一步界面和教程对不上（Cloudflare 界面会更新），按页面实际提示操作即可。
