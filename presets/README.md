# 本地模型预设

跑本地模型（KoboldCpp、SillyTavern、llama.cpp 等）时，可以在**生成的那一刻**就拦住套话，而不是写完再改。这里的文件除了本说明，都由 `npm run presets` 从 [`skills/renwei-deai/data/rules.json`](../skills/renwei-deai/data/rules.json) 生成，不要手改。

> 用 Claude、GPT、DeepSeek 这类云端 API 时，这些采样器参数和短语封禁都用不上。那种情况下靠写作提示词加改稿后的检测脚本。

| 文件 | 用在哪 |
| --- | --- |
| `banned-strings.txt` | 禁用短语，一行一个。KoboldCpp 界面里逐条添加，或者当作你自己的禁用表 |
| `sillytavern-banned-strings.txt` | 同一批短语，SillyTavern 的格式（每行一个带双引号的字符串） |
| `koboldcpp-generate.json` | KoboldCpp `/api/v1/generate` 的请求示例：采样参数加 `banned_tokens` |
| `llama-server-sampling.json` | llama.cpp server `/completion` 的采样参数 |
| `antislop-regex.json` | 句式级的正则禁用表，给 antislop-sampler / antislop-vllm 用 |

## 采样参数：XTC + DRY

[XTC](https://github.com/oobabooga/text-generation-webui/pull/6335)（Exclude Top Choices）在候选词很多时随机去掉最热门的那几个，专门用来打破套话；DRY 惩罚重复出现的片段。两者的作者给出的起手设置是：

1. 先把所有采样器重置成关闭状态（SillyTavern 里点 Neutralize Samplers）。
2. Min P 设 `0.02`。
3. XTC Threshold 设 `0.1`，XTC Probability 设 `0.5`。
4. DRY Multiplier 设 `0.8`。
5. 采样顺序里 Min P 要排在 XTC 前面。

如果输出开始前言不搭后语，先把 XTC Probability 往下调。

## KoboldCpp

KoboldCpp 从 1.76 版开始支持 Anti-Slop 短语封禁：生成到禁用短语时，会退回去换一种写法。

- **界面：** 在 Kobold Lite 的设置里找到 Phrase/Token Ban（短语和词元封禁），把 `banned-strings.txt` 里的短语逐条加进去。
- **API：** 把 `koboldcpp-generate.json` 里的 `prompt` 换成你的提示词，POST 到 `/api/v1/generate`。`banned_tokens` 就是禁用短语列表。

## SillyTavern

1. 在 API 连接里选 Text Completion，后端选 KoboldCpp（或其他支持这些采样器的后端）。
2. 打开采样参数面板，按上面“XTC + DRY”一节设置。
3. 把 `sillytavern-banned-strings.txt` 的内容粘贴到 Banned Tokens/Strings 一栏。

## llama.cpp server

把 `llama-server-sampling.json` 里的字段并进 `/completion` 请求体。llama.cpp 没有短语级封禁，靠 XTC、DRY 降低套话，写完再用检测脚本兜底。

## antislop

[antislop-sampler](https://github.com/sam-paech/antislop-sampler) 和 [antislop-vllm](https://github.com/sam-paech/antislop-vllm) 支持用正则在生成时封禁整个句式，比如“不是……，而是……”。`antislop-regex.json` 是正则字符串数组，传给 antislop-sampler 的 `regex_bans`，或者作为 antislop-vllm 的正则禁用表（具体参数以对应项目的说明为准）。

这些句式在台词里偶尔是正常说法。句式级封禁很强硬，如果发现对话被改得别扭，就只用短语封禁。
