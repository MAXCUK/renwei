# 自定义规则

## 个人禁用词表：`设定/禁用词.txt`

放在小说工作区里，检测脚本会自动读取。也可以用 `--extra <文件>` 指定任意位置的表。

```text
# 井号开头是注释
# 普通文字按原样匹配
邪魅一笑
# 写成 /正则/ 按正则匹配
/[他她]挑了挑眉/
# 行尾加 @数字：每万字允许几次（不写就是 0 次，出现就报）
倒吸一口凉气 @1
```

自定义词一律按【高】级计分。

## 工作区配置：`设定/去AI味.json`

```json
{
  "genre": "古风",
  "allow": ["structure.dash", "modifier"],
  "limits": { "cliche.breath": 4 }
}
```

- `genre`：题材。可填 通用、都市、古风、热血、悬疑（也认 现实、仙侠、武侠、历史、爽文、玄幻、惊悚、推理 等别名）。命令行的 `--genre` 优先。
- `allow`：不检查的规则，可以写规则 id（如 `structure.dash`）或整个类别（如 `modifier`）。节奏检查的 id 是 `rhythm.sentence-cv`、`rhythm.single-sentence`、`rhythm.same-opening`，写 `rhythm` 关掉全部节奏检查。
- `limits`：按规则 id 改每万字限额。

写错的规则名不会报错，但脚本会在输出开头提示“这些规则名不存在”。用 `node scripts/deai-check.mjs --list-rules` 查看全部规则名。

## 内置规则库：`data/rules.json`

每条规则的字段：

| 字段 | 说明 |
| --- | --- |
| `id` | `类别.名字`，唯一 |
| `category` | 类别：cliche、structure、telling、sublimation、dialogue、modifier、connector、residue |
| `name` | 报告里显示的中文名 |
| `severity` | `high`（3 分）、`medium`（2 分）、`low`（1 分） |
| `limit` | 每万字允许出现几次；`0` 表示出现就算超额 |
| `genre` | 可选，按题材覆盖限额，如 `{ "gufeng": 5 }` |
| `scope` | 可选，`narration` 只查叙述，`dialogue` 只查引号里的台词，默认全部 |
| `position` | 可选，`end` 表示只查全文最后 3 段 |
| `pattern` | 正则表达式（JavaScript 语法，带 `u` 标志） |
| `hint` | 改法提示 |
| `match` / `nomatch` | 应该命中、不应该命中的例句，测试会逐条检查 |
| `ban` | 可选，生成本地模型“禁用短语”预设时收录的字面短语 |
| `regexBan` | 可选，为 `true` 时把 `pattern` 收进 antislop 正则预设 |

改完规则在仓库根目录运行 `npm test`：例句不符合预期、正则写错、id 重复都会报出来。改了 `ban` 或 `regexBan` 后再运行 `npm run presets`，重新生成 `presets/` 下的文件。

## 计分方式

- 每条规则的本文限额 = 每万字限额 × 本文汉字数 ÷ 10000，四舍五入。
- 超额次数 × 级别分数，加上每项节奏问题的分数，除以千字数（不足一千字按一千字算），就是 AI 腔指数。
- 同一段里多条规则命中同一处文字时，只算级别最高的那条。
