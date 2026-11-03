# 影策个人桌面版

当前完整版本：**1.3.17**，基于官方 **v1.7.3.4**。

[下载桌面版 1.3.17](https://github.com/yongchengjiao2-ctrl/yingce-desktop-releases/releases/tag/desktop-v1.3.17)

本版加入：

- 分镜版本下拉：经典连续分镜、官方表演运镜；官方版可调表演和运镜强度。
- 经典分镜保留详细版与简易提示词，视频生成与复制发送只取简易正文，避免对白重复。
- 角色声音绑定、参考音频与多套造型。
- 已生成结果的下载和保存失败恢复，以及 Windows 本地保存修复。
- 短剧与精修画布互通、剧情段并行出片。
- 个人模型渠道同步到本机制作服务，保留桌面协议与经典白模导演模块。

首次安装：下载同一 Release 中的 `install.cmd` 和 `install.ps1`，放在同一文件夹后双击 `install.cmd`。也可下载完整 ZIP，完整解压后运行“安装或更新.cmd”。已安装用户使用菜单“影策 → 安装或更新影策”，更新源跟随最新桌面 Release。

升级前自动备份数据库和存储密钥，保留本机项目、原文、画面剧本、分镜、画布、素材、任务和接口配置。旧项目导入后默认暂停，请核对设定与模型后继续制作。发布包不包含个人项目、小说正文、浏览器配置或 API Key；新电脑需要自行填写密钥。

分镜入口：短剧制作 → 制作设置 → 分镜规则 → 分镜版本。修改版本影响之后撰写的内容，已有结果保留。

已完成构建、153 项前端测试、后端专项测试、旧数据迁移核对和真实桌面启动验收。未使用用户密钥进行付费生成，实际声音、造型和视频效果请结合自己的模型验收。

源码差异补丁：[desktop-1.3.17-source.patch](https://github.com/yongchengjiao2-ctrl/yingce-desktop-releases/releases/download/desktop-v1.3.17/desktop-1.3.17-source.patch)，基线为 [官方 v1.7.3.4](https://github.com/ddcat-ai/open-ai-canvas/tree/v1.7.3.4)。发行包的 `release.json` 记录产品源码提交，`latest.json` 记录完整文件 SHA256。第三方组件保留各自许可证。
