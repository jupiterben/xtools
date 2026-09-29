# XTools

本地优先的开发者工具箱。使用 **Svelte 5 + TypeScript + Vite + Tauri 2 + Rust**，提供官方工具市场、安装卸载、收藏、工具启停、任务记录和主题设置。

## 快速启动

开发环境：Node.js 22.12+、pnpm 12。桌面构建还需要 Rust 1.88+、Windows C++ Build Tools 和 WebView2。

```powershell
pnpm install
pnpm dev
```

浏览器预览默认运行在 `http://127.0.0.1:1420`。浏览器模式使用 IndexedDB，桌面模式使用 SQLite，两者的数据相互独立。

工具市场由独立仓库 `H:\m-source\xtools-market` 维护，默认使用 **https://jupiterben.github.io/xtools-market/**。直接启动 XTools 即可浏览和安装工具，不必运行本地市场服务。

仅需本地调试市场产物时：

```powershell
Set-Location H:\m-source\xtools-market
npm ci
npm run build
npm run preview
```

预览静态源在 `http://127.0.0.1:1430/`。市场离线时，已安装工具仍可使用；市场显示签名缓存和离线提示。市场仓库内的 GitHub Actions 负责测试、校验及发布 GitHub Pages。

```powershell
# 桌面开发：会自动构建工具包并启动前端
pnpm desktop:dev

# 当前平台的安装包
pnpm desktop:build

# 只构建可执行文件，不生成安装包
pnpm --filter @xtools/desktop tauri build --debug --no-bundle
```

桌面开发固定使用 1420 端口。启动 `desktop:dev` 前请先停止占用该端口的浏览器预览，或同步修改 `tauri.conf.json` 的 `devUrl` 和 `beforeDevCommand`。

## 已实现

- 简洁的「我的工具 / 工具市场」双入口，搜索、市场分类筛选和工具详情。
- 工具以响应式 Grid Card 展示，桌面三列、小屏两列、手机单列。
- 点击工具名称直接打开；官方工具一键安装；收藏筛选与原地管理模式（启停、卸载）。
- 收藏优先、最近使用自动排序；返回工具列表保留筛选和键盘焦点。
- 8 款可运行的工具：JSON、Base64、URL、时间戳、UUID、SHA 哈希、正则表达式、文本差异。
- 首次启动安装 JSON、Base64、时间戳；之后不会自动恢复用户卸载的默认工具。
- 工具包实际写入本地数据库；卸载移除工具包、收藏、最近使用和启停状态。
- GitHub Pages 提供静态签名目录和工具包，搜索、分类及版本比较在客户端完成；验证 Ed25519 签名与 SHA-256 摘要。
- 工具包与自身元数据在同一个事务内提交，支持不在客户端预置目录中的新工具 ID。
- 工具输入只驻留内存，关闭工具即销毁运行容器；不保存历史输入。
- 受限 iframe + Worker，限制输入大小，超时停止计算。
- 收藏、最近使用、启用/停用、安装卸载记录、浅色/深色/系统主题。
- 桌面与窄屏响应式布局。

## 工程结构

```text
apps/desktop/
  src/                    Svelte 工作台、组件、存储适配器
  src-tauri/              Rust Commands、SQLite、桌面配置
  public/runtime/         首次启动默认工具的兼容运行时
packages/
  tool-sdk/               宿主接口、数据类型、消息协议
  tool-manifest/          旧版/默认工具元数据、固定的市场公钥
tools/
  src/main.ts             沙箱内工具界面
  src/transform.worker.ts 计算线程
  src/transforms.ts       8 款工具的处理逻辑
scripts/                  工具包构建、图标生成
tests/unit/               转换逻辑、协议、目录测试
tests/e2e/                Playwright 完整流程和隔离测试
```

市场工具源码和发布由 `xtools-market/tools`、`xtools-market/registry` 负责。本仓库 `tools/` 保留首次启动与旧版本的内置兼容运行时，不再作为市场安装源。修改市场工具需在服务仓库提升版本、构建签名并发布。当前客户端没有自动更新：需要卸载再安装新版本。Vite 热更新不会替换数据库中的已安装工具。

### 生产市场地址

在构建客户端前设置同一个 HTTPS 地址：

```powershell
$env:VITE_MARKET_URL = 'https://jupiterben.github.io/xtools-market/'
$env:XTOOLS_MARKET_URL = $env:VITE_MARKET_URL
pnpm desktop:build
```

上述变量可省略，默认均为官方 Pages 源。浏览器使用 `VITE_MARKET_URL`；桌面 Rust 下载器使用编译时 `XTOOLS_MARKET_URL`，debug 构建可通过运行环境覆盖后者。源地址可以带仓库子路径；客户端下载相对路径 `catalog.json` 和 `packages/<sha256>.xtool`，不调用旧 `/v1` API。HTTPS 以外仅允许回环地址用于本机开发，不跟随重定向，不向插件开放任意 HTTP 请求。

