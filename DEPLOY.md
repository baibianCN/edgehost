# 🖱️ 图形化部署教程（全程点鼠标，不用敲任何命令）

这个教程**不需要用命令行**。注册账号、复制项目、部署、设密码、绑域名，全部在网页里点几下完成。

---

## 开始前准备（2 分钟）

1. 一个 **GitHub** 账号 —— 没有就去 [github.com/signup](https://github.com/signup) 注册
2. 一个 **Cloudflare** 账号 —— 去 [dash.cloudflare.com/sign-up](https://dash.cloudflare.com/sign-up) 注册，选**免费版**就够

---

## 第 1 步：把项目复制到你自己名下（Fork）

> ⚠️ 这一步是关键，**不要跳过**。Cloudflare 只能读取"你自己账号下"的仓库。直接填别人的地址（`baibianCN/edgehost`），就会报「无法获取存储库内容 / 无法查询到资源」。

1. 打开项目地址：**https://github.com/baibianCN/edgehost**
2. 点页面**右上角**的 **Fork** 按钮
3. Owner（所有者）选**你自己的账号**，其他不用改
4. 点 **Create fork**
5. 等几秒，页面地址变成 `github.com/你的用户名/edgehost`，就复制成功了 ✅

---

## 第 2 步：一键部署

1. 在你刚 Fork 好的仓库页面（是你自己账号下的那个），往下滚，找到 README 里那个蓝色按钮 **Deploy to Cloudflare**，点它
2. 如果没登录 Cloudflare，先登录
3. 第一次会让你连接 GitHub：点 **Connect to GitHub** → 点 **Authorize**（授权）→ 选**你自己的账号**
4. 进入配置页后确认：
   - 仓库是你刚才 Fork 的那个（**你自己的用户名**开头）
   - Worker 名字随便填一个，比如 `my-php-host`
5. 一路点 **Next** → **Deploy**
6. 等 1～2 分钟，出现 **Success** 就部署好了 ✅

> 如果点按钮后报「无法获取存储库内容」，别慌，看本文最后的「报错怎么办」。

---

## 第 3 步：设置管理员密码（图形界面）

1. 打开部署成功后给你的地址，格式是：
   ```
   https://my-php-host.你的用户名.workers.dev/__admin
   ```
   （把 `my-php-host` 和 `你的用户名` 换成你第 2 步填的）
2. 第一次进入会显示「**设置管理员密码**」页面，输入你想用的密码
3. 进面板后，点 **✨ 生成演示站**
4. 新开一个标签页，打开你的网站根地址：
   ```
   https://my-php-host.你的用户名.workers.dev/
   ```
   就能看到一个会实时请求外网的 PHP 示例站 ✅

---

## 第 4 步（可选）：绑定你自己的域名

想用 `https://你的域名/` 访问网站，而不是那串 workers.dev 地址：

1. 打开 [dash.cloudflare.com](https://dash.cloudflare.com) → 左侧 **Workers & Pages** → 点你的 Worker
2. 进 **Settings**（设置）→ **Domains & Routes**（域名和路由）
3. 点 **Add** → **Custom Domain**（自定义域名）→ 输入你的域名 → 点 **Add Domain**
4. 按页面提示把域名的 NS 改成 Cloudflare 的（或加一条 CNAME）
5. 生效后：
   - `https://你的域名/` = 你的 PHP 网站
   - `https://你的域名/__admin` = 管理面板

> 没有域名也没关系，用 `workers.dev` 那个免费地址一样能玩。

---

## 面板里都能干什么（全是图形界面）

| 功能 | 在哪 |
|---|---|
| 设置 / 修改管理员密码 | 面板「⚙ 设置」页 |
| 配置 QQ 邮箱发信 | 面板「⚙ 设置」页，填服务器/邮箱/授权码，还能点「发送测试邮件」 |
| 新建 PHP / HTML / CSS / JS 文件 | 面板「文件管理」→ 新建 |
| 上传图片 / 音频 / 视频 | 面板「文件管理」→ 上传 |
| 在线编辑代码 | 点文件树里的文件，直接改 |
| 实时运行 PHP 代码 | 面板「PHP 控制台」 |
| 预览网站 | 面板里的「网站预览」 |

---

## 报错怎么办

| 报错 | 原因 | 解决办法（全图形界面） |
|---|---|---|
| **无法获取存储库内容** / **无法查询到资源** | Cloudflare 读不到这个仓库 | ① 确认你已按第 1 步 **Fork 到自己账号**；② 确认 Cloudflare 里 GitHub 授权的是**你自己的账号**；③ 一定要**从你自己仓库页面的 Deploy 按钮**进，别手动去 Cloudflare 控制台粘 URL |
| 授权 GitHub 后还是读不到 | 授权没连好 / 连错账号 | Cloudflare 右上角头像 → **GitHub 集成**，断开后重新连接，选对账号 |
| 刚 Fork 完就读不到 | GitHub 全球同步有延迟 | 等 **5～10 分钟**再点一次部署按钮 |
| 部署成功但面板打不开 | 地址写错了 | 地址末尾必须是 `/__admin`，中间的 `my-php-host`、用户名要换成你自己的 |

---

还有问题？去项目 GitHub 页面点 **Issues**，把报错截图发出来。
