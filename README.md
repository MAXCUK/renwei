# 人味 renwei

让 AI 写出像人写的中文小说。

一套给 Cursor、Claude Code、Codex 等 AI 助手用的中文小说写作 skill：从立项、大纲、细纲到正文、去 AI 味、文风学习、审稿、断点续写，整套流程落在你自己的文件夹里；配套的检测脚本把“AI 腔”量化成一个分数，改没改好一跑就知道。

## 效果

同一个场景，左边是 AI 常见的写法，右边是按这套方法改出来的（全文见 [`examples/`](examples/)）：

| AI 原稿 | 改稿 |
| --- | --- |
| 夜色如墨，县城殡仪馆的走廊里空无一人。 | 殡仪馆在县城最北头，过了加油站再走五百米。 |
| 老周坐在桌边，嘴角勾起一抹意味深长的弧度。“来了？”他淡淡地说道。 | 老周把烟按灭在茶杯盖上。“来了？” |
| 陈默不知道的是，一场风暴正在酝酿。 | 十一点四十，走廊尽头的灯亮了。 |
| 或许，这就是命运吧。而这，只是开始。 | 没有脚步声。 |

检测脚本对两份稿子的判断：

```text
━━ examples/夜班-AI原稿.md ━━
字数 393 · 汉字 337 · 句子 22 · 段落 14 · 对话占比 4%
AI 腔指数 78（AI 腔严重）· 超额：高 14 · 中 16 · 低 4

【高】不是X，而是Y · 句式套路 · 1 处（本文限额 0）
  第 7 行  这[不是他第一次值夜班，而是]他第一次一个人值夜班。
  改法：先否定再肯定，是在跟一个不存在的人辩论。直接写 Y，或者让人物用行动表现出“不是 X”。
……

━━ examples/夜班-改稿.md ━━
字数 397 · 汉字 335 · 句子 22 · 段落 14 · 对话占比 16%
AI 腔指数 0（自然）· 超额：高 0 · 中 0 · 低 0
```

## 里面有什么

| skill | 做什么 | 什么时候会用上 |
| --- | --- | --- |
| [`renwei-novel`](skills/renwei-novel/SKILL.md) | 主流程：建工作区、立项、构思（带反套路检查）、人物与世界、大纲、细纲、写正文、归档伏笔和人物状态、断点续写、接手旧稿、卡文诊断 | “开一本新书”“继续写第 12 章”“卡文了” |
| [`renwei-deai`](skills/renwei-deai/SKILL.md) | 去 AI 味：71 条规则加 3 项节奏检查扫出 AI 腔，再分三遍改写，不动剧情 | “这段太 AI 了”“去 AI 味” |
| [`renwei-style`](skills/renwei-style/SKILL.md) | 文风：从样本提炼规则和数值指纹；对比 AI 原稿和你的改稿，学会你怎么改；检查新章节有没有跑偏 | “学一下这个文风”“我改过的你学学” |
| [`renwei-review`](skills/renwei-review/SKILL.md) | 审稿：对照设定查吃书和人物走样，模拟读者逐段读，7 维打分，出分级修改清单 | “审一下这章”“有没有吃书” |

另外两样不依赖 agent：

- [`prompts/`](prompts/)：网页版 AI（ChatGPT、Claude、DeepSeek、Kimi、豆包……）直接复制就能用的提示词，覆盖构思、人物卡、细纲、写正文、去 AI 味、文风学习、审稿。
- [`presets/`](presets/)：跑本地模型时用的预设，包括 KoboldCpp 和 SillyTavern 的禁用短语表、XTC/DRY 采样参数、antislop 句式正则，在生成时就拦住套话。

## 安装

