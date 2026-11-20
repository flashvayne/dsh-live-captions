# dsh-live-captions · 实时字幕

在 DeepSeek Harness 里把电脑正在播放的声音和麦克风输入变成实时多语言字幕：本机识别、逐句翻译、字幕以可拖动的浮层显示，会议结束后可以一键生成纪要。

Live multilingual captions for DeepSeek Harness: the audio your computer plays plus your microphone are transcribed on this machine with SenseVoice, translated line by line, and shown in a draggable overlay; one click turns the transcript into meeting minutes. Windows only (WASAPI loopback capture).

## 功能

- **两个声音来源**：Windows 默认扬声器（WASAPI 环回）和默认麦克风，可分别使用或混音采集。
- **本机识别**：SenseVoiceSmall + Silero VAD 在本机 CPU 上识别，音频不出机器。识别模型（约 230 MB）不随安装包分发，首次点「开始」时下载一次（国内走 hf-mirror），之后缓存在本机。
- **实时字幕**：说话停顿即切段，识别后显示原文，译文以流式方式逐字上屏。
- **多语言**：源语言可选自动/中文/英文/粤语/日文/韩文；目标语言可选中文、英文、日文、韩文、粤语、西班牙文、法文、德文、俄文、葡萄牙文。
- **三种翻译引擎**：云端默认模型、插件内置的离线多语种模型（M2M100）、自建的 OpenAI 兼容服务（Ollama / LM Studio）。选「内置离线模型」时识别和翻译都在本机完成。
- **会议纪要**：把整段转写汇总成「会议概要 / 主要议题 / 关键结论 / 待办事项 / 风险与待确认」，保存为 Markdown 并保留完整原始转写。纪要固定使用云端模型。
- **agent 工具**：`live_captions` 工具让模型也能开始/停止字幕、查看状态、读取记录或生成纪要。

## 安装

在插件市场里安装，或用 dsh CLI：

```sh
dsh plugin add dsh-live-captions
```

也可以在设置 → 插件里用包名安装。安装后**不要**同时启用自带的「语音输入 / Voice input」插件：两者注册同一个语音识别服务，后启用的那个会失败。

## 使用

1. 点界面右下角的「实时字幕」胶囊打开面板（窄窗口下胶囊会上移到输入框上方）。
2. 选好「音频来源」「源语言」「目标语言」，点「开始」。首次会下载约 230 MB 识别模型，面板显示进度；下载完成后自动开始采集。
3. 字幕以浮层显示，**分两行：上一行原文（源语言），下一行译文（目标语言）**。
4. 会议结束后点「生成纪要」。纪要写入 `~/.dsh/live-captions/minutes/`，并在面板里显示，可复制。
5. 点「记录」打开字幕记录页面，按 `时:分:秒` 查看每次会话的原文与译文，可复制全部。
6. 「清空」会连按两次确认：同时清掉面板里的转写和磁盘上当前会话的记录，序列号保持单调，后续字幕的时间戳不会跳回去。

## 字幕浮层

- **拖动**框体空白处移动，**右下角拖动**改大小（默认 720×280，最窄 320、最矮 140；右下角那两道斜纹就是手柄）；位置和尺寸记在 `settings.json`，重启保留，超出屏幕时自动夹回可见区域。
- **滚轮**在框内自然滚动，可以上下翻看前后句子；滚上去后新字幕不会把视图顶走，左上角出现「↓ 回到最新」。
- 两行靠**样式**区分，不显示标签：上一行小一号、次要颜色（原文），下一行大号加粗、主色（译文）。
- 顶部工具条（解锁时可见）：`A−` / `A+` 字号、`◐−` / `◐+` 透明度、`原文✓` 是否显示原文行、`🔒` 锁定、`⟲` 重置位置与大小，最右边的 `×` 关闭浮层。
- **浮层可以关掉**：关掉后字幕照常识别和记录，只是不再浮在屏幕上；面板里的「字幕浮层」开关是重新打开的入口。
- **锁定后点击穿透**：框体不再接收鼠标事件，不会挡住下面的界面；在面板里点「解锁」恢复。

## 翻译引擎

面板里的「翻译引擎」三选一，选择保存在 `settings.json`，下次启动沿用：

- **云端默认模型**（默认）：用你在 dsh 里选的默认模型。质量最好，需要联网。
- **内置离线模型**：插件自带的多语种翻译模型 `Xenova/m2m100_418M`（中英日韩西法德俄葡）。首次选择时面板出现「下载依赖」按钮，点击后自动安装 `@huggingface/transformers` 并下载约 **600 MB** 权重，之后完全本机运行。质量明显不如云端，属于「能看懂」的水平。
- **本地推理服务**：你自己跑的 OpenAI 兼容服务，例如 Ollama（`http://127.0.0.1:11434/v1`）、LM Studio（`http://127.0.0.1:1234/v1`）、vLLM。填「服务地址」和「模型名」即可。

本地引擎不可用时**不会偷偷回退到云端**（隐私优先），面板会显示失败原因。翻译只在两种明确情况下被跳过：源语言显式设为与目标语言相同，或源语言为「自动」且识别结果是汉字、目标语言是中文/粤语。除此之外一律翻译。

