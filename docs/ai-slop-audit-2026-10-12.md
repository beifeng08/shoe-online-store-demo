# AI Slop 审计报告（2026-10-12）

本报告是 `docs/superpowers/plans/2026-10-12-ai-slop-audit.md`（方法与边界）与
`2026-10-12-ai-slop-boundaries.md`（辖区划分与两批次工作流）的执行结果。

按仓库约定，带日期的报告是**唯一允许携带易腐快照**（计数、行号、引文）的地方；
常驻文档只写要求与可复跑命令。本报告中的行号在修复后会漂移，定位请以符号名为准。

## 1. slop 的定义与判据

判定标准不是「难看」，而是 **「删掉它不损害任何行为/契约/证据，却让读者以为它传达了信息」**。
每条发现必须能回答「删掉谁受损」，并给出可复跑的复核命令。

审计期间确认的一个关键区分：**判据本身极易产生假阳性**。扫描器先后产出过假的
「不可达」「被注释掉的代码」「死导出」，并在自己的测试夹具上自指误报。
因此每条发现都要求注明证据强度（`mechanical` / `needs-human`），机械候选一律**不得**
直接升格为结论。

## 2. 方法

| 阶段 | 执行体 | 模型 | 产出 |
| --- | --- | --- | --- |
| 批次一 | 14 个 `reviewer`（只读），每辖区 1 个 | `dimeta-openai/gpt-6.1-sol` | 7 条发现 |
| 批次一 B | 6 个 `reviewer`，专职垃圾注释 + 死代码 | `dimeta-openai/gpt-6.1-sol` | 4 条发现 |
| 机械层 | 父进程零依赖扫描器（TS Compiler API + Python `ast`） | — | 候选事实 |
| 引文闸门 | 父进程逐一复核 `文件存在` + `引文归一化逐字命中` | — | 13 条原始 → 11 通过 → 10 去重 |
| 批次二 | 14 个 `reviewer`，每辖区 1 个，**对抗性** | `dimeta-domestic/deepseek-v4.1-flash` | 14 份判定 |
| 仲裁 | 父进程 + 跨区指针汇总 | — | 本报告 |

两批次串行，批次二是**对抗性**的：要求先给出最强反驳，再用证据判定
`confirmed` / `refuted` / `downgrade` / `uncertain`，并限定**一跳**牵连。
共 28 个子智能体，并发上限 3（父进程的机械工作不占该额度）。

**为什么批次二是对抗性的**：若第二批次只是「解释」第一批次的发现，它只会把第一批次的
错误放大。事实证明了这一点——批次二推翻了 1 条、降级了 3 条。详见 §4。

## 3. 结果总表

14 条经仲裁的发现。`判定` 来自批次二；`状态` 是本报告落笔时的实际状态。

| # | 位置（符号） | 判据 | 级别 | 判定 | 状态 |
| --- | --- | --- | --- | --- | --- |
| 1 | `docs/agents/commerce-contract.md` 数据和迁移 / Alembic 断言 | B | P1 | confirmed | **已修** |
| 2 | `docs/archive/HANDOVER.md` 归档后相对链接 | B | P2 | confirmed | **已修** |
| 3 | `src/lib/seo.ts` `siteUrl` 死导出 | C | P2 | confirmed | **已修** |
| 4 | `docs/agents/verification.md` 入口表漏 `test:slop:python` | B | P3 | confirmed | **已修** |
| 5 | `docs/agents/verification.md` 机械扫描边界写死计数 | B+J | P2 | confirmed | **已修** |
| 6 | `docs/archive/README.md` 规则与实际行为不一致 + `HANDOVER.md:526` 静默错误链接 | B | P2 | confirmed | **已修** |
| 7 | `src/server/guardrails/index.ts` `pushTurn` 注释 vs `slice(4000)` | A | P2→P3 | downgrade | **已修**（仅注释） |
| 8 | `src/server/catalog/adapter-contract.test.ts` `{} as Product` | F | P2 | confirmed | **已修** |
| 9 | `src/test/a11y/contrast.test.ts` 镜像 token 字面量 | F | P2 | downgrade | **已修** |
| 10 | `src/app/api/catalog/route.ts` `GET` 不可达 catch | D | P2 | confirmed | **已修** |
| 11 | `src/components/shop/product-actions.tsx` `ProductActionsProps.buyUrl` | H | P2 | downgrade | **已修**（仅 JSDoc） |
| 12 | `scripts/import-catalog/import.py` col 升序注释 | B | P2 | confirmed | **已修** |
| 13 | `src/components/shop/my-size-guide.tsx:45` `neutral-400` 真实文字 + 假 guardrail | B+F | P2 | 父进程确认 | **已修** |
| 14 | `backend/app/application/expiry.py` `_log_event` | A | P2 | **refuted** | **不改** |

