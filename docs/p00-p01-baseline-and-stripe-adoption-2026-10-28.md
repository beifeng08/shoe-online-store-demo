# P00/P01 隔离基线与 Stripe 草稿采用记录

> 2026-10-28 调查快照；不是支付实施、数据迁移或发布验收。
> P00 账户内部调查及 P01 PostgreSQL／浏览器验收仍未完成。
> 本变更仅新增本报告；不修改业务代码、配置、依赖、迁移、门禁或生成契约。

## 1. 目标、范围与实施选择

用户要求按“保全真实数据 → 对齐最新 main → 修复 Stripe 草稿 → 美国／USD 测试支付 → 迁移演练 → 单机预发布 → 受控切换”推进，并授权阶段提交、推送和上游 PR；不自动合并或正式部署，不接 live 收付款。

本阶段输入是用户提供的三份同日规划：`project-roadmap-2026-10-28.md`、`project-contracts-2026-10-28.md`、`project-agent-runbook-2026-10-28.md`。它们位于用户原工作目录，尚未纳入本分支；这里记录其 P00/P01 调查要求，不复制或代为提交这些未跟踪文件。

选择从重新核验的 main 建立隔离基线，按模块采纳 #27；不直接合并旧支付分支，也不在用户 dirty 工作区修冲突。代价是逐项接线和复验，但可以保留 main 后续契约、购买保护及 runner 行为。若上游版本变化，先记录新 SHA、比较差异，再重做受影响基线，不能沿用旧结果声称新版本通过。

旧 R3 未提交成果和原始失败证据保持原状，不夹带进本 PR。其最近全量结果为 859 passed / 1 failed / 21 skipped，剩余目录 CLI 整例 5000ms timeout；该轮 build／Python 未执行，不宣称 R3 已验收。R4/R5 主体延后至交易稳定后的 P10。

## 2. 版本身份与远端状态

以下为本次 GitHub 查询及本地只读核验结果，不代表未来状态：

| 对象 | 固定身份 | 观察结果 |
| --- | --- | --- |
| 上游 main | `302a3c2c8b218d9850508d7af3b5520883916575` | GitHub branches/main 单独查询所得；隔离工作树初始 HEAD 相同且干净 |
| 本地实施分支 | `codex/p01-baseline-20261028` | 基于上述 main；本报告提交后的 head 由 PR 记录 |
| main tree | `d9a4e9fe6f91dd28a900598586e92b31375a9e68` | 基线 manifest 的 tree |
| Stripe #27 | `bdd6fa1737c3e2f25d04ecbfdb0c99958b81348b` | OPEN、draft、CONFLICTING；来源分支 `feat/stripe-payments` |
| i18n #26 | `6dc147036b99899c6ceb8cec0b0679607e3c9cc0` | OPEN、draft、CONFLICTING；不在本阶段整合范围 |
| main 与 #27 merge-base | `b82352a43e26e50644b3d9384aff8c9e41f41137` | 与 #27 查询返回的 baseRefOid 相同，但不等于最新 main |

- 上游：`WhatDamon/shoe-online-store-demo`；fork：`beifeng08/shoe-online-store-demo`。本地 `upstream` 指向前者，`origin` 指向后者。
- #27 的 Node 22／24、Python 检查成功，`postgres-commerce` 失败；不能只引用绿色检查。
- GitHub Production deployment `7217500878` 记录上述 main SHA，最新 status 为 success；该记录创建于 `2026-10-21T04:12:54Z`。
- Stripe Preview deployment `7116922226` 记录上述 #27 SHA，最新 status 为 success。
- deployment success 不证明正式域名当前 alias、Python 服务健康、数据库连接或支付闭环。本阶段没有从 Vercel 账户内部核验这些事项。
- `main...#27` 三点 diff 是共同祖先至支付分支的改动，不是对最新 main 的三方合并结果。端点比较缺少 main 后续资产，不等于 PR 作者主动删除；采用时仍必须防止覆盖回退。

## 3. P00 数据与部署调查：未闭合项

