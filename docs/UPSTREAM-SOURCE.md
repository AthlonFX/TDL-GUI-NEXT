# 上游源码和构建材料

## tdl 0.20.4

本版调用未修改的 tdl 0.20.4；二进制报告的提交 9d7d49e 与上游 v0.20.4 标签提交 9d7d49eef2bcb04da720c26e33598c49c68b9ddd 一致。

本地发布文件包含 tdl-v0.20.4-source.zip（上游对应版本源码归档）。归档内保留 go.mod、go.sum、Makefile 和 .goreleaser.yml 等上游依赖及构建定义；构建时依赖包由上游定义获取。归档校验值和二进制校验值见 COMPONENT-PROVENANCE.json。

固定版本源码：https://github.com/iyear/tdl/tree/v0.20.4

分发含 tdl 的成品时应一起提供对应源码附件和许可，不应只依赖一个指向最新版的主页链接。若自行修改或重新编译 tdl，应记录准确源码版本与构建材料并按其许可提供。

## FFmpeg

保留原有 N-92722-gf22fcd4483 可执行文件；许可原文见 licenses/FFMPEG-GPL-3.0.txt，版本与已知来源见 COMPONENT-PROVENANCE.json。当前尚未核实完整的链接依赖源码和构建材料。提供一个 FFmpeg 主仓库源码快照也不能替代这些材料；本次不声明这些要求已全部完成。
