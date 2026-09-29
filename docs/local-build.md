# Windows 一键编译安装

在项目根目录双击 **build-install.cmd**，或在终端执行：

```powershell
pnpm desktop:install
```

脚本会检查 Node、pnpm、MSVC Rust 和 Visual Studio C++ 工具，校验项目版本，使用冻结锁文件安装依赖，执行类型检查，编译当前本地源码并生成 NSIS 安装包，最后打开交互式安装向导。

支持 Windows x64 / ARM64 原生 MSVC 工具链。macOS 和 Linux 的安装包由 GitHub CI 构建，此本地脚本不做跨平台编译。

## 环境

- Node.js 24 或更新版本。
- 与根 package.json 的 packageManager 一致的 pnpm（当前 12.5.1）。
- Rust MSVC 工具链和满足 Cargo.toml 最低版本的编译器。
- Visual Studio Build Tools：Desktop development with C++、对应架构的 C++ 工具及 Windows SDK。
- 首次运行需要网络下载 npm、Cargo 和 NSIS 依赖；安装向导按需处理 WebView2。

不会自动安装这些开发环境，也不会关闭正在运行的 XTools。执行安装前请保存应用中的工作。当前预览版没有可信 Windows 代码签名，Windows 可能提示未知发布者。

## 参数

```powershell
# 只检查环境，不安装依赖、不编译、不启动安装
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\build-install.ps1 -CheckOnly

# 编译正式包，但不启动安装向导
pnpm desktop:install -BuildOnly

# 更快的调试构建，不安装
pnpm desktop:install -BuildOnly -DebugBuild

# 已安装依赖时跳过 pnpm install
pnpm desktop:install -SkipDependencies
```

直接调用 PowerShell 时使用 `-BuildOnly`、`-DebugBuild`、`-SkipDependencies`。脚本会从自身路径定位仓库，因此可以从其他工作目录启动；支持含空格的项目路径。

编译产物位于 Cargo target 目录中的 `<Windows target>/<debug 或 release>/bundle/nsis/`。脚本会输出实际安装包绝对路径及 SHA-256。

任何环境检查、依赖安装、类型检查或编译失败都会返回非零状态并停止，不会启动旧安装包。只有确认当前构建生成了预期版本和架构的安装包后，才打开向导。不传静默安装参数、不自动提权、不删除用户数据。`-BuildOnly` 明确禁止运行安装包。