关于第 1–13 条（已修）：其中 1、2 是我在此前 PR #24 中**自己引入**的缺陷；
4、5、6 是**本轮**引入的。它们被审计抓出，而非被审计放过——这本身就是审计有效的证据。
**14 条中 13 条已修，1 条推翻不改。**

## 4. 一条被推翻的发现，以及我犯的方法论错误

`backend/app/application/expiry.py` 的 `_log_event` 曾被报为 A 类（注释声称
「坏的 handler 不得隐藏安全失败信号」，而实现是 `except Exception: pass`）。

**该发现是错的。** 事实是：

- `_log_event` 在 `expiry.py:73` 被调用，紧接着 `expiry.py:74` 是
  `raise RuntimeError("Reservation sweep candidate query failed") from None`；
- `except` 的存在**正是为了不让日志异常在这两行之间抢先抛出**；
- 删掉它才会真正隐藏脱敏后的失败信号——恰好是注释声称要防的事；
- 三条既有测试（`test_logging_failure_keeps_partial_progress_and_safe_error`、
  `test_logging_failure_does_not_change_success_count`、`test_worker_survives_logging_failure`）
  正是在固定这个行为。

**我在审计中途向用户报告过「LLM 判断与机械检测在同一位置吻合，是比单一来源更强的证据」。
这个推理是错的。** 两个「独立」来源命中的是**同一个语法特征**（`except …: pass`）：
机械层无法区分「保护脱敏 raise 的 except」与「吞掉错误的 except」，二者字节级同形。
**同特征 ≠ 独立证据。** 把语法层的重合当成语义层的交叉验证，是本轮最值得记住的教训。

波及的机械判据已处理：

- Python 侧的 `silent-except` 规则**删除**。实测 3 个 `except …: pass` 全部合法
  （另两个：`expiry.py:120` 是 `asyncio.wait_for` 的正常停止条件；
  `main.py:91` 是 UUID 解析失败的 fail-safe 回退）。例外不可表达、假阳性率 100% 的判据
  不该留在产物里——留着只会训练人忽略工具。
- `dead-definition` 相反：其唯一命中 `WebhookEvent` 的例外**可以表达**
  （SQLAlchemy 声明式模型由 `Base.metadata` 与迁移 `41e28c896353` 消费，类名不出现在
  Python 代码里），因此**收紧规则**（排除 `Base` 子类）而非删除规则。

> 一般原则：**能表达例外的判据就收紧，不能表达例外的判据就删除。**
> 不要保留一条长期误报的规则并期望读者学会忽略它。

## 5. 门禁固化：`npm run check:slop`

审计产出的扫描器已冻结为常驻门禁，接在 `verify`（TS 侧）与 `verify:python`（Python 侧）里。

| 文件 | 说明 |
| --- | --- |
| `scripts/check-slop.mjs` | TS 侧，零依赖（仅需 `typescript`），AST + 注释 token 判据 |
| `scripts/check-slop.test.ts` | 24 条回归用例，锁住每一类历史假阳性 |
| `scripts/check-slop-python.py` | Python 侧，仅用标准库 `ast`，含 7 项内置自检 |

**严重度分配**：只有假阳性被驱动到零的判据才允许阻塞。

- 阻塞：无入口文件、死导出、不可达语句、stray-focus 测试、无理由 `@ts-ignore`、未使用的 import
- 提示：被注释掉的代码、标记词、条件跳过测试、未说明理由的 `eslint-disable`

**刻意不覆盖**：注释是否空心、测试是否真在验证行为、抽象是否多余。
本轮最有价值的几条发现（第 8、9、13 条）机械层**完全测不到**，全部来自模型判读。
**门禁通过不等于没有 slop** —— 这句话必须在读门禁输出前先读到。

