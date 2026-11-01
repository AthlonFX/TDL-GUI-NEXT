# TDL-GUI-NEXT

Windows 上的 Telegram 文件浏览与下载工作台，使用 Electron 提供桌面界面，下载能力基于 [iyear/tdl](https://github.com/iyear/tdl)。


## 功能

- 扫码登录、二步验证、多账号切换、我的收藏和本地会话置顶。
- 按时间浏览消息，向上加载历史，支持日期筛选和日期跳转。
- 自动加载当前画面中的图片及视频封面缩略图，不需要先下载完整媒体。
- 支持图片、视频、压缩包、文档及其他附件，拖动多选和批量下载。
- 自定义下载目录，恢复系统“下载”目录、打开目录，支持下载限速。
- 不使用代理、系统代理、自定义代理及连接测试。
- 浅色、深色、跟随系统、自定义主题色和平滑颜色切换。
- 账号退出与重新扫码登录，托盘常驻和可记忆的关闭行为。
- 设置自动保存，固定设置页标题栏，支持一键取消全部文件选择。
- 缩略图缓存位置设置、迁移与清理。

不包含转发、建站和自动化规则。

## 使用

支持 Windows 10/11 x64。从 [Releases](https://github.com/AthlonFX/TDL-GUI-NEXT/releases/latest) 获取免安装版，解压整个文件夹，双击 `TDL-GUI-NEXT.exe`。请保留文件夹内全部配套文件，不要只复制 EXE。

[下载 Windows 免安装版](https://github.com/AthlonFX/TDL-GUI-NEXT/releases/download/v1.0.0/TDL-GUI-NEXT-1.0.0-Windows-x64.zip) · [1.0.0 发布说明](https://github.com/AthlonFX/TDL-GUI-NEXT/releases/tag/v1.0.0) · [问题反馈](https://github.com/AthlonFX/TDL-GUI-NEXT/issues)

首次使用在软件中扫码登录；启用二步验证的账号会显示密码输入框。根据网络环境在设置中选择代理模式。首次启动默认跟随系统代理，不预填任何个人代理地址。

默认下载位置为 Windows 实际的“下载”文件夹，包括系统重定向后的路径。设置中可自定义、恢复默认或打开当前路径。

更详细的操作见 [使用说明](backend/使用说明.md)。

## 数据保存在哪里

| 内容 | 位置 |
| --- | --- |
| Telegram 登录状态 | 当前 Windows 用户的 `%USERPROFILE%\.tdl`；若显式配置了 `TDL_STORAGE`，以该配置为准 |
| 账号列表、设置、置顶、下载记录、日志 | `%APPDATA%\TDLWorkbenchDesktop\workbench` |
| 默认缩略图缓存 | EXE 同级的 `cache\previews` |
| 自选缩略图缓存 | 所选目录下的 `tdl-thumbnail-cache` |
| 已下载的原文件 | 用户选择的下载目录 |

改名后沿用原数据目录，以便现有用户继续使用。软件仅监听本机回环地址；账号操作通过当前配置的连接与 Telegram 通信。

## 开发与构建

见 [BUILD.md](BUILD.md)。源码不包含账号、个人配置、缓存、下载文件、依赖目录和预编译运行文件。`package-lock.json` 保留，用于安装相同版本的依赖。

```powershell
npm ci
npm --prefix backend ci
# 按 BUILD.md 准备 runtime 和 FFmpeg
npm test
npm run build
```

构建输出为 `dist/win-unpacked` 文件夹。运行 `npm run release:zip` 可另外生成免安装 ZIP 和校验文件。

## 上游与许可

- tdl 原作者：[iyear](https://github.com/iyear)，以及 [贡献者](https://github.com/iyear/tdl/graphs/contributors)。
- 当前使用 tdl **0.20.4**，许可为 **GNU AGPL v3**，原文见 [licenses/TDL-AGPL-3.0.txt](licenses/TDL-AGPL-3.0.txt)。
- 其他依赖保持各自许可，见 [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)。
- **本工作台自有代码采用 AGPL-3.0-only**，完整许可见 [LICENSE](LICENSE)，署名与项目关系见 [NOTICE.md](NOTICE.md)。第三方组件保持各自的许可和版权。
- AGPL 允许商业使用。分发受该协议约束的版本时须遵守源码提供和同协议许可等条件；修改后通过网络提供交互服务时须遵守第 13 条。

发布说明见 [CHANGELOG.md](CHANGELOG.md)，上传步骤见 [GitHub 发布准备清单](docs/GITHUB-PUBLISH.md)。第三方对应源码材料的实际状态见 [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)。
