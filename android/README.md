# 轻记账 · 安卓版

当前版本 **1.1.1（紧凑布局测试版）**，支持 Android 8.0 及以上。
界面直接复用 `web/index.html`，通过系统 WebView 离线显示；数据与系统能力使用 Java / SQLite。
不是加载线上网站，也不把账目搬到浏览器存储；没有网络或全盘存储权限。
与 [`web/`](../web/README.md) 共用仓库，分别维护版本，不自动同步账目。

## 已实现功能

- 与 Web 相同的橙色主题、图标、布局、图表、记账面板、PIN 键盘及浅色／深色主题。
- 手机顶栏收紧、月度卡片约缩小 27%（同尺寸浏览器测试）；原生层统一处理系统栏和刘海安全区，网页不重复留白，桌面布局不变。
- 与 Web 相同的明细／统计／我的导航，以及悬浮记一笔按钮；系统文件选择器与确认弹窗仍是安卓原生样式。
- 收支、分类、备注、日期、算式记账、编辑删除、8 秒撤销、连续记账。
- 月份切换、搜索筛选、跨月查找、月预算、分类排行／环形图、近六个月收支图。
- 4–6 位 PIN、后台延时锁定、本机快照（最多 10 份）及恢复。
- 固定文件夹备份、另存 JSON、CSV 导出、Web JSON 导入预览、合并／覆盖恢复。

PIN 是访问锁，**不是数据库或备份加密**。忘记 PIN 只能清空本机账目、预算和快照；外部备份不删除。

## 安装与首次使用

测试 APK 位于 `app/build/outputs/apk/debug/app-debug.apk`，复制到手机安装。
手机可能要求允许当前文件管理器安装未知来源应用。首次试用先用演示账目，确认流程后再导入真实数据。

### 从安卓 1.0.0／1.1.0 覆盖升级

先在旧版导出备份，然后直接安装新版，**不要卸载旧版或清除应用数据**。
本地脚本沿用同一包名和 `android/.signing/debug.keystore`，版本号递增为 code 3。
1.1.0 起的数据库只新增配置表，1.1.1 不再改数据库结构；原账目、预算、PIN、快照文件和系统目录权限继续沿用。
旧 PIN 没有记录位数，首次升级请在同样的数字键盘输入原 PIN 后点「确认」；成功后会记住位数。
更换界面不需要重新导入已有安卓账目。实际覆盖安装后仍应核对金额、预算并试一次目录备份。

1. Web 端先导出 JSON，保留原文件，不要清除浏览器账目。
2. 安卓「我的 → 从文件恢复」，核对预览后合并导入。
3. 在「我的 → 备份位置」选择专用文件夹（例如 Documents 下新建“轻记账备份”）。
4. 点击「立即备份」，确认文件已生成；关闭重开、重启手机后再次验证。

目录通过安卓系统文件选择器授权，应用保存持久 URI 权限，通常无需每次重开重新选择。
用户撤销授权、卸载／清除数据、移动／删除目录、存储提供方失效时仍可能需要重新授权。
每次备份在同一文件夹生成独立 JSON，不覆盖旧备份；目录停用也不删除已有文件。
自动备份只在**打开或解锁时**检查每日／每 7 天／每 30 天周期，不是关闭应用后的后台定时任务。

## 构建

工程包名 `io.github.ppjh.moneybook`，最低 API 26，编译／目标 API 35，Java 17。
版本由 `app/build.gradle` 管理。SDK 安装在仓库外，不提交 `local.properties`。

常规方式：用 Android Studio 打开本目录，配置 SDK；或在本目录运行：

```powershell
.\gradlew.bat testDebugUnitTest lintDebug assembleDebug
```

Wrapper 固定 Gradle 8.11.1 及分发校验和，AGP 8.9.2。首次常规构建需要下载 Gradle 和构建依赖。

### 无 Gradle 下载的本地构建