| 调查对象 | 当前证据边界 | 关闭条件／参与者 |
| --- | --- | --- |
| 正式域名 → 实际 deployment SHA | 只有 GitHub deployment 记录，alias 未核实 | 用户在现有账户完成必要登录；Agent 读取正式域名关联记录 |
| Next → Python 的 503 | 先前外部观察为展示页 200、购买接口 503；本轮未重新发起生产写请求，未定位内部失败边界 | 只读追踪 Next 日志、安全 request ID、上游 URL／secret 配对、Python、DB TLS／权限／迁移 |
| TS 展示／AI 数据资源 | 实际生产 driver、实例、schema、写入方未核实 | 受限环境清单、脱敏资源指纹及只读元数据 |
| Python 交易库与部署 | 实际宿主、数据库提供方、schema、migration head 未核实 | 找到受控只读访问，确认交易权威和唯一写入方 |
| 历史客户／订单／付款 | 来源、行数、状态、币种、时间范围、未履约和退款义务未核实 | 用户确认来源及义务范围，Agent 做只读聚合与来源映射；未知不填 0 |
| 历史 Stripe／Shopify | account、test/live mode、外部 ID 与本地关联未核实 | 从已授权账户读取必要元数据，不复制卡号、CVC 或完整支付对象 |
| 草稿 revision 使用历史 | `1fbc05b17480` 是否在共享／真实环境执行未知 | 决定修草稿或做前向修复前，确认所有已使用环境 |
| 备份与恢复 | 未取得实际恢复成功证据 | 在隔离目标恢复并核对关系、金额、库存、来源映射和访问恢复；通过前不迁写 |

不要求在聊天发送密码、API secret、完整 Cookie 或连接串。没有账户内部证据时，不把真实数据视为空库，也不运行生产 seed、smoke、pytest 或写入修复。

## 4. P01 已执行基线

### 4.1 源码、依赖与隔离

- 实测 Node `v22.22.2`、Python `3.12.14`。
- 复用 main 的 `scripts/verify_isolated.py`：源码物理快照、排除 dotenv／数据库／缓存、白名单子进程环境、一次性 SQLite、回环服务和受管进程清理；未修改 runner。
- Node 依赖使用显式来源的锁匹配物理副本，不借用 dirty 代码或软链接执行；Python 依赖 gate 核对精确版本与依赖冲突，结果通过。
- 初始 manifest：`dirty=false`；SHA256 `f600410caa53bdad062000a2547ccc2a53acadf8c808d05b035508316de4e1a0`。
- `package-lock.json` SHA256：`1570bf2122614cda4c2c7ded28b62a3496eb5cbd9cf9e9a8f5ea74ca8e27ea81`。
- `backend/requirements-dev.lock` SHA256：`b65e3d744276069326a9d3e90026cfbdf96ed52d49ae9217cbf3b89717c59fc2`。

### 4.2 实际结果与缺口

| 检查 | 入口／证据 | 本次结果 |
| --- | --- | --- |
| 隔离 full + quality | `scripts/verify_isolated.py --profile full --quality`；其余显式路径参数见私有 evidence | 18 个已执行 gate 全部 passed；16 条 cleanup 均 `closed=true`；overall **incomplete** |
| TS 全门禁 | runner 内执行 `npm run verify` | exit 0；85 文件通过、3 文件跳过；819 测试通过、16 跳过 |
| 生产构建 | runner 内执行 `npm run build` | exit 0，Compiled successfully |
| Python SQLite | runner 内 ruff／mypy／pytest 等 gate | pytest 239 passed / 1 skipped / 2 warnings；不是 PostgreSQL 结果 |
| runner 自检 | runner_tests 日志 | Ran 57 tests，OK (skipped=1)；含进程回收／外部服务保护用例，Windows 未运行 POSIX 专用项 |
| 双服务 HTTP smoke | `npm run smoke:commerce` 对应的 runner 冒烟入口 | exit 0；页面、HttpOnly session proxy、购物车写入、重算、订单幂等、所有权、Origin、禁用支付、取消和库存释放通过 |
| 正式 Python npm 入口补验 | 新鲜源码快照中依次 `npm run db:migrate:python`、`npm run verify:python` | 两者 exit 0；完整 format／lint／mypy／compileall／Alembic check／slop／slop 自检／pytest 均成功；pytest 239 passed / 1 skipped / 2 warnings；两个 cleanup 均关闭 |
| 实际 PostgreSQL | 未执行 | 当前探测未发现可用本地工具／服务；TS 的迁移、TLS、repository 集成测试共 16 项跳过，不能计为通过；Python 专项亦缺实际服务 |
| 浏览器操作 | 未执行 | HTTP smoke 不替代浏览器 Cookie、页面交互和回跳验收；`browser_evidence` 保持缺失 |

