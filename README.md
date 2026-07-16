# 桌面便签

基于 Tauri 2、React、TypeScript、Vite、Tailwind CSS 与 SQLite 的本地桌面便签。

主要功能包括透明度与主题调节、全局快捷添加、系统托盘、类别管理、今天/完成状态筛选、优先级、截止日期、详细备注，以及 JSON 导入导出。所有事项、类别、设置和窗口状态均保存在本地 SQLite 中。

数据库通过版本化 migration 升级。旧版 `notes.content` 会自动迁移为标题，旧事项统一归入“未分类”，不会删除重建用户数据库。

## 开发

需要 Node.js、Rust stable 和 Windows WebView2：

```powershell
npm install
npm run tauri dev
```

只验证前端构建：

```powershell
npm run build
```

## 构建 Windows 安装包

```powershell
npm run tauri build
```

安装包将生成在 `src-tauri/target/release/bundle/nsis`。