本应用没有第三方运行库，可用已安装的官方 AAPT2、D8、zipalign 和 apksigner 直接打包。
Gradle 和本地脚本都会从 `web/` 打包同一份 HTML 与图标，安卓只额外加入原生适配脚本。
不打包 Web 截图、开发脚本、个人账目或 Service Worker；以后更新 Web 界面须同时重建安卓 APK。
从仓库根目录运行（按实际安装路径替换参数）：

```powershell
node android/build-native.mjs --sdk "D:\CodexSpace\.android-toolchain\sdk" --jdk "D:\CodexSpace\.android-toolchain\jdk-17.0.20.1+1"
```

需要 Node.js、JDK 17、SDK Platform 35 和完整的稳定版 Build Tools；本机已使用 Build Tools 36.0.0 成功构建。
脚本不会改系统 Java 设置，只清理 `app/build/native-debug/` 生成目录，输出 APK 和 SHA256 校验文件。
它完成资源编译、Java 编译、DEX 转换、ZIP 对齐及 APK 签名校验，**不代替 Gradle lint 或手机验收**。

## 验证状态

2026-10-19：全部安卓源码编译、APK 签名及 ZIP 对齐校验通过，26 项 JVM 核心测试和 Web 的 418 项自检通过。
真实浏览器中，明细／统计／记账面板／深色的两端截图在相同 390 × 844 尺寸下逐像素一致。
原生适配脚本的存储、PIN、备份、取消及恢复预览通过浏览器桩测试；桩测试不等于实际系统权限验证。
已新增 320／360／390／412／600 宽度、紧凑卡片和模拟安全区检查，PWA 仍保留自己的安全区避让。
本机模拟器缺少硬件加速，未完成启动。首轮 [GitHub Actions 标准 Gradle 测试、lint 与 APK 构建](https://github.com/PPjh/moneyBook/actions/runs/39206678570) 已通过；真机覆盖升级仍未完成，不能视为正式发布版。
验收项目见 [TESTING.md](TESTING.md)。

界面测试（需安装 Playwright 与可启动的 Edge／Chromium）：

```powershell
node android/check-shared-ui.mjs
```

截图与报告位于 `app/build/ui-checks/`，不提交到源码。不同 WebView 版本、字体和系统栏可能仍有轻微渲染差异。

## 本机内容与安全边界

仅加载 APK 内固定白名单资源，通过虚拟 HTTPS 来源返回，不访问线上站点。
禁止外部导航、iframe、网络请求、文件 URL 和内容 URL；桥接方法白名单化，写入与文件操作在原生层校验 PIN 会话。
PIN 仍使用原生 PBKDF2，页面只获得是否启用及位数，不获得 PIN 哈希或目录 URI。
界面是访问锁，数据库不加密；本机可信页面在锁屏后仍可能保留渲染所需的内存数据，不能作为对抗设备 root 的安全隔离。

## 签名与 GitHub 管理

- 源码、Wrapper 和工作流提交到仓库；SDK、构建产物、账目和签名凭据不提交。
- 本地构建脚本使用 `android/.signing/debug.keystore` 作为稳定的**测试签名**，请妥善保留，不要提交或当作正式密钥。
- 标准 Gradle debug 与该脚本的签名可能不同；GitHub CI 的临时 debug 签名也不能当作稳定升级渠道。
- 如果提示签名冲突，先保留数据并导出备份，不要直接卸载。后续正式发布需固定正式签名、递增版本号并独立安全备份密钥。
- 已配置 [Android 检查和 APK 工作流](../.github/workflows/android.yml)，源码推送后运行测试、lint、打包并上传测试产物；运行状态见 GitHub Actions，未完成的运行不能视为验证通过。
- 正式 APK 建议通过 GitHub Releases 发布，标签如 `android-v1.1.1`，不要将安装包积累进源码历史。

参见 [统一管理说明](../docs/PROJECT_MANAGEMENT.md)、[备份格式](../docs/BACKUP_FORMAT.md)、
[Android 官方签名说明](https://developer.android.com/studio/publish/app-signing)。