原 full evidence 的 missing 为 `postgres_evidence`、`browser_evidence`。当前 runner 的 full 汇总逻辑会显式添加这两项；未改 evidence 或代码消除缺口。前轮外层 shell 的 exit 通知与 runner incomplete 的返回码映射存在差异，外层原因未完全解释；本报告分别引用磁盘 evidence、逐 gate 返回码和补验终态，不声称 full exit 0。

补验前发现原 runner 快照只有 `next-env.d.ts` 字节变化：Next 构建／开发启动使 `./.next/types/` 两个声明引用变为 `./.next/dev/types/`。身份检查先失败并停止；未覆盖原快照或改 manifest 放行，而从干净 main 另建同一 manifest SHA 的 `npm-python-source` 后重跑。补验完成后 `source_identity_unchanged=true`。这是新的完整 Python 入口结果，不是把旧日志拼成同一次通过。

两条 Python 弃用警告来自依赖 TestClient／AnyIO；slop 日志中文存在终端解码乱码，按 gate exit 0 记录成功，不据乱码臆造额外输出。

### 4.3 证据索引与重跑约束

本地证据包标识为 `p01-main-baseline-20261028`，保存在仓库外 outputs；不随 PR 上传绝对路径、环境原文、数据库或未经脱敏的日志。以下名称相对该证据包，哈希用于核验本次快照，不能替代重跑：

| 证据 | SHA256 |
| --- | --- |
| `evidence.json` | `697cb90adb412082ee7de499a3f4e0602279120ce577206413c95c7d6d8b128c` |
| `npm-python-evidence.json` | `89b1786ea925820b961e301cff1dec192a708d6d117cc66ea38d40496c73f442` |
| `logs/frontend_verify.log` | `f9d9d14ce4b69968cce53ef3d72ad762149ac38aed14fc17f3e81899f7884914` |
| `logs/frontend_build.log` | `134256ab4750804d809ce655fbbbb69dad844956e85927870f575fb0f9375469` |
| `logs/commerce-smoke.log` | `f45499b530c9a0fdcb20999362e2fb51deda0d3dc356b62d8e036a8934c54ea6` |
| `logs/npm_backend_migrate.log` | `994c9abf31fbe8fe2325ed57c00151a88781a9894abedec85e6d96cae74309ef` |
| `logs/npm_verify_python.log` | `b7e4c799a5e0aee93091f645af674cab7df7713ba7c22e1419c71fcbbab8ef69` |

重跑先读 [验收入口](agents/verification.md) 和 runner `--help`，显式提供 source、全新 run-dir、Node、Python、npm-cli、锁匹配 node_modules，以及未占用回环端口。正式 Python 补验使用 runner 的 `snapshot()`、`safe_environment()` 和受管 command gate；显式指定 `PYTHON`／`COMMERCE_PYTHON`，`DATABASE_URL` 仅指向新的一次性 SQLite，`APP_ENV=test`、seed 目录、支付禁用。上述数据写入命令不能指向真实库；不能复制业务 dotenv 来补依赖或服务地址。

这些结果绑定第 2 节的 main 及相应源码快照，不等于本报告新 head 已获 CI 验证；PR CI 按其实际 head／test-merge 单独报告。

## 5. Stripe #27 逐模块采用表

“采用”表示保留设计方向，仍需接线与测试，不表示代码已经移植或已在 main 生效。下表基于第 2 节固定 M=main、D=#27 身份；D 中存在的路径不保证在 M 中存在。