内置翻译模型跑在**独立子进程**里（ONNX Runtime 是原生依赖，隔离后它崩溃也不会带走 dsh），源码见 `lib/mt-server.js`。

## 数据与隐私

- **音频不出机器**：采集到的声音只写进临时 WAV，识别成功后立刻删除（一小时会议约 1.2 GB，默认不留）。
- **识别在本机**：SenseVoice 在你的 CPU 上运行，不上传音频。
- **只有字幕文本会离开机器**：选择云端翻译或生成纪要时，字幕文本发给当前配置的模型服务；选内置离线模型或自建服务时文本也不出机器（自建服务的地址由你决定）。
- **不打包模型权重**：安装包很小；识别模型（约 230 MB）和内置翻译模型（约 600 MB）都由你自己触发下载，缓存到本机后不再联网。

## 已知行为

- **低延迟**：说话停顿（约 250 ms）就切段并送去识别，最短段 1.2 秒、最长 4 秒。实测：停下后约 0.5 秒出现原文，约 1.2–1.7 秒出现译文（译文流式上屏，首字更早）。连续说话不停顿时会等到 4 秒上限。
- 字幕语言和说话语言相同时不会调用模型翻译，只剩识别延迟。
- 识别偶发错误（尤其是连续说话被 4 秒上限切开时）会原样进入纪要；纪要里对不确定信息统一标注「待确认」，不会编造。
- 想再降延迟可以调小 `segmentSeconds`（4→3）；想更准可以调大到 6。段长越短，越容易把一句话切成两半。

## 限制

- **只支持 Windows x64**：采集依赖 Windows 自带的 WASAPI 环回，通过系统 PowerShell 编译运行。其他系统上点「开始」会直接给出说明。
- 识别依赖宿主自带的语音识别服务（`@deepseek-ai/dsh-experimental-speech-to-text` 与 SenseVoice provider），插件通过 patch 插入这两行；宿主没有这两个包时面板会显示「语音识别服务未加载」。
- 音频按固定窗口切段，切段处可能截断单词。
- 识别质量取决于音量：系统音量过低时错字会明显增加；可以用「音频来源」改成仅系统声音来减少环境噪声。
- 内置翻译模型的依赖 `@huggingface/transformers` **不随插件安装**，只在用户选了「内置离线模型」时按需安装（需要本机有 npm/pnpm）。这不会影响云端翻译、识别和纪要。
- 关闭插件会停止采集并结束当前会话；已经写出的转写和纪要文件保留。

## 文件位置

- 转写：`~/.dsh/live-captions/sessions/<时间>/transcript.jsonl`
- 纪要：`~/.dsh/live-captions/minutes/<时间>-minutes.md`
- 运行日志：`~/.dsh/live-captions/logs/live-captions.log`
- 面板改过的设置：`~/.dsh/live-captions/settings.json`
- 内置翻译模型缓存：`~/.dsh/live-captions/models/mt`
- 识别模型缓存：`~/.dsh/speech-to-text/sensevoice/models`（由宿主的 SenseVoice provider 管理）

旧版本把数据写在 `~/.dsh/meeting-captions`。升级后首次启动会把整个目录移动到 `~/.dsh/live-captions`，历史记录和设置都在。

识别成功的音频分段默认在转写后删除；需要在配置里保留原始音频时把 `keepAudio` 设为 `true`。

## 配置

插件配置在 `cordis.patch.yml` 的 `live-captions` 行：

| 键 | 默认值 | 说明 |
|---|---|---|
| `dataRoot` | `~/.dsh/live-captions` | 转写、纪要、日志和缓存的位置 |
| `source` | `both` | `both` / `speaker` / `mic` |
| `sourceLanguage` | `auto` | `auto` / `zh` / `en` / `yue` / `ja` / `ko` |
| `targetLanguage` | `zh` | 字幕语言 |
| `translate` | `true` | 是否翻译 |
| `translateEngine` | `cloud` | `cloud` / `builtin` / `local` |
| `segmentSeconds` | `4` | 切段长度（2–10） |
| `minSegmentSeconds` | `1.2` | 最短段，过滤咳嗽等短噪声 |
| `keepAudio` | `false` | 是否保留每段音频 |
| `localBaseUrl` / `localModel` | Ollama 默认 | 自建 OpenAI 兼容服务 |

运行中的来源、语言和引擎也可以直接在面板里改，改动写入 `dataRoot/settings.json`，并覆盖这里的默认值。

## 开发

```sh
node .test/client-check.mjs        # 加载 client 包、渲染一次、校验两份字典
node .test/mt-process-check.mjs    # 直接驱动内置翻译子进程
node .test/mock-local-llm.cjs 11434 # 假的 OpenAI 兼容服务，用来验证「本地推理服务」
```

翻译模型权重（`models/`）只在源码检出里存在，**不进仓库、也不进 npm 包**；检出里存在时会在首次使用时复制到宿主的识别模型缓存，避免重复下载。模型署名与许可见 `docs/MODEL-NOTICE.md`。

## License

MIT。第三方模型权重的许可见 `docs/MODEL-NOTICE.md`。
