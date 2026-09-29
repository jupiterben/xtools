# 架构与信任边界

## 宿主

Svelte 组件只依赖 `HostBridge`。运行于 Tauri 时调用 Rust Commands；浏览器预览使用实现同一接口的 IndexedDB 适配器。所有组件以数据库返回的快照更新界面，不提前显示安装成功。

Rust 使用单连接互斥访问 SQLite，启用 WAL。工具包 HTML 与安装状态保存在同一行，安装/卸载及成功日志在一个事务内完成。避免第一阶段就引入跨文件系统与数据库的分布式事务恢复问题。每个工具包目前约几十 KB；将来大型包应改用内容寻址文件存储和安装日志。

数据库存于 Tauri 的 `app_data_dir()/xtools.sqlite`。测试用 debug 构建支持 `XTOOLS_TEST_DATA_DIR`，release 构建不读取此环境变量。

## 工具运行

1. 宿主验证工具已安装、已启用及包摘要正确。
2. 数据库中的 HTML 交给 `sandbox="allow-scripts"` 的 srcdoc iframe。
3. 不授予 `allow-same-origin`、弹窗、导航宿主、下载或表单权限。
4. 宿主用随机会话 ID 发送工具初始化消息。工具端只接受 `event.source === parent` 的首次初始化。
5. 运行时在 Worker 中调用纯转换函数，最多接收两个各 200,000 字符的输入，1.8 秒超时后终止 Worker。
6. 工具输出经 `postMessage` 返回；宿主校验实际 `contentWindow`、协议版本、会话 ID、类型和长度。
7. 复制是宿主按钮触发的用户操作，工具不能发消息要求宿主读写剪贴板。
8. 关闭工具会移除 iframe；输入和输出不写入数据库。

UUID 使用 `uuid` 和安全随机源，SHA 使用 `@noble/hashes`，Diff 使用 `diff`。不依赖 opaque-origin Worker 中可能不可用的 `crypto.randomUUID` 和 `crypto.subtle`。

## CSP

工具包显式禁止网络、图片、表单和外部脚本，只允许随包内联脚本/样式及 Blob Worker。宿主允许本地资源、Tauri IPC 和本地 iframe。

当前单文件运行时要求 `script-src 'unsafe-inline'`。Tauri 自动改写 `script-src` 被定向关闭，否则宿主自动注入的哈希规则会使子文档内联脚本失效。这是官方可信包方案的显式权衡，不是第三方插件安全审计结论。

只接受经固定公钥签名的市场目录所引用且长度、SHA-256 完全匹配的 HTML。Rust 在安装入库前再次独立验签，不把前端的校验结果当成授权。市场 HTTP 下载器只接受目录和摘要包路径，不接受任意 URL、文件路径或可执行命令。后续引入第三方时，仍须重新审计 CSP、消息能力代理和资源限额；签名不能代替代码审核。

## GitHub 静态市场

市场仓库为 `H:\m-source\xtools-market`（GitHub: `jupiterben/xtools-market`）。GitHub Pages 托管静态产物，不需要常驻 API 服务、数据库或 Docker。工具源码、按版本构建的包、签名目录以及 CI/CD 都属于市场仓库。

客户端首次启动仍用本地兼容运行时安装 3 款默认工具。进入市场时请求 `https://jupiterben.github.io/xtools-market/catalog.json`，使用内置 Ed25519 公钥校验原始 payload，再在客户端进行搜索、分类和版本选择。发布器按白名单仅输出目录、工具包、health.json 与 .nojekyll，不包含源码或私钥。旧 `/v1` API 不再使用。

安装流程：

1. 重新获取并验签市场目录，不仅凭离线缓存授权安装。
2. 根据目录中的 SHA-256 请求源目录下的 `packages/<sha256>.xtool`，保留 `/xtools-market/` 等子路径；使用数据扩展名防止直接在 Pages 源下执行工具 HTML。
3. 限制响应体为 2 MB、10 秒超时、禁止跳转；校验实际字节长度与摘要。
4. 浏览器将包和 manifest 一起写入 IndexedDB；桌面把 envelope 与包交给 Rust 重新验证，再写入 SQLite。
5. 数据库中的 manifest 支持动态工具 ID，图标缺省为通用工具图标，已安装工具不依赖当前市场在线状态。

旧版 SQLite 自动增加可空 manifest 列，旧工具通过内置元数据兼容。签名目录在本地缓存用于离线展示；损坏缓存被忽略，安装时仍需联机。浏览器和 Rust 都只允许 HTTPS 市场地址，回环 HTTP 仅用于本地开发。

发布采用 GitOps：本地私钥签名，提交公开目录与包，PR/主分支 CI 校验签名、源代码与包一致性、静态产物白名单及 HTTP 下载；main 上传 Pages artifact 并部署，最后在公网核对发布目录、CORS 和所有包摘要。没有签名私钥或自有服务器凭据进入 CI。GitHub 仓库维护内容，Pages 提供下载入口，客户端不需要 GitHub API token。

下一阶段建议顺序：

1. 更细粒度的工具源码拆分和宿主最低版本约束。
2. 密钥轮换、发布者审核、目录时效/回放策略、撤销列表。
3. 内容寻址存储、版本指针切换、失败回滚与数据迁移备份。
4. 明确的文件和网络权限代理，不向插件暴露通用 shell 或任意 Tauri invoke。
5. 私有市场、多标签运行实例与插件开发 CLI。

## 首版局限

尚未实现下载进度、任务取消、自动更新回滚、第三方权限请求和原生工具。界面没有伪造这些行为；任务中心记录实际发生的安装卸载结果，最多保留 100 条。

浏览器适配器记录安装失败；桌面磁盘/数据库写入失败通过错误提示返回，若数据库本身无法写入，不能保证同时持久化失败日志。跨应用窗口的数据实时同步尚未实现，默认只创建一个主窗口。
