# 📦 手动部署教程（下载代码，自己一步步来）

这个方案**不用一键按钮**。你需要把项目代码下载到自己电脑上，手动安装环境、登录、部署。每一步都要你自己敲命令、自己配置。

> 部署完成后，网站文件、管理员密码、邮箱配置这些，都是在网页面板里图形化管理。但**项目本身**要你自己下载、自己部署。

---

## 开始前准备（本机环境）

1. **一台电脑**（Windows / macOS / Linux 都行）
2. 安装 **Node.js 18 或更高版本** —— 去 [nodejs.org](https://nodejs.org/) 下载安装包，一路下一步装好
   - 装完打开终端（Windows 用 PowerShell，Mac 用终端），输入 `node -v`，能显示版本号就成功了
3. 一个 **Cloudflare 账号** —— 去 [dash.cloudflare.com](https://dash.cloudflare.com/sign-up) 注册，选免费版

---

## 第 1 步：把代码下载下来

在你电脑上打开终端，找一个你想放项目的文件夹，然后执行：

```bash
git clone https://github.com/baibianCN/edgehost.git
cd edgehost
```

> 如果你电脑上没装 git，也可以直接去 [https://github.com/baibianCN/edgehost](https://github.com/baibianCN/edgehost) 点绿色按钮 **Code → Download ZIP**，下载后解压，再进入解压出来的 `edgehost` 文件夹。

---

## 第 2 步：安装项目依赖

在 `edgehost` 文件夹里，执行：

```bash
npm install
```

等它装完（可能需要一两分钟，看网速）。

---

## 第 3 步：登录 Cloudflare

执行：

```bash
npx wrangler login
```

会自动打开浏览器，让你登录 Cloudflare 并点 **Allow（允许）** 授权。授权完成回到终端，显示登录成功就 OK 了。

---

## 第 4 步：确认配置文件

用文本编辑器打开项目根目录里的 `wrangler.toml`，看一下里面的内容。默认长这样：

```toml
name = "edgehost"
main = "worker/index.js"
compatibility_date = "2025-05-05"
compatibility_flags = ["enable_weak_ref"]

[[durable_objects.bindings]]
name = "FILE_STORE"
class_name = "FileStore"

[[migrations]]
tag = "v1"
new_classes = ["FileStore"]

[placement]
mode = "smart"
```

- `name = "edgehost"`：这是你的 Worker 名字，可以改成你自己的，比如 `name = "my-php-host"`。改完后你的网站地址会是 `https://my-php-host.你的账号.workers.dev`。
- 其它内容**不用改**，存储用的是 Durable Objects，配置已经写好了。

改完保存。

---

## 第 5 步：部署

在 `edgehost` 文件夹里执行：

```bash
npm run deploy
```

等它上传部署，出现成功提示和访问地址就完成了。

> ⚠️ 如果遇到 `compatibility_date` 或 WASM 相关报错，确认 `wrangler.toml` 里的 `compatibility_date` 是 `2025-05-05` 或更新的日期。

---

## 第 6 步：设置管理员密码（网页里做）

1. 打开部署成功后给你的地址，格式是：
   ```
   https://你的Worker名字.你的账号.workers.dev/__admin
   ```
2. 第一次进入会显示「**设置管理员密码**」页面，输入你想用的密码
3. 进面板后点 **✨ 生成演示站**
4. 新开标签页打开网站根地址 `https://你的Worker名字.你的账号.workers.dev/`，就能看到 PHP 示例站了

---

## 第 7 步（可选）：绑定自己的域名

想用自己的域名访问，而不是那串 workers.dev 地址：

- 在 Cloudflare 控制台 → **Workers & Pages** → 点你的 Worker → **Settings** → **Domains & Routes** → **Add** → **Custom Domain**，输入域名添加即可
- 或者用命令行：

```bash
npx wrangler domains add 你的域名.com
```

生效后：`https://你的域名/` 是网站，`https://你的域名/__admin` 是管理面板。

---

## 面板里能干什么（图形界面）

| 功能 | 在哪 |
|---|---|
| 设置 / 修改管理员密码 | 面板「⚙ 设置」页 |
| 配置 QQ 邮箱发信 | 面板「⚙ 设置」页，填服务器/邮箱/授权码，可点「发送测试邮件」 |
| 新建 PHP / HTML / CSS / JS 文件 | 面板「文件管理」→ 新建 |
| 上传图片 / 音频 / 视频 | 面板「文件管理」→ 上传 |
| 在线编辑代码 | 点文件树里的文件直接改 |
| 实时运行 PHP 代码 | 面板「PHP 控制台」 |
| 预览网站 | 面板里的「网站预览」 |

---

## 常见问题

| 问题 | 解决 |
|---|---|
| `npm install` 报错 | 确认 Node.js 版本 ≥ 18（`node -v` 查看），网络不好可换淘宝镜像重试 |
| `npx wrangler login` 打不开浏览器 | 把终端里显示的链接手动复制到浏览器打开授权 |
| 部署报 WASM / compatibility_date 错误 | `wrangler.toml` 里改成 `compatibility_date = "2025-05-05"` |
| 忘记管理密码 | 删掉 Cloudflare 控制台里该 Worker 的 Durable Object 存储，或本地删 `.wrangler/state`，重新访问面板重设 |
| 面板打不开 | 地址末尾必须是 `/__admin`，中间的 Worker 名字、账号名换成你自己的 |
