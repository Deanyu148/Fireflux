# 参与贡献

感谢你愿意为 Fireflux 出力。这个项目是「Firefly 博客的本地管理客户端」，动手之前建议先读一遍 [开发笔记](docs/开发笔记.md)：
那里写了性能与节能设计的来龙去脉、看板娘的实现约束，以及踩过的坑。

## 先讨论，再动手

- **Bug**：用仓库的 Bug 报告模板开 issue（Issues → New issue → Bug 报告），附上客户端版本、系统版本，以及主进程控制台里带 `[Fireflux]` 的日志。
  如果问题出在「动态发布」的内嵌网页里（图片裂开、连接失败），请先展开卡片左下角的「🔍 连接诊断」，把里面的记录一起贴上来。
- **新功能或较大的改动**：先开 issue 说明要解决的问题和大致方案，免得写完才发现方向不对。
  这个项目有意保持「只读写绑定的博客项目里的文件 + 调用本机 git」这条边界，不打算加服务端、账号体系、数据库或云端同步。

## 本地开发

需要 Node 22+ 与 pnpm 11（CI 用的是这两个版本）。

```bash
pnpm install
pnpm dev          # 开发模式
pnpm typecheck    # TypeScript 检查
pnpm build        # 只构建，产物在 out/
pnpm dist         # 构建并打包 Windows 安装包，产物在 release/
```

- 首次运行后到「设置」页绑定一个博客项目目录；客户端只读写这个目录下的 `src/content`、`src/config`、`public`。
- 开发模式的数据目录是仓库旁的 `data/`（已被 gitignore），里面存绑定路径、壁纸和设置，**不要提交**。
- `scripts/` 下是开发辅助脚本，都是可选的，不影响正常构建。

## 改动代码时的约定

- 缩进用制表符，风格跟随周围代码；**不要对无关文件做格式化改动**，保持 diff 可读。
- 不引入新的格式化工具、打包器或 UI 框架。
- `src/renderer/public/live2d/` 下的 `model/`、`load/`、`assets/`、`firefly.css` 与上游 Firefly Live2D v6.6.2 **逐字节一致**，不要修改；
  需要升级时整块替换，并在 PR 里写清来源与版本。本仓库只改这个目录里的 `firefly-loader.js` 与 `embed.html`。
- 改看板娘或性能相关代码前先读 [开发笔记](docs/开发笔记.md)，改完用 `node scripts/bench-drag.mjs` 复测（需要先 `pnpm build`）。
- 改了界面上能调到的参数，请同步更新 [参数说明](docs/参数说明.md)。

## 提交与 PR

- 提交信息用 Conventional Commits，与现有历史保持一致：`feat:`、`fix:`、`perf:`、`docs:`、`chore:`、`refactor:`。一个提交只做一件事。
- PR 里说明「改了什么、为什么」，列出跑过的验证命令（至少 `pnpm typecheck` 和 `pnpm build`），界面改动请附截图。

## 许可

向本仓库提交代码，即表示同意以 [MIT 许可](LICENSE) 发布你的贡献。
`src/renderer/public/live2d/` 下的模型与资源版权归上游作者所有，遵循其原有许可。