### 5.1 门禁第一次运行就暴露了它自己的盲点

`check:slop` 接入 `verify` 后长时间报 0 阻塞，而 `siteUrl` 确实是死导出。
原因是跨文件「谁引用了这个名字」当时用**正则扫全文**，于是
`scripts/check-slop.test.ts` 里 `'export const siteUrl = () => 1\n'` 这个**字符串字面量
被当成了外部消费者**。

**一个本该抓出问题的门禁，被自己的夹具遮住了**——它给出的是虚假保证，比没有门禁更糟。
改为从 **AST 标识符**取之后立即报出该导出。修复动作是**删掉那一行死代码**，
而不是放宽规则：门禁抓到真实缺陷时，改代码，不要改指标。

同一轮还暴露了一个判据设计教训：**注释类判据必须走注释 token，focus 类判据必须走 AST**。
任何按行匹配字符串的实现，都会在夹具与常量上自指误报。

## 6. 未执行 / 未验证

诚实列出本报告的边界：

- **真实 PostgreSQL TLS 与运行时集成**：未在本机执行（需 opt-in 环境变量与一次性数据库）。
- **`npm run verify:python` 全链**：未执行。本机无 `backend/.venv`，PATH 上的 `python3`
  缺 pytest/mypy/alembic。Python 侧的 slop 扫描与自检**已单独执行通过**。
- **正式域名 SEO 复测**：未执行，不在本次范围。
- **第 11 条（`buyUrl`）的处理方向未定**，见 §7。
- **`backend/app/application/expiry.py` 的 Pyright `import sqlalchemy` 报错**是环境产物
  （无 venv），非代码缺陷；该文件本次未被修改。

## 7. 修复记录与剩余项

审计本身是**只读**的；以下修复由用户逐项授权后进行，各自独立、可单独回退。

已修（2026-10-12，用户授权「机械可判定的 4 条」+「`buyUrl` 只改 JSDoc」）：

1. **第 10 条**：`catalog/route.ts` `GET` 删掉不可达的 try/catch，改为 `const url = new URL(req.url)`。
   响应状态码与响应体语义未变（仍不抛 500，仍返回 `[]`）。注意 `!handles.length` 分支**不是**冗余：
   `raw=","` 时分割后确实为空，可达。
2. **第 8 条**：删除 `adapter-contract.test.ts` 中恒真的整个用例块，并同步收窄该文件的
   `import type`（否则留下未使用的 `Product`）。**未**用更强的空对象断言「补强」（那只是把 F 换成 E）。
   该契约的真实覆盖仍在 `seed.test.ts` 与 `src/domain/size.test.ts`，未被触碰。
3. **第 12 条**：`import.py` 与 `scripts/import-catalog/README.md` 的「按 col 升序」改为实现事实
   （沿用 XML 文档出现顺序）。**只改文字，未加排序代码**。
4. **第 7 条**：`guardrails/index.ts` `pushTurn` 的 JSDoc 去掉「全文」保真承诺，并写明裁剪发生在
   存储层、属 I7 验收项。**未**触碰 `MAX_HISTORY_MESSAGE_CHARS` / `HISTORY_TURNS`。
5. **第 11 条**：按批次二建议，只改 `product-actions.tsx` 的 JSDoc，写明该 prop 当前不被组件消费、
   是已延后通道的尾端。prop 声明与全部调用点保留。

仍待授权：**无**（14 条均已收敛：13 修 + 1 推翻）。

### 7.1 第 13 条：`my-size-guide` 提示文字的取色

三处 `text-neutral-400` 逐一判定，只有一处是真问题：

| 位置 | 性质 | 处置 |
| --- | --- | --- |
| 提示文字（`Change or remove` / `Get size-matched guidance`） | 12px 真实文字，需 4.5:1 | **改为 `text-neutral-500`** |
| `▾` 展开箭头 | 带 `aria-hidden="true"`，纯装饰 | 不改（不受 4.5 约束） |
| 量脚示意图内联 SVG | `role="img"` + `aria-label`，属图形（1.4.11 为 3:1） | 不改——其含义已由紧邻的 `<p class="text-xs text-neutral-600">` 完整承担，适用「信息已有其他形式」豁免 |

