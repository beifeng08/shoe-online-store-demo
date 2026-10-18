# Commerce MVP 契约：数据、接口与事务

> 由 `AGENTS.md` 外移而来。本文件描述**必须成立什么**，不是实现状态快照；
> 实现状态见 `docs/commerce-mvp-report.md`，已知缺口见 `open-issues.md`。
> 阅读路由见 `task-routing.md`，验收命令见 `verification.md`。

当修复当前阻塞问题后，继续以以下闭环为最小业务合同；已有功能先验证，缺失功能再小步补齐：

```text
浏览商品 -> 选择明确颜色/尺码和 variant_id -> 加入购物车
-> Python 后端重新读取价格 -> 预览总价和库存
-> 事务内检查并锁定库存 -> 创建 pending_payment 订单
-> 显示订单编号和“支付暂未开放”
```

### 数据和迁移

至少维护 `products`、`product_variants`、`product_media`、`carts`、`cart_items`、`inventory`、`inventory_reservations`、`orders`、`order_items`、`payments`、`payment_events`、`webhook_events`、`audit_logs` 的真实关系；实际代码已有其他模型时先兼容并核对迁移。

- 每个颜色/尺码组合有稳定 `variant_id`，不能用颜色数组下标识别。
- `order_items` 保存下单时商品名、SKU、尺码、颜色、货币和价格快照。
- 库存至少区分 `available` 和 `reserved`；预占、扣减、释放必须在明确事务中完成。
- Python 交易库的结构变化通过 Alembic migration；检查升级、降级或前向修复策略，不得用运行时 `create_all()` 代替正式迁移。
- TypeScript 展示/AI 数据库**不在此列**：它使用版本化 Drizzle 迁移加幂等运行时 DDL，见 `task-routing.md` 的「数据库双轨」与 ADR 0003、0007。不可据上一条移除该侧的运行时初始化。

### API 和所有权

目标接口包括：

```text
GET    /health
GET    /api/v1/catalog/products
GET    /api/v1/catalog/products/{handle}
GET    /api/v1/cart
POST   /api/v1/cart/items
PATCH  /api/v1/cart/items/{item_id}
DELETE /api/v1/cart/items/{item_id}
POST   /api/v1/checkout/preview
POST   /api/v1/checkout/create-order
GET    /api/v1/orders/{order_id}
POST   /api/v1/orders/{order_id}/cancel
POST   /api/v1/payments/session
```

允许匿名购物会话，但必须通过安全 Cookie 或明确的服务端会话 ID 管理。每次读取/修改购物车、订单、支付和库存都验证会话/用户所有权。客户端只提交 `variant_id`、数量和必要的幂等键，不提交价格、库存、订单状态或支付结果。

### 事务、幂等和异常

- 创建订单：校验输入 -> 读取权威价格和库存 -> 锁定/原子更新库存 -> 写入订单、订单项、支付占位和 audit log -> 在所有写入成功后提交；任何失败回滚全部业务写入。
- 取消订单：验证所有权和可取消状态 -> 释放尚未使用的库存预占 -> 写入状态变更和 audit log -> 提交。
- 创建订单必须要求幂等键；相同会话、相同业务键重复请求返回同一结果或明确冲突，不能产生两个订单。
- 状态迁移必须有允许的前置状态；客户端不能跳过 `pending_payment` 伪造 `paid`。
- 数据库异常和第三方异常不能原样暴露；边界层记录 request ID，返回稳定的错误 code。
