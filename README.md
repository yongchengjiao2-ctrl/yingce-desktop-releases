# 影策个人桌面版

安装与更新现已自带进度窗口：自动展示下载百分比、已下载大小、速度、预计剩余时间，以及校验、解压、安装、完成或失败状态。关闭进度窗口不影响安装。所有使用新版 `install.ps1` 的 Windows 10/11 电脑均适用，无需另装组件。GitHub 下载自动使用已开启的 Windows 静态系统代理；显式配置的 curl 代理环境变量优先，仍保留断点续传与 SHA-256 校验。

已下载过旧脚本的电脑，请重新下载本 Release 的 `install.ps1`，替换安装目录中的同名文件后运行更新。旧副本不会自行改变。新版安装完成后，后续更新会校验并刷新官方安装脚本；网络不可用时继续使用本地安装器。v1.3.21 完整安装包已包含新版进度窗口。

当前完整版本 **v1.3.21**。

下载大文件时出现 EOF、连接中断：安装器现已支持五次重试、断点续传和 SHA-256 校验。已有安装的旧更新器不会自行获取这次脚本修复，请先[下载修复后的 install.ps1](https://github.com/yongchengjiao2-ctrl/yingce-desktop-releases/releases/latest/download/install.ps1)，替换安装目录中同名文件（与 `current.txt`、`update.cmd` 同目录），再运行 `update.cmd`。不要删除 `cache` 中的 `.partial` 文件，重试时将继续下载。首次安装仍下载 `install.cmd` 与 `install.ps1` 到同一目录。持续无法连接 GitHub 时，可从 Release 下载完整 ZIP 离线安装；所有下载均须通过校验后才安装，个人数据保留。

[下载 v1.3.21 桌面版](https://github.com/yongchengjiao2-ctrl/yingce-desktop-releases/releases/tag/desktop-v1.3.21)

首次安装：下载同一 Release 中的 **install.cmd** 与 **install.ps1**，放在同一个文件夹后双击 install.cmd。已安装版本可使用「影策 → 安装或更新影策」。完整 ZIP 解压后运行「安装或更新.cmd」。适用于 Windows 10/11 x64。

本版新增章节 Skill/Agent 对话与富文本保存、可移动助手和按项目 ZIP 迁移。项目卡片右上角可一键打包，旁边的「一键上传项目」卡片可在新电脑恢复章节、聊天、画布及关联素材。新电脑需要自行配置模型接口和 API Key。

[v1.3.21 更新说明](release-notes-v1.3.21.md) · [v1.3.20 验收记录](acceptance-v1.3.20.json) · [可审阅功能源码](workspace/skill-agent/README.md)

发行包不包含原电脑的个人项目、小说正文、浏览器配置或密钥。升级保留本机数据和渠道设置；第三方组件保留各自许可证。上游项目：[open-ai-canvas](https://github.com/ddcat-ai/open-ai-canvas)。


1.3.21 提供从 1.3.20 升级的约 15.5 MB 差量包。软件会校验现有程序文件，基线不匹配时自动使用完整包。更新前保存未发送草稿。