| 模块／来源 | 处置 | 理由、冲突处理与后续门禁 |
| --- | --- | --- |
| M `scripts/verify_isolated.py` 及自检 | **保留 main** | 保留隔离、身份、依赖验证、受管进程与 incomplete 判据；不为支付分支或本地缺环境削弱门禁 |
| M `backend/export_contract.py`、`scripts/commerce-contract.mjs`、生成类型与样例、`package.json`、CI | **保留 main** | 保留离线导出、生成／漂移检查、runtime parser 与 CI 依赖准备；支付字段从 Python schema／合成样例生成，不能手写覆盖生成物 |
| M `src/components/shop/product-actions.tsx`、`product-buy-bar.tsx` | **保留 main** | 保留 Python variant 权威、超时／abort、同步防重入、错误后的重新核验与 handle／通道变更重挂载；D 是旧基线，不整文件覆盖；客户端防重入不等于服务端幂等 |
| M embedding／预算与展示搜索路径 | **保留 main** | 保留 #23 已整合行为；本次无 AI 改动，不因支付整合回退或扩展 R5 |
| D `domain/money.py`、Gateway Protocol／DTO 的应用层隔离方向 | **采用** | Decimal→USD cents 的精确转换、业务层不依赖 FastAPI／Stripe SDK 的方向可复用；接线前复核值域、签名和边界用例 |
| D `config.py`、两侧 env 模板、database、preflight | **修复后采用** | 协调交易 DB 专用键和 legacy `DATABASE_URL` 的限定兼容及冲突拒绝，兼顾 runner／离线导出；Next 不持 Stripe API secret；显式拓扑／TLS／mode／account；TTL 下限变化是业务行为，不当纯改名 |
| D `domain/models.py`、`domain/states.py`、responses、迁移 `1fbc05b17480` 与 env.py | **修复后采用** | Order／Payment／Reservation／operation 分轴；确认历史 revision 使用情况后定修草稿或前向修复；双引擎保留金额、唯一键、FK，验证旧库升级、中断重跑、Alembic check；草稿 PG 红灯不绕过 |
| D `application/payments.py`、事务依赖与 `refund_pending.py` | **修复后采用** | 不采用事务内 flush→外呼→最终 commit 的恢复假设；需 durable operation、lease、session generation、分段事务、unknown 与外部查询恢复；worker 强制 account／mode 边界，不能操作历史 live |
| D `application/webhooks.py` 与内部事件 schema／路由 | **修复后采用** | 可复用去重和非 paid completion 不确认方向；补 provider/account/mode 绑定、金额核验、乱序、退款异步终态和提交后 ack；保存点不等于独立持久化 |
| D `infrastructure/stripe_gateway.py` 与锁文件 | **修复后采用** | SDK 留在适配器；按实际安装版／官方资料验证参数（包括草稿的 `allowed_payment_method_types`）、超时和 retry；补读取／关闭会话、读取退款终态，避免同步 SDK 阻塞 async 路由；本阶段未验证该参数兼容性 |
| D `src/app/api/webhooks/stripe/route.ts` | **修复后采用** | 原始 body 验签方向保留；当前 `request.text()` 和转发需显式 body／时间预算；最小投影加入 mode／account，错误不泄露；Next 仅持 signing／内部 secret |
| D commerce proxy、`commerce-response.ts`、客户端、订单／回跳页面 | **修复后采用** | 在 M 生成契约与 runtime parser 上扩展；回跳只查询 Python，不凭 URL 标 paid；保留 Mock、未知结果复用原幂等键和加购 POST 不自动重试 |
| D 退款、取消、支付、webhook、迁移及配置 tests | **修复后采用** | 保留能证明的行为，增加真实提交／独立连接、崩溃窗口、失效 Session、lease、mode/account 与双引擎并发测试；假 Gateway／同 Session 可见性不等于真实 Stripe 或崩溃恢复 |
| D Shopify 组件／adapter／配置／文档移除 | **删除冗余（有条件）** | 仅删除经调用方追踪证实的 `getBuyUrl`／`buyUrl` 或退役购买链；同步兼容 URL、测试与契约，先确认历史使用与数据保留；本报告不删除文件或历史记录 |
| D 其余文档／AGENTS／CONTEXT 的支付描述 | **修复后采用** | 将 test 目标、已实现状态和 live 授权分开；本次 main 仍为支付 disabled，不把草稿设计写成既成事实；#26 留 P10 对齐稳定接口 |

