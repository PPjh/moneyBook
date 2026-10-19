# Web 版 HTTPS 静态部署

Web 源码位于统一仓库的 `web/` 子目录，Git 在最外层，与 `android/` 一起管理。
正式部署只发布 `web/dist/` 的内容，手机上的应用网址不需要增加 `/web/`。
不要将整个仓库、`.git`、安卓源码或个人账目备份上传为网站文件。

## 一、GitHub Pages：发布 Web 构建结果

仓库根目录的 [Web 工作流](../.github/workflows/web-pages.yml) 会运行
`node web/build.mjs`、`node web/check.mjs`，只上传 `web/dist/` 内容并部署到原站点根路径。
`web/dist/` 是构建产物，不需要提交。

### 首次配置或从原根目录发布迁移

1. **部署更新前先在手机上导出一份账目 JSON，并确认文件已保存。**
2. 在仓库根目录提交结构调整与工作流，再推送到原来的 GitHub 仓库 `main` 分支。
3. 打开仓库 **Settings → Pages → Build and deployment**。
4. 将 **Source** 从 **Deploy from a branch** 改为 **GitHub Actions**。
5. 在 **Actions → Web checks and Pages → Run workflow** 选择 `main`，运行并等待 `build` 和 `deploy` 成功。
6. 打开 **Settings → Pages** 显示的 HTTPS 地址。

**不能继续使用 `main / (root)` 直接发布应用。** 源码现在位于仓库内的 `web/` 子目录，
分支发布不能任意选择该目录，本项目通过 GitHub Actions 发布构建结果。
参考 [GitHub 发布来源设置](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)
与 [自定义 Pages 工作流](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)。

首次推送与修改 Pages Source 是一次发布迁移，可能有短暂切换时间。
本地完成结构调整并不会自动修改 GitHub 设置；如果推送时首次工作流失败，先切换 Source，再手动重跑。

### 保持已安装应用的路径

保持原来的域名、仓库名和 Pages 站点路径。例如原网址是
`https://PPjh.github.io/moneyBook/`，调整后仍使用这个地址，**不要改成 `/moneyBook/web/`**。
工作流将 `web/dist/index.html` 发布为原站点下的 `index.html`，不是发布到 `web/` 路径。

本次没有修改应用文件、PWA 清单、离线缓存版本或本地存储格式。
使用相同地址和浏览器时，目录重组本身无需重装应用，也不会执行数据清理。
更换域名、浏览器、设备或清理网站数据前，请先备份。

### 后续更新

在仓库根目录运行 `node web/build.mjs` 和 `node web/check.mjs`，检查通过后提交、推送到 `main`。
Web 相关改动会触发工作流；拉取请求只检查，只有 `main` 的推送或手动运行才会部署。
只修改安卓目录不会触发 Web 发布。如发布失败，先在 Actions 中查看错误；不要清除手机上的网站数据来排查部署问题。
部署完成后，日常使用不依赖本地电脑一直开机。

> Git 操作建议在本机 `MoneyBook/` 根目录执行，统一管理 `web/` 与 `android/`。
> `.git` 只保存在最外层，不进入构建产物；推送仍使用原有远程地址。

## 二、Cloudflare Pages / Netlify 等 HTTPS 静态托管

在仓库根目录运行（需要 Node.js，无需安装第三方依赖）：

```bash
node web/build.mjs
node web/check.mjs
```

构建结果位于：

```text
web/dist/
├── index.html
├── manifest.json
├── sw.js
├── icon-192.png
├── icon-512.png
├── icon-maskable-512.png
└── .nojekyll
```

将 `web/dist/` 作为站点内容目录，确保 `index.html` 位于公开站点根路径。
不需要上传测试脚本、截图、图标原图或整个源码仓库。

- **手动上传**：在原有站点上传新的 `web/dist/` 文件夹，沿用原 HTTPS 地址。
- **Git 自动构建**：以仓库为构建根目录，命令为 `node web/build.mjs && node web/check.mjs`，输出目录为 `web/dist`。
- 若平台将构建根目录设为 `web`，命令改为 `node build.mjs && node check.mjs`，输出目录改为 `dist`；两套路径不要混用。

具体上传入口见 [Cloudflare Direct Upload](https://developers.cloudflare.com/pages/get-started/direct-upload/)
和 [Netlify 拖放部署说明](https://docs.netlify.com/deploy/create-deploys/#drag-and-drop)。

## 三、在安卓手机上安装与确认

1. 用支持 PWA 安装的浏览器打开部署后的 **HTTPS 网址**，首次保持联网。
2. 在浏览器菜单选择「安装应用」，部分浏览器显示为「添加到主屏幕」。
3. 从桌面图标打开轻记账，检查「我的」页面底部的版本号。
4. 联网加载成功后，开启飞行模式再重开，确认离线记账可用。

本地 `http://localhost:8080/` 主要用于开发。手机访问电脑的普通局域网 HTTP 地址，
不能代替 HTTPS 正式安装；浏览器安装入口与表现可能因设备而异。

## 四、更新版本与备份

发布功能、界面、图标或离线文件变更时，同步修改 `web/index.html` 的 `APP_VERSION`
和 `web/sw.js` 的缓存版本，再重新构建并发布全部静态文件。
手机联网后重新打开应用；出现新版本提示时点击「立即更新」，并检查版本号。
部署可能存在缓存和生效延迟，未更新时先确认 Actions 成功、网址正确以及网络可用。

目录重组本身不需要升级缓存；当前 **1.5.4** 因手机界面调整已同步升级页面与缓存版本。
账目与固定目录授权都在设备的浏览器环境中；搬动源码不改变浏览器的权限限制，
也不会将 Web 版变成原生安卓应用。建议始终保留可恢复的文件备份。