选 `neutral-500` 的依据：它是**仓库自订的正文下限**（本测试文件头部即写明「小字正文用
neutral-500 起步」），且在真实底色（`bg-surface` = `#ffffff`）上为 **4.74:1**。

**审计漏报的一条**：批次二只算了浅色。深色主题下现状**更糟**——深色 ramp 把
`text-neutral-400` 解析为 `oklch(0.5 0 0)` = `#636363`而非 `#a3a3a3`，在 `#202020` 上仅 **2.71:1**。
该证据已补入 guardrail（现在声明两主题的比值约束，而非声称「不再用于正文」这个它无法检查的用途）。

代价如实记录：`neutral-500` 在深色下为 **4.66:1**，距 4.5 只有 0.16 余量。
若日后深色 ramp 再调，该断言会先红提醒。

### 7.2 第 9 条：只做定向漂移断言，不做完整 CSS 解析

批次二建议「改为从 `globals.css` 解析 token」。核实后**未采纳**，改做更小的方案，理由具体：

- 只有语义色板（`--canvas/--ink/--brand/--surface`）是 hex；浅色的
  `--background/--foreground/…` 与**深色的整个 neutral 阶梯都是 `oklch()`**。
  重算对比度需实现 OKLCH→sRGB（OKLab 矩阵 + gamma + 色域钳制），
  写错得到的是**假绿**——比诚实的「镜像 + 注明来源」更糟；
- 现断言对深色本就偏乐观：写死 `#8f8f8f`，真实 `oklch(0.63 0 0)` = `#898989`（差 6/255），
  声称 5.04 而真实 4.66。已改为真实值并把推导（`C=0` 时线性 sRGB `= L³`）写进注释。

落地内容：新增 9 条漂移断言（只读那 8 个 hex 语义 token），把散落的 hex 字面量收进
`PALETTE`/`NEUTRAL`/`DARK_NEUTRAL` 常量，使对比度断言与漂移断言**共享同一来源**
（否则漂移断言校验的常量与真正参与断言的常量不是同一份，校验会变成空转）。

按本项目自己的判据纪律做了**校准**：把镜像常量改错后断言确实变红并给出
「globals.css 的 浅色 :root --canvas 已变更；请同步本文件 PALETTE」的明确失败信息。
一个不会失败的断言不算资产。

实施中还撞到两个真问题：`import.meta.url` 在 vitest 下不是 `file:` 协议（改用 `process.cwd()`），
以及文件顶部的 `@custom-variant dark (@media (prefers-color-scheme: dark));` 会让
裸 `indexOf` 把深色块切错位置——现改为锚在行首，并加一条「结构变更即明确失败」的断言。

### 7.3 一处有意不服从的静态检查

修第 10 条后，pi-lens 的通用规则（`new URL()` 必须包 try/catch）重新报阻塞。
**该判定为假阳性，已用 `lens_diagnostic_mark` 标注**，原因是可执行证据：

- `new Request('/api/catalog')` 构造即抛 `TypeError: Failed to parse URL`
  ——任何 `Request` 都无法携带相对 URL；
- `NextRequest` 构造在 `next/dist/server/web/spec-extension/request.js:31` 先调 `validateURL`
  （`String(new URL(String(url)))`），非法 URL 在构造阶段抛 E61。

故「无效 URL」这一输入不存在，try/catch 可证不可达。**为满足通用规则把死代码加回去，
等于恢复刚被审计判定的 slop。** 该不该加 try/catch 取决于输入是否可能非法，
而不是取决于调用形态——通用规则看不到这个区别。

## 8. 复核命令

```bash
npm run verify              # 含 check:slop，两侧门禁必须为 0 阻塞
npm run check:slop          # 单跑 TS 侧扫描
npm run check:slop:python   # 单跑 Python 侧扫描
npm run test:slop:python    # 跑 Python 扫描器的假阳性回归自检
npm run py -- -m pytest -q backend/tests/test_expiry.py   # 第 14 条的 refuted 证据
```

## 9. 关于原始 JSONL 产物

计划文档中约定的 `slop-findings.jsonl` **未写入仓库**：它与本报告的表格是同源的易腐数据，
再存一份没有额外消费者，却会在修复后与代码失去对应关系。需要机器可读形式时，
用 `npm run check:slop -- --json` 从**当前代码**重新生成，比读一份历史快照更可靠。
