# AI 朗读

系统朗读仍为默认选项。设置 → 语音 → 朗读来源可选 AI 朗读（SnapText Cloud）或自定义 AI 朗读（OpenAI-compatible）。云端无需填写厂商密钥；中文默认“冰糖”，英文默认“Mia”，其余语言回退系统朗读。选择本地翻译不影响独立云端朗读。

选择云端 AI 后，朗读文本发送到 SnapText Cloud，由服务端配置语音服务。文本与音频不会由 SnapText Cloud 持久化或共享缓存。选择自定义 AI 后，文本发送到语音设置中的 endpoint。词典真人音频优先；媒体失败时才进入所选朗读引擎。语音识别和 macOS 语音输入流程不变。

点击后云端模式立即创建 Web Audio 上下文，Rust 复用匿名设备注册和 Ed25519 签名请求 cloud，再通过所属窗口的 Tauri Channel 按序发送 PCM16LE / 24 kHz / 单声道音频。播放器保留跨帧半个采样，以原采样率播放，通过 GainNode 调音量。每帧 ACK 和约三秒队列提供背压；done 只代表网络结束，按钮会等声音播放完再恢复。自定义模式调用 OpenAI-compatible endpoint，接收有大小上限的完整 WAV/MP3 后用 Web Audio 解码播放；停止时会取消请求并关闭播放器。

主窗口、结果窗口及设置试听共用 Rust 播放所有权。新朗读、文本变化、开始录音、窗口关闭/结果窗口隐藏、关闭朗读或改变朗读配置时，会停止旧音频并取消请求。迟到的数据按本地会话标识丢弃。

云端 AI 的语速和英美口音由合成指令近似控制，不通过调整 PCM 播放速率改变音调。首段实际播放前的云端错误会提示并使用系统朗读；已发声后的断流仅停止并提示重试。自定义 AI 请求失败会显示错误，不自动回退。主动停止没有失败提示或系统回退。超过云端单次长度上限时明确提示并转用系统，不截断或拆成多次付费请求。

应用配置新增 `speech.engine`（`system` / `snaptext_cloud` / `local_openai_compatible`）、`speech.cloud_voice_by_lang` 以及 `speech.local_ai`。自定义 AI 使用 OpenAI-compatible `/v1/audio/speech` endpoint，可设置 API key、model、voice 和 WAV/MP3 返回格式。endpoint 与凭据保存在桌面端配置中。请求禁用 HTTP 重定向，超时 120 秒，限制单次文本为 8,000 字符、响应音频为 32 MiB。缺省字段兼容旧配置并使用系统朗读。cloud 地址复用已有调试覆盖机制，云端服务商密钥不进入桌面配置或安装包。

## 验证

    cargo check --workspace
    cargo test --workspace
    cd ui
    bun test
    bun run build

自动化覆盖旧配置兼容、SSE/PCM 跨片边界、缓冲背压、结束排空、主动停止、首段前回退、断流不重播、快速切换、跨窗口停止和词典回退。真实厂商调用必须由管理员显式试听，测试不读取生产密钥。

发布前在 macOS WKWebView 和 Windows WebView2 实机验证中英文音质、首段声音、系统朗读、词典音频、原文/译文、跨窗口抢占以及 macOS 录音停止旧朗读。该清单包含物理音频和平台行为，不能仅用单元测试代替。