`packages/tool-manifest/market-trust.json` 必须与市场发布公钥一致。不要从请求返回的公钥自动建立信任。首次签名私钥保存在服务仓库的 `.keys/market.pem`（已忽略），需要安全备份，不能上传 GitHub。

## 验证

```powershell
pnpm check
pnpm test
pnpm test:rust
pnpm exec playwright install chromium
pnpm test:e2e
pnpm build

# 构建 debug 桌面可执行文件，再从真实 GitHub Pages 源验证下载、WebView2 与 SQLite
pnpm --filter @xtools/desktop tauri build --debug --no-bundle
pnpm test:native
```

测试覆盖 Unicode 编解码、异常 JSON、时间戳边界、UUID、已知哈希向量、正则超时、Diff、消息会话校验、签名篡改、包损坏拒绝、安装卸载幂等、重启恢复、静态源子路径、安全 URL 校验、市场离线和移动端布局。Playwright 使用已签名测试夹具，不依赖另一份仓库；`test:native` 则连接真实 GitHub Pages。

## 当前范围

这是第一阶段可运行实现，不是开放式第三方插件平台：

- 市场为 GitHub 仓库 + Actions + Pages 静态源，通过 Git 审核官方包后发布，没有账号或第三方上传。
- 市场工具有独立版本和绑定工具 ID 的包，仍共享一套工具源码；更新提示、自动升级和回滚尚未实现。
- 已实现签名和固定公钥；密钥轮换、目录过期策略及撤销列表仍需后续完善。
- iframe 是 Web 层隔离，不是操作系统安全沙箱；当前不支持任意插件、原生可执行文件和系统权限。
- 宿主与工具使用单工具会话；多标签页、插件开发 CLI、文件授权和私有工具源属于后续阶段。
- 浏览器预览需本地服务提供页面，不是离线 PWA；Tauri 内置宿主页和 3 款默认工具，市场安装的包下载后本地持久化。
- 安装包暂未配置 Windows 代码签名，发布前需要单独配置。

详细边界见 `docs/architecture.md`。

## GitHub CI/CD 与安装包

仓库：`jupiterben/xtools`。安装包发布在 GitHub Releases，工作流见 `.github/workflows/`。

- `CI`：main、PR 或手动触发，使用 Node 24 / pnpm 12，冻结锁文件安装，检查版本、TypeScript/Svelte、单元测试、前端构建及 Playwright。
- `Release Installers`：推送 `v*` tag 或手动指定已存在的 tag。先完成 CI，再并行构建 Windows、macOS、Linux；各平台先运行 Rust 测试与 Clippy。
- 所有平台构建成功且收齐六个安装包后，统一计算 `SHA256SUMS.txt`，上传 draft release，全部上传成功才公布。当前全部发布为 **预发布版**。
- 已公开的 Release 不覆盖原有安装包，失败重试可以恢复未公布的 draft。缺少任一平台不会发布半成品版本。
- 只在发布汇总任务授予 `contents:write`；构建任务和 PR 没有发布权限。不需要 GitHub PAT 或服务器凭据。

| 平台 | 架构 | 安装包 |
| --- | --- | --- |
| Windows | x64 | NSIS `.exe`、`.msi` |
| macOS | Universal（Apple Silicon + Intel） | `.dmg` |
| Linux | x64 | `.AppImage`、`.deb`、`.rpm` |

### 发布新版本

同步更新根 `package.json`、`apps/desktop/package.json`、`apps/desktop/src-tauri/tauri.conf.json`、`apps/desktop/src-tauri/Cargo.toml` 的版本，以及 Cargo.lock 中的本项目版本。提交后创建匹配的 tag：

```powershell
git tag v0.1.0
git push origin main
git push origin v0.1.0
```

已存在 tag 的重试可在 Actions → Release Installers → Run workflow 中输入 `v0.1.0`。自动校验 tag 指向的 commit 和四处版本号一致，不在构建时偷偷修改源码版本。后续正式发版使用新的版本号，不移动旧 tag。

### 签名与兼容性

Windows 尚未配置可信发布者代码签名，可能出现 SmartScreen 提示。macOS 使用 ad-hoc 签名以支持 Apple Silicon，但 **不等同于 Developer ID 签名或 Apple 公证**，Gatekeeper 可能阻止打开。面向广泛用户发布前，应配置相应证书及公证账户，不要把私钥提交仓库。工具市场的 Ed25519 签名与安装包的系统代码签名是不同机制。

macOS 最低版本为 11.0；Linux 使用 Ubuntu 24.04 构建，需要兼容的系统库和 WebKitGTK 4.1，不能保证兼容更早的发行版。CI 会校验打包完整性和 Rust 行为，但不等于每个发行版上的真实安装测试。