## 6. 必须修复的事务与恢复边界

以下函数／测试均来自 D，不以注释代替运行事实：

1. `backend/app/dependencies.py::database()` 用 `with SessionLocal() as session, session.begin(): yield session` 持有请求外层事务。
2. `application/payments.py::_record_refund_intent()` 将 Payment 改为 `refund_pending` 后 `db.flush()`，随后添加事件／审计，没有独立 commit。`refund_order()` 在 `lock_cart()` 后调用 `_attempt_refund()`；后者调用 `gateway.refund()`。
3. `refund_pending_payments()` 候选业务过滤为 `Payment.status == "refund_pending"`，没有显式 account／mode；逐笔仍在 `with sessions() as db, db.begin()` 中先 `lock_cart()` 再外呼。候选收集事务已结束不等于逐笔外呼不持锁。
4. `application/webhooks.py::_process()` 在 `begin_nested()` 中作决定；`_confirm()` 可经 `settle_owed_refund()` 发起退款。保存点和外层事务仍可能一起回滚。
5. `test_the_debt_is_on_the_rows_before_the_gateway_is_asked` 从同一个 Session 读取，只证明当前事务内可见。`test_a_request_that_is_thrown_away_is_recovered_by_the_same_key` 强制 rollback 后 Payment 仍为 `succeeded`，靠再次 HTTP 退款调用恢复；不是后台扫描自动发现。
6. `test_a_failed_refund_attempt_is_discarded_with_the_transaction_that_owns_it` 明确断言 rollback 丢弃失败事件／次数。测试中直接抛 `SQLAlchemyError` 不等于真实 flush 失败后 Session 仍可使用；该情形需另验。

因此目标为：Tx1 保存 operation／幂等键／期待金额并提交 → 短事务 claim lease 并提交 → 不持业务行锁的 Stripe 调用 → Tx2 重读并一次性落账。外部未知结果复用同一 operation／键并查询对账；幂等保证窗口外结果不明时停止自动新建，转受控核对，不能盲目换键。

这是后续 P03/P04 的实施约束；本阶段未新增 operation 表、lease、恢复命令或支付状态，也未运行真实 Stripe test／live 请求。动态崩溃一致性尚未证明，不声称 exactly-once。

## 7. 下一阶段出口与回退

| 顺序 | 负责人／启动条件 | 可判定出口 |
| --- | --- | --- |
| 关闭 P00 账户缺口 | 用户完成现有账户必要登录；Agent 继续只读调查 | 正式域名版本、数据来源／写入方／义务范围、migration 使用历史有证据；备份恢复未过不迁写 |
| 关闭 P01 环境缺口 | Agent 使用受控临时 PostgreSQL／CI 和浏览器环境，不安装未授权服务 | 精确 SHA 的 PG 实测及浏览器闭环；保留 skip／失败明细，不用旧 CI 补本地证据 |
| P02 配置兼容 | P01 出口通过；不改真实资源 | 专用交易配置、限定 alias、secret 分权、显式拓扑／TLS／模式拒绝测试通过 |
| P03 schema／P04 恢复 | 确认 revision 使用历史；先定迁移与恢复方案 | 双引擎迁移与持久化操作／lease／故障窗口实测通过，test worker 无法触及 live |
| P05/P06 Stripe test | 前述出口通过，测试凭据经安全渠道配置 | 签名、mode/account/金额、异步终态、生成契约和浏览器测试支付同 SHA 验收；不包含正式收款 |

本报告无业务／schema／配置行为变化：若需撤回，仅撤回该文档提交或关闭 PR，不 reset 用户工作区、不删除证据。后续支付回滚必须先停新支付创建、保留 webhook／对账，只回滚到兼容现有 schema／状态的应用；不能恢复旧 DB 覆盖已发生的外部付款。

原目录受保护的 `.gitignore`、`HANDOVER.md` 和教学文档 SHA256 已核对与前轮记录一致，均未修改或暂存；用户未跟踪指南及 R3 dirty 保留。生产数据未连接、未写入；没有手动部署、合并、强推或跳过 hooks。
