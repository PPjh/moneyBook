# 轻记账

一个仓库管理 Web / PWA 与安卓两个客户端。Web 版无需账号、无需后端，支持离线记账；
当前 Web 版本为 **1.5.4**，安卓版为 **1.1.1（紧凑布局测试版）**，已生成可安装 APK。

## 项目结构

```text
MoneyBook/
├── .git/                      统一管理两端的 Git 历史与远程配置
├── .gitattributes
├── .gitignore                 构建缓存、签名文件与个人备份忽略规则
├── .github/workflows/         Web 检查和 Pages 发布、Android 检查与打包
├── web/                       完整 Web / PWA 程序、图标、脚本与截图
├── android/                   Web 共享界面 + 原生 Java / SQLite 工程与构建脚本
├── docs/                      两端管理约定与备份格式
└── README.md                  项目总入口
```

`.git` 只保留在最外层，`web/` 和 `android/` 不建立嵌套仓库。
原有 Git 历史、`main` 分支和 [GitHub 仓库](https://github.com/PPjh/moneyBook) 远程地址保持不变，未重新初始化。
本次整理没有改变 Web 记账功能、存储格式或浏览器权限机制。

## Web 版安装与使用

通过 **HTTPS 静态托管 → 手机浏览器打开 → 安装到桌面** 使用。

- [安装、功能与开发说明](web/README.md)
- [HTTPS 部署说明](web/DEPLOY.md)
- [更新日志](web/CHANGELOG.md)
- [安卓版安装、构建与验证状态](android/README.md)
- [两端更新与发布约定](docs/PROJECT_MANAGEMENT.md)
- [现有 JSON 备份格式](docs/BACKUP_FORMAT.md)

在仓库根目录运行（Web 脚本需要 Node.js，无第三方运行依赖）：

```bash
git status           # 统一查看两端改动
node web/build.mjs   # 生成 web/dist/，用于 HTTPS 静态托管
node web/check.mjs   # 功能与打包自检
node web/serve.mjs   # 本地预览 http://localhost:8080/
```

## GitHub Pages 发布注意

应用文件现在位于 GitHub 仓库的 `web/` 子目录，不能继续从 `main / (root)` 直接发布应用。
[Web 工作流](.github/workflows/web-pages.yml) 会检查、打包并发布 `web/dist/` 的内容，
不发布整个仓库，也不发布安卓目录。

首次采用此结构时，先导出账目备份，再按 [部署说明](web/DEPLOY.md) 将
**Settings → Pages → Source** 切换为 **GitHub Actions**，并运行 **Web checks and Pages**。
保持原有域名、仓库名和站点路径，手机网址不要添加 `/web/`。

## 安卓版与两端数据

安卓工程在 `android/` 中，支持 Android 8.0 及以上，离线打包同一份 Web 界面、橙色主题和图标。
数据库、PIN、系统目录授权、文件备份和快照由安卓处理，不依赖浏览器存储或网络。
已实现记账、预算、统计、PIN、固定文件夹备份、CSV 导出、JSON 恢复和本机快照。
本地 APK 编译及签名校验通过，26 项核心测试和 418 项 Web 自检通过，四种界面的同尺寸浏览器截图逐像素一致。
尚未完成新版模拟器／真机验收和 Gradle lint；界面测试不代替原生权限测试。
两端独立发布，例如 `web-v1.5.4`、`android-v1.1.1`。两端源码统一提交到本仓库，构建与发布状态以 GitHub Actions 实际结果为准。
测试签名不能当作正式发布签名；密钥需另行安全保存，不提交到源码仓库。

同一仓库只统一管理代码，不会自动同步两端账目。安卓已实现兼容 Web 的 JSON 导入导出，
迁移时先保留原备份、核对预览和金额，再使用新客户端。不要将源码仓库当作个人账目备份。
