# dsh-live-captions 全量测试用例

> 每次改动后，把「影响范围」标注的用例全部跑一遍。改动跨平台共享代码（lib/、client.js）时视为影响全部。
> 测试环境：Windows 10/11 x64、macOS 13+（Apple Silicon / Intel 各一台为佳）。
> API 基址：`http://127.0.0.1:<port>/live-captions/api`（端口见 Harness Web GUI）。

## 1. 启动与准备（影响：index.js / native-bin.js / cordis.patch.yml）

| # | 用例 | 预期 |
|---|---|---|
| 1.1 | 启用插件 | 日志出现 `plugin activated`；识别模型后台自动下载，面板/胶囊显示百分比 |
| 1.2 | macOS 无 CLT 环境模拟（改 PATH 或临时移走 swiftc） | 面板顶部出现黄色提示条 + 「打开安装向导」按钮；点按钮弹系统向导（`xcode-select --install`） |
| 1.3 | macOS 有 CLT | 提示条不出现；助手自动编译进 `~/.dsh/live-captions/bin/`（日志 `native-bin: … ready`） |
| 1.4 | 改动 `native/*.swift` 后重载插件 | 源码哈希变化触发自动重编译（新 `overlay-<hash>` 二进制） |
| 1.5 | 与自带「语音输入」插件同开 | 后启用的报「speech service」冲突；关闭其一后恢复正常 |
| 1.6 | 识别模型下载中断后重启 Harness | 从缓存续传/直接 ready，不重复下载 |

## 2. 采集（影响：native/capture.* / lib/capture.js / controller.js）

| # | 用例 | 预期 |
|---|---|---|
| 2.1 | source=speaker，播放视频/`say` | `ready` → draft 每 1.5s → 停顿后出 segment（rms 合理） |
| 2.2 | source=mic，对人说话 | 识别文本与所说内容一致 |
| 2.3 | source=both | 两路混合正常，无报错 |
| 2.4 | 会话中切换 source | 采集进程重启，新会话继续出字幕 |
| 2.5 | 静音/无声音环境跑 20s | 出现「还没检测到声音」提示，不误出字幕 |
| 2.6 | stop 后 | 采集进程退出（`capture exited code=0`），无孤儿进程 |
| 2.7 | keepAudio=false | 识别后 segments/ 里 wav 被删除 |
| 2.8 | keepAudio=true | wav 保留在会话 segments/ 目录 |
| 2.9 | 停止后短噪音（点击/呼吸声） | 不产生 "The."/"嗯" 之类填充字幕（<1.2s 填充词过滤） |
| 2.10 | 权限未授予（首次） | 明确报权限错误而不是静默无声音 |

## 3. 识别与字幕（影响：lib/asr.js / lib/captions.js / controller.js）

| # | 用例 | 预期 |
|---|---|---|
| 3.1 | 中/英/混合语料 | 第一句 ~2s 上屏；草稿被最终文本原地替换（不重复两行） |
| 3.2 | 超长句（>8s 连续说话） | 8s 硬切且后半句接回同一条字幕 |
| 3.3 | 说话间正常停顿 | 在停顿处切分，逐条出字幕 |
| 3.4 | 纯标点/空识别结果 | 不产生字幕行 |

## 4. 翻译引擎（影响：lib/llm.js / lib/mt-*.js / lib/local-mt.js）

| # | 用例 | 预期 |
|---|---|---|
| 4.1 | cloud + 跟随默认模型 | 字幕 ~1-2s 出译文 |
| 4.2 | cloud + 钉选 provider/model | `engine.label` 显示所选模型，译文走该模型 |
| 4.3 | local（Ollama 等 OpenAI 兼容服务） | 译文带服务特征；服务关闭时见 4.5 |
| 4.4 | builtin（首次需 install_mt_deps + download_model） | 依赖安装、模型下载进度可见；macOS 上 sharp 平台包缺失时自动补装；下载完成后 CPU 推理出译文 |
| 4.5 | local 服务不可达 | 原文照常识别；`translationError` 明确提示连不上；**不**偷偷回退云端 |
| 4.6 | 源语言=目标语言 | 不调用翻译，零翻译延迟 |
| 4.7 | targetLanguage 切换（en/zh/ja…） | 新字幕按新目标语言翻译 |
| 4.8 | builtin 模型切换（m2m100 / nllb / opus） | 下载对应模型并生效 |

## 5. 桌面浮层（影响：native/overlay.* / lib/overlay-window.js / api.js）

