# Web 与安卓版的统一管理

## 一个仓库，两个子项目

仓库根目录是 `MoneyBook/`，只有这里保留 `.git`。`web/` 和 `android/` 不建立嵌套仓库，
共同使用原远程 `https://github.com/PPjh/moneyBook.git`、历史和 `main` 分支。
功能开发可使用临时分支，完成验证后合并；不使用两个长期分支代替两个客户端目录。

- [`web/`](../web/README.md)：现有 Web / PWA 版，当前版本 1.5.6。
- [`android/`](../android/README.md)：共享 Web 界面 + 原生 Java / SQLite，当前版本 1.1.3（测试版）。
- [备份格式](BACKUP_FORMAT.md)：两端进行文件导入、导出时的兼容参考。

Git 命令建议在仓库根目录执行。例如 `git status`、`git diff`，确认本次改动范围后再提交。
目录重组保留现有提交，不重写历史。两端源码统一在仓库根目录提交和推送。

## 版本与发布

用户约定：**每次版本更新完成并通过检查后，都提交并推送到现有 GitHub 仓库，不只保留本地代码或安装包。**
除非用户当次明确要求暂不推送，否则版本更新应完成以下步骤：

1. 更新受影响客户端的版本号、更新日志及构建所用的共享界面；保持原包名与稳定签名。
2. 运行相关检查，审查差异及敏感文件；只提交本次相关改动，不包含个人账目、密钥、SDK、缓存或 APK。
3. 获取远程状态，正常提交并推送到当前约定的仓库／分支；不强制覆盖远程历史。发生冲突或权限问题时如实说明，不声称已经同步。
4. 核对对应提交的 GitHub Actions；对 Web 更新核对 Pages 发布结果，向用户报告实际状态及链接。

该约定只同步项目代码与版本说明，不会同步个人账目，也不默认创建正式 Release 或上传签名材料。

两端独立更新版本，不要求每次一起升级。发布标签建议分别为 `web-v1.5.6`、`android-v1.1.3`。
Web 应用与缓存版本为 1.5.6，安卓版本为 1.1.3。构建和发布状态以对应提交的 Actions 运行结果为准。
从安卓 1.1 起，构建时复制 `web/index.html` 与图标；Web 改 UI 后必须重建 APK，已安装 APK 不会热更新。
共用界面不代表两端共用存储，安卓数据库和文件权限仍在原生层。

Web 发布前运行：

```bash
node web/build.mjs
node web/check.mjs
```

Web 工作流按 `web/`、自身配置及公共 Git 规则的变化触发检查：拉取请求只检查，
`main` 上的推送或手动运行可发布 `web/dist/`。只改安卓源码不会触发此 Web 工作流。
首次需要将 Pages Source 改为 GitHub Actions，步骤见 [部署说明](../web/DEPLOY.md)。

安卓工作流按 `android/`、Web 界面／图标及自身配置变化触发测试、lint 和 debug APK 构建；不自动发布正式版本。
本机已生成测试 APK，26 项 JVM 核心测试、共享界面截图比对和适配桩测试通过，仍需完成手机验收。
首轮云端标准 Gradle／CI 检查已执行成功，设备验收仍待完成，详见 [安卓验证清单](../android/TESTING.md)。

正式 APK 使用稳定签名并发布到 GitHub Releases，避免把安装包积累在源码提交中。
包名固定为 `io.github.ppjh.moneybook`，发布更新时递增 `versionCode` 并更新 `versionName`。
本地脚本测试密钥在 `android/.signing/`；标准 Gradle／临时 CI debug 密钥可能不同，不能混作同一升级渠道。
正式签名材料不能丢失，也不能仅依赖 `.gitignore` 保护。

### 1.5.6 / 1.1.3 同步

本次搜索弹出框与账目行更新已通过本地 Web 自检、多宽度界面检查；安卓沿用同一数据层及签名，版本递增后重新构建测试 APK。
源码推送后由现有 Web 与 Android 工作流检查；是否通过以该次 GitHub Actions 的实际结果为准，不沿用旧提交的成功状态。

## 安全与备份

不提交个人账目 JSON、PIN、密钥、访问令牌、安卓签名文件或本机 SDK 路径。
根目录 `.gitignore` 已忽略常见备份文件名、`backups/`、构建缓存与签名配置，
但忽略规则不是安全审计；每次提交前仍需检查文件，尤其是自行更名的备份。
签名密钥需要独立安全保存；用户账目需要另行导出备份，GitHub 源码仓库不替代账目备份。

## 首次云端验证

2026-10-19，源码提交 [`333fc12`](https://github.com/PPjh/moneyBook/commit/333fc12f648f37d5286a10a8375b0d749338c6bc)：

- [Web 检查与 Pages 发布成功](https://github.com/PPjh/moneyBook/actions/runs/39206678613)，只发布 `web/dist/`，保持原站点路径。
- [Android 标准测试、lint 和 APK 构建成功](https://github.com/PPjh/moneyBook/actions/runs/39206678570)，构建产物保留 14 天，不写入源码历史。
- Pages 发布来源已从 `main / (root)` 切换为 GitHub Actions。

这些结果仅对应该源码提交，不代替后续提交的检查或安卓真机验收。CI debug APK 的签名可能不同于本机测试包，不要为安装签名不同的包直接卸载现有应用。

## 两端数据兼容

已实现兼容 Web 的 JSON 文件导入、导出和稳定旧格式 ID，金额保持整数分、日期保持本地日历日期。
合并只新增记录 ID，不覆盖已有记录或预算；覆盖恢复在事务中替换账目及预算，并预先创建本机快照。
PIN 和目录权限不随备份迁移；首次迁移应使用副本验证并核对金额。
同仓库只管理代码，不提供设备同步服务；自动同步、云备份与冲突合并需另行设计，不能默认已经具备。

## 参考

- [GitHub Actions 按路径触发](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow)
- [GitHub Releases](https://docs.github.com/en/repositories/releasing-projects-on-github/about-releases)
- [Android 应用签名](https://developer.android.com/studio/publish/app-signing)
