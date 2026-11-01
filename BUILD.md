# Windows 构建说明

## 环境

- Windows 10/11 x64。
- Node.js 24.x 与 npm；当前运行文件为 Node.js 24.22.1。
- Electron 45.2.1、electron-builder 26.18.0，由根目录锁文件安装。
- Windows 自带的 .NET Framework C# 编译器，用于构建原生文件夹选择器。

以下命令均在仓库根目录执行。命令行中的 Node.js/npm 用于开发；成品使用 `runtime/node.exe` 启动后端。

## 安装依赖

```powershell
npm ci
npm --prefix backend ci
```

后端的 node-pty 使用随包提供的 Windows Node-API 预编译文件；后端运行在独立 Node.js 进程中，不为 Electron 重编译。

## 准备外部运行文件

这些文件体积较大，不提交 Git。不要从当前用户数据目录复制任何账号或配置。

1. 从 [Node.js 24.22.1](https://nodejs.org/dist/v24.22.1/) 下载 Windows x64 版本，将 `node.exe` 放入 `runtime/node.exe`，保留对应 Node LICENSE。使用该版本目录中的 `SHASUMS256.txt` 核对文件。
2. 从 [tdl v0.20.4 Releases](https://github.com/iyear/tdl/releases/tag/v0.20.4) 下载 Windows 64 位版本，将 `tdl.exe` 放入 `runtime/tdl.exe`。按上游公布的校验值核对，保留许可及对应源码。
3. 将 Windows x64 FFmpeg 放入 `backend/vendor/ffmpeg/ffmpeg.exe`。现有本地版本来自 npm 包 `@ffmpeg-installer/win32-x64@4.1.0`，FFmpeg 版本为 `N-92722-gf22fcd4483`。原包可用 `npm pack @ffmpeg-installer/win32-x64@4.1.0` 获取；解包后复制二进制、package.json 和 README。正式分发前须补齐对应版本源码、构建选项、补丁及适用的第三方许可；也可改用能完整提供这些材料的维护中发行版，并重新验证封面提取。

运行文件应来自上述官方或明确记录的上游渠道，不要复制他人的登录数据库。

## 运行和构建

```powershell
npm test
npm run prepare:build
npm start
```

`prepare:build` 检查运行文件及依赖是否存在，然后从 `native/FolderPicker.cs` 编译 `backend/FolderPicker.exe`。`npm start` 使用正常用户资料，若需要隔离测试，请使用独立测试目录：

```powershell
$env:TDL_DESKTOP_TEST_DIR = Join-Path $env:TEMP 'tdl-gui-next-dev-test'
npm start -- --desktop-test
```

测试默认下载目录在该测试目录内，不会替换日常下载设置。首次登录行为仍需用户自行完成。

```powershell
npm run build
```

该命令生成 `dist/win-unpacked/TDL-GUI-NEXT.exe` 及配套目录。整个文件夹必须一起使用。不自动上传 GitHub，也不进行代码签名。使用 npm run release:zip 可将这个干净构建输出打包为 ZIP 并生成校验值；不要对日常使用目录直接压缩。

根目录的 `migration-source.json` 是空路径模板。个人电脑旧版数据迁移配置不得提交或分发。用户资料目录仍使用 `TDLWorkbenchDesktop`，用于保持已有版本兼容。

## 发布前验证

使用全新 Windows 用户或隔离资料目录验证：无旧账号的首次启动、扫码及二步验证、代理、系统下载目录、文件夹选择、日期跳转、预览、下载和缓存清理。仅使用自己的测试账号及可公开的测试内容。发布截图不要包含个人会话列表、二维码、电话号码、下载记录或令牌。