| # | 用例 | 预期 |
|---|---|---|
| 5.1 | 开始采集 | 浮层自动出现且置顶；状态 running 时显示字幕 |
| 5.2 | **字幕可见性**：会话有 entries 时浮层必须显示字幕行 | 关键回归项：文档视图高度>0，字幕可见（本轮修复项） |
| 5.3 | 空闲时 | 显示「浮层已就绪…」/「正在聆听…」 |
| 5.4 | 拖动正文/工具栏空白 | 窗口跟手移动，无闪跳 |
| 5.5 | 边缘/四角缩放 | 8 个方向尺寸正确（南=下拉缩小、北=上拉放大）；最小 320×140 |
| 5.6 | 点击（不拖动） | 窗口不移动 |
| 5.7 | 工具条按钮 | A±字号、◐±透明度、原文✓/✕、🔒、× 都生效 |
| 5.8 | 锁定 | 点击穿透；面板解锁恢复 |
| 5.9 | 关闭浮层（×） | 识别照常；**不出现页内浮层替代**（`lyricVisible` 已持久化为 false，本轮修复项：Swift POST body 格式错误导致指令从未送达）；面板开关可重开 |
| 5.9b | 浮层进程异常退出（kill） | 同 5.9：不出现页内浮层替代；spawn 失败（failure 非空）时仍保留页内回退 |
| 5.10 | 修改字号/宽度 | 字幕重排（换行宽度随窗口变化） |
| 5.11 | 滚轮回看 | 可上翻，新字幕不顶走视图 |
| 5.12 | 退出 Harness / 关插件 | 浮层自动关闭（无孤儿窗口，~6s 内） |
| 5.13 | geometry 持久化 | 拖动/缩放后重启 Harness 位置保留；`lyricReset` 清空 |

## 6. 面板与记录（影响：client.js / lib/captions.js / controller.js）

| # | 用例 | 预期 |
|---|---|---|
| 6.1 | 面板各控件 | 来源/源语言/目标语言/翻译开关/引擎选择即时生效并写入 settings.json |
| 6.2 | 转写记录列表 | 实时出现字幕；条数统计正确 |
| 6.3 | 记录弹窗（⧉） | 独立窗口可拖动，实时刷新 |
| 6.4 | 「记录」对话框 | 列表按 `时间 · 时长 · 条数` 展示；删除单个会话（磁盘目录同步删除）；复制全部 |
| 6.5 | 删除当前会话 | 面板与磁盘转写清空，时间戳不回跳 |

## 7. 会议纪要（影响：lib/llm.js / controller.js）

| # | 用例 | 预期 |
|---|---|---|
| 7.1 | 面板「生成纪要」 | 打开新会话并把转写+提示词填入输入框 |
| 7.2 | agent 工具 `minutes` | 生成 `minutes/<会话>-minutes.md`，结构含概要/议题/结论/待办/风险 |
| 7.3 | 空会话生成纪要 | 明确提示无可转写内容 |

## 8. agent 工具（影响：index.js / lib/api.js）

| # | 用例 | 预期 |
|---|---|---|
| 8.1 | `status` | 状态/来源/引擎/最近字幕正确 |
| 8.2 | `start`/`stop`（含参数覆盖） | 与面板行为一致 |
| 8.3 | `models` | 云端 provider/model 列表 + 离线目录及下载状态 |
| 8.4 | `records` / `settings` / `prepare` | 各自生效 |
| 8.5 | `install_mt_deps` | 依赖安装并反馈 |

## 9. 生命周期（影响：index.js / lib/lifecycle 相关）

| # | 用例 | 预期 |
|---|---|---|
| 9.1 | 重启 Harness | 插件自动激活；缓存模型/二进制不重下重编；无残留采集/浮层进程 |
| 9.2 | 禁用插件 | 采集停止、浮层关闭；数据保留 |
| 9.3 | 旧数据迁移 | `~/.dsh/meeting-captions` 存在时迁移到 `live-captions` |
| 9.4 | 长会话（≥30min） | 内存稳定（entries 上限 600）；日志不超限 |

## 10. 跨平台回归（改动 lib/ 或 client.js 时必测）

| # | 用例 | Windows | macOS |
|---|---|---|---|
| 10.1 | 面板/记录/纪要/翻译全链路 | ✅ | ✅ |
| 10.2 | 浮层拖动/缩放/锁定 | ✅ | ✅ |
| 10.3 | settings.json 字段兼容 | ✅ | ✅ |
| 10.4 | `local-mt` npm 安装（win 用 npm.cmd + shell） | ✅ | ✅ |

## 快速回归脚本

```sh
node .test/client-check.mjs             # client 包加载 + 字典校验
node .test/minutes-autosend-check.mjs   # 生成纪要自动发送（wire-first：create → Remote session/prompt → openSession；含慢 ready、create 失败、prompt 拒绝场景）
node .test/mt-process-check.mjs         # 内置翻译子进程
node .test/mock-local-llm.cjs 52790     # 本地引擎 mock
```

浮层可见性无法用截图验证时（screencapture 权限/Space 限制），用
`LC_OVERLAY_DEBUG=1` 运行浮层看 `occlusion=… visible=true` 与字幕条数日志。