脚本需要 [Node.js](https://nodejs.org/) 18.3 或更高版本，不用装任何依赖。

**用 Skills CLI（推荐，Cursor、Claude Code、Codex 等通用）：**

```bash
npx skills add MAXCUK/renwei -a cursor -g
```

它会列出四个 skill 让你选，建议全装，它们会互相调用。`-g` 表示装到全局：新版 Skills CLI 默认放在 `~/.agents/skills/`（Windows 上是 `%USERPROFILE%\.agents\skills\`），Cursor 和 Codex 都会读这个目录。装给 Claude Code 就把 `-a cursor` 换成 `-a claude-code`。

**手动安装：** 把仓库克隆下来，把 `skills/` 下的四个文件夹复制到 `~/.cursor/skills/`（Claude Code 是 `~/.claude/skills/`）。

**Claude Code 插件：**

```text
/plugin marketplace add MAXCUK/renwei
/plugin install renwei@renwei
```

**Cursor 插件：** 仓库根目录带了 `.cursor-plugin/marketplace.json`，可以在 Cursor 的 Customize 里用 From GitHub Repository 导入。

## 怎么用

在 Cursor（或 Claude Code）的 agent 对话里直接说：

```text
用 renwei-novel 开一本新书：一个在县城殡仪馆上夜班的年轻人。长篇，番茄连载，每章 2500 字。
```

它会建一个工作区文件夹，问你几个关键参数，给你三个不同的构思方案让你选，然后一步步往下走。之后每次开工：

```text
继续写《夜班》
```

它先读 `进度.md` 和伏笔表，告诉你写到哪了、哪些伏笔该收了，再接着写。其他常用说法：

```text
这段太 AI 了，帮我去 AI 味：（贴正文）
学一下这三段的文风：（贴样本）
这是 AI 原稿和我的改稿，你学一下我是怎么改的
审一下第 12 章
卡文了，第 30 章不知道怎么往下写
```

## 为什么这样设计

1. **样本比形容词管用。** “文笔生动、有人味”这种要求几乎没用。给 AI 一段具体的文字，或者一份你亲手改过的稿子，它才知道你要什么。
2. **写和改分开。** 写正文时只给正面写法；去 AI 味的套话清单只在改稿时用。把一大张禁用词表塞进写作提示词，列出来的词反而容易被勾出来。
3. **看频率，不搞一刀切。** 一章出现一次“深吸一口气”没事，五次才是问题。每条规则都有每万字的限额，古风、热血这类题材会自动放宽成语和比喻的限额。
4. **磁盘就是记忆。** 设定、伏笔、人物状态、进度全写在文件里。换个对话、换台电脑、换个模型，都能接着写。
5. **关键处人拍板。** 选构思、定首章、审稿不过线，这些地方一定停下来问你。

## 小说工作区

`renwei-novel` 建的文件夹长这样：

```text
夜班/
├── 进度.md            写到哪了、下一步、等你决定的事
├── 设定/              立项、人物、世界、文风、不可改动的设定、个人禁用词
├── 大纲/              全书大纲、每章细纲
├── 正文/              第001章.md、第002章.md……
├── 追踪/              伏笔表、人物状态、时间线、章节摘要
└── 审稿/              每章的去 AI 味报告和审稿意见
```

## 脚本速查

这些脚本 agent 会自己调用，你也可以在终端里直接跑：

```bash
# 去 AI 味检测（文件或整个目录；--genre 古风 放宽古风题材的限额；--json 输出 JSON）
node skills/renwei-deai/scripts/deai-check.mjs 正文/
node skills/renwei-deai/scripts/deai-check.mjs --list-rules

# 文风指纹：建基线、对比学习、漂移检查
node skills/renwei-style/scripts/style-fingerprint.mjs 样本.md --save 设定/文风指纹.json
node skills/renwei-style/scripts/style-fingerprint.mjs --compare AI原稿.md 我的改稿.md
node skills/renwei-style/scripts/style-fingerprint.mjs 正文/第012章.md --baseline 设定/文风指纹.json

# 小说工作区：新建、查进度和伏笔
node skills/renwei-novel/scripts/init-novel.mjs 夜班 --dir ~/小说
node skills/renwei-novel/scripts/novel-status.mjs ~/小说/夜班
```

Windows 的老式命令提示符里中文可能显示成乱码，用 Windows Terminal，或者先运行 `chcp 65001`。

## 自定义

- **这本书专用的禁用词：** 写进工作区的 `设定/禁用词.txt`，每行一个；`/正则/` 也行；行尾加 `@2` 表示每万字允许两次。
- **关掉某条规则、设定题材：** 改工作区的 `设定/去AI味.json`。
- **改内置规则：** 编辑 [`skills/renwei-deai/data/rules.json`](skills/renwei-deai/data/rules.json)。每条规则都带“应该命中 / 不应该命中”的例句，测试会逐条检查。字段说明见 [`custom-rules.md`](skills/renwei-deai/references/custom-rules.md)。

## 开发

```bash
npm run check     # 同步检查 + 预设检查 + 结构校验 + 全部测试
npm test          # 只跑测试
npm run sync      # 改了 shared/zh-text.mjs 之后，同步到各 skill
npm run presets   # 改了规则的 ban / regexBan 之后，重新生成 presets/
```

三个 skill 共用的中文文本工具在 `shared/zh-text.mjs`，每个 skill 的 `scripts/lib/` 里放一份副本，这样单独安装任何一个 skill 都能用。改共用代码时只改 `shared/`，再运行 `npm run sync`。

## 致谢

这套工具的思路受这些项目和资料启发，文字和代码都是重新写的：

- [blader/humanizer](https://github.com/blader/humanizer) 和 [op7418/Humanizer-zh](https://github.com/op7418/Humanizer-zh)：把“去 AI 味”做成 skill 的先行者，模式清单来自维基百科编辑整理的 [Signs of AI writing](https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing)。
- [hardikpandya/stop-slop](https://github.com/hardikpandya/stop-slop)：套话、结构和打分的分类方式。
- [ximencuisu/ximen-aimazi](https://github.com/ximencuisu/ximen-aimazi)：中文网文的去 AI 味门禁、文风对比学习。
- [voocel/ainovel-cli](https://github.com/voocel/ainovel-cli) 和 [haowjy/creative-writing-skills](https://github.com/haowjy/creative-writing-skills)：长篇的滚动规划、写作与审稿分离、读者模拟。
- [sam-paech/antislop-sampler](https://github.com/sam-paech/antislop-sampler) 和 [Antislop 论文](https://arxiv.org/abs/2510.15061)：用回退采样封禁套话，以及“禁用清单放进提示词可能适得其反”的观察。
- [XTC](https://github.com/oobabooga/text-generation-webui/pull/6335) 和 DRY 采样器（p-e-w），[KoboldCpp](https://github.com/LostRuins/koboldcpp) 的短语封禁。
- [EQ-Bench Creative Writing](https://eqbench.com/creative_writing.html)：用 Slop 分数衡量套话密度的做法。

## 许可

[MIT](LICENSE)
