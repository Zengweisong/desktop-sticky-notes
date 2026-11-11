# 发布 Windows 版本

合并到 main 只更新代码；推送版本标签才会自动构建并发布安装包。构建在 GitHub 的 Windows 环境进行，本机不需要安装 C++ Build Tools。

## 首次准备

安装 Git、Node.js 22 和 GitHub CLI，执行 `gh auth login`。如推送 `.github/workflows/` 时提示缺少 workflow 权限，执行 `gh auth refresh -h github.com -s workflow` 并按提示完成授权。

如果 Git 能访问 GitHub，而 `gh` 授权连接超时，GitHub CLI 可能没有使用 Git 的代理。在同一个 PowerShell 窗口中执行以下命令后重试（仅在 `git config --get http.proxy` 有值时使用）：

```powershell
$env:HTTPS_PROXY = git config --get http.proxy
$env:HTTP_PROXY = $env:HTTPS_PROXY
gh auth refresh -h github.com -s workflow
```

## 每次发布

下面以 **0.7.2** 为例，实际操作时换成下一个未使用的版本号。

1. 同步主分支并创建发布分支（工作目录需无未提交修改）：

   ```powershell
   git switch main
   git pull --ff-only origin main
   git switch -c codex/release-0.7.2
   ```

2. 完成代码修改；将以下文件中的应用版本同步改为 `0.7.2`：
   - `package.json`
   - `package-lock.json`：顶层及 `packages[""].version`
   - `src-tauri/Cargo.toml`：`[package].version`
   - `src-tauri/Cargo.lock`：仅 `name = "desktop-sticky-notes"` 对应的版本，不要替换依赖版本
   - `src-tauri/tauri.conf.json`

   在 `CHANGELOG.md` 顶部添加 `## 0.7.2 - YYYY-MM-DD` 和本次变更。

3. 本地检查、提交、推送并创建 PR：

   ```powershell
   npm ci
   npm test
   npm run build
   git diff --check
   git add <本次修改的文件路径>
   git commit -m "chore: release desktop sticky notes 0.7.2"
   git push -u origin codex/release-0.7.2
   gh pr create --base main --title "Release 0.7.2" --body "说明本次改动及验证结果"
   gh pr checks --watch
   ```

   命令失败时先解决问题再继续。PR 的 `Windows build and release` 会运行前端、Rust 和 Hook 测试并构建安装包；失败日志在 GitHub → Actions 中查看。检查通过前不要合并。

4. 合并 PR（将 `PR编号` 换成实际数字），再给合并后的 main 打标签：

   ```powershell
   gh pr merge PR编号 --merge
   git switch main
   git pull --ff-only origin main
   git tag v0.7.2
   git push origin v0.7.2
   gh run list --workflow release.yml --limit 5
   ```

5. 复制上一步标签对应的运行 ID，等待发布完成：

   ```powershell
   gh run watch 运行ID --exit-status
   gh release view v0.7.2 --web
   ```

   Release 中应包含 `desktop-sticky-notes_0.7.2_x64-setup.exe` 和 `SHA256SUMS.txt`。下载安装包并运行即可升级，应用会沿用现有数据；升级前可以在设置中导出备份。

## 发布失败时

在 Actions 查看失败步骤。若只是临时下载或网络失败，可执行 `gh run rerun 运行ID --failed`；需要修改代码时，通过新 PR 修复并发布新版本。不要移动已经发布的版本标签。

本地构建完整桌面应用仍需 Rust stable、Visual Studio C++ Build Tools（桌面 C++ 工作负载及 Windows SDK），然后运行 `cargo test --manifest-path src-tauri/Cargo.toml` 和 `npm run tauri build`。
