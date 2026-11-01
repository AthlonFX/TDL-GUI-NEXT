# 第三方组件说明

本文件记录桌面版的直接组件。已安装后端运行依赖及其许可文本的副本索引见 licenses/runtime-dependencies.json；各包仍在运行目录保留自身版权与许可。该索引不替代 Electron、Node.js 和 FFmpeg 内含组件的全部通知。

| 组件 | 当前版本 | 来源与许可 |
| --- | --- | --- |
| tdl | 0.20.4 | [iyear/tdl](https://github.com/iyear/tdl)，GNU AGPL v3；原文见 `licenses/TDL-AGPL-3.0.txt`，运行目录保留 `runtime/TDL-LICENSE.txt` |
| Electron | 45.2.1 | [electron/electron](https://github.com/electron/electron)，MIT；构建输出保留 Electron LICENSE 和 Chromium `LICENSES.chromium.html` |
| Node.js | 24.22.1 | [nodejs/node](https://github.com/nodejs/node)，Node.js 及其内含组件许可见 `licenses/NODE-LICENSE.txt` 和 `runtime/NODE-LICENSE.txt` |
| FFmpeg Windows 二进制 | N-92722-gf22fcd4483 | 来自 `@ffmpeg-installer/win32-x64@4.1.0`，包标注 GPLv3，实际构建开启 `--enable-gpl --enable-version3`；发行前需补全对应源码、构建材料和内含组件许可 |
| teleproto | 1.232.1 | npm 同名包；保留其包内 LICENSE |
| node-pty | 1.1.0 | [microsoft/node-pty](https://github.com/microsoft/node-pty)；保留其包内 LICENSE 及原生依赖许可 |
| @xterm/headless | 6.0.0 | [xtermjs/xterm.js](https://github.com/xtermjs/xterm.js)；保留其包内 LICENSE |
| big-integer | 1.6.52（锁文件） | npm 同名包；保留其包内 LICENSE |

## tdl 对应源码

本工作台将未修改的 tdl 程序作为独立进程调用，不将 tdl 声称为本项目原创。

- 固定版本源码：[v0.20.4](https://github.com/iyear/tdl/tree/v0.20.4)
- 固定版本许可：[LICENSE](https://github.com/iyear/tdl/blob/v0.20.4/LICENSE)

实际发布二进制时，需要按该版本许可采用有效的对应源码提供方式，包含上游要求的构建材料；不要只放一个不对应版本的主页链接。若后续修改 tdl，须同时提供修改后的对应源码。

## FFmpeg 发布待办

当前 FFmpeg 构建较旧；本次未替换现有二进制。发布压缩包前，应确认上述精确构建及链接库的对应源码可获取、随附完整许可，并记录构建命令与补丁。若无法补齐，替换为能提供完整对应材料的维护中构建，完成验证后再发布。

本文件不为第三方组件重新授权。本项目自有代码采用 AGPL-3.0-only，见根目录 LICENSE。

## GramJS 参考实现

Telegram stripped-thumbnail JPEG 重建参考 GramJS Utils.ts；保留 MIT 许可文本见 licenses/GRAMJS-LICENSE.txt。

## Microsoft ConPTY

node-pty 自带的 Microsoft ConPTY/OpenConsole 组件保留 Microsoft MIT 许可；副本见 licenses/CONPTY-LICENSE.txt。原组件及原生模块保持未修改。
