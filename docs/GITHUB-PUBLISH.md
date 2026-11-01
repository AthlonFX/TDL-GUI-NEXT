# GitHub 发布与后续维护

项目仓库：[AthlonFX/TDL-GUI-NEXT](https://github.com/AthlonFX/TDL-GUI-NEXT)。工作台自有代码采用 AGPL-3.0-only，第三方组件保持各自许可。

## 后续更新

在这个干净源码仓库中修改和提交代码，再通过 Git 推送到 main。不要将日常使用目录、个人设置、账号、缓存、聊天数据、下载文件或旧备份复制进源码。

构建说明见 ../BUILD.md。先验证功能，再生成新的版本号、更新 CHANGELOG.md，创建相应源码标签，并将免安装 ZIP、同版本源码包、tdl 对应版本源码和 SHA256SUMS.txt 放入 Releases。

Release 文字模板见 RELEASE-NOTES.md。第三方来源与材料状态见 ../THIRD-PARTY-NOTICES.md 和 UPSTREAM-SOURCE.md；本次不声称 FFmpeg 全部对应源码材料已核实完整。

源码文件与源码压缩包都不应包含 .git 认证信息、node_modules、预编译运行文件或个人数据。许可和构建脚本需要与实际分发的版本匹配。
