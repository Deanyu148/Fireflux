## 这个 PR 做了什么

<!-- 一两句话说明改动与动机；较大的改动请先关联 issue -->

## 关联 issue

<!-- Closes #123 -->

## 验证

- [ ] `pnpm typecheck` 通过
- [ ] `pnpm build` 通过（界面改动请附截图）
- [ ] 涉及性能 / 看板娘的改动，已按 [开发笔记](docs/开发笔记.md) 复测
- [ ] 没有修改 `src/renderer/public/live2d/` 下与上游逐字节一致的文件（`model/`、`load/`、`assets/`、`firefly.css`）
- [ ] 没有提交 `data/`、`out/`、`release/` 等本地产物
