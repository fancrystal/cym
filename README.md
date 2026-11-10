# 本地商圈（CYM）

移动 H5、商圈管理后台和独立 API。商圈用户通过邀请码或二维码注册，使用产品券购买商品、查看团队和订单；后台管理用户、商品、产品券充值、订单及到货通知。项目不含原 mskj 的代理、VIP、通证、权益值、贡献值、聊天室和语音模块。

> 订单购买后沿用原商圈的结算状态。后台发送到货通知后，用户可在订单页确认收货；确认时间单独保存，不影响产品券结算和复购收益。手机页面仍需在真实设备上完整验收。

## 本地环境

- Node.js 20 或以上、Corepack / pnpm 10.15.0、MySQL 8。
- 单独创建 `cym` 数据库及数据库账号，不使用原项目的数据库。
- 安装依赖：`corepack pnpm install`。
- 将 `packages/backend/.env.example` 复制为 `packages/backend/.env`，填写数据库配置、随机且至少 32 位的 `JWT_SECRET`。配置文件不应提交。
- 在 `packages/backend` 目录执行 `corepack pnpm init-db` 创建表。
- 已有数据库升级前先备份，再执行相同的 `corepack pnpm init-db`；初始化脚本会为旧订单表补充收货确认时间字段，不删除既有数据。
- 在该目录设置 `ROOT_PASSWORD` 和 `ADMIN_PASSWORD` 环境变量，执行 `corepack pnpm seed` 初始化商圈根账户和管理员；管理员名称可由 `ADMIN_USERNAME` 指定，默认为 `admin`。重复运行不会重置现有密码。
- 首批普通用户由运营方入库：`phone`、`username`、`password_hash`（bcrypt）、唯一 `invite_code` 必填；`is_root=0`，初始 `balance=0`、`purchase_count=0`。后续用户可使用邀请码注册。系统根账户不能邀请或购买。

## 启动

在项目根目录分别运行：

```sh
corepack pnpm --filter @cym/backend dev
corepack pnpm --filter @cym/h5 dev
corepack pnpm --filter @cym/admin dev
```

默认 API 为 `http://127.0.0.1:3100`，H5 为 `http://127.0.0.1:3011`，后台为 `http://127.0.0.1:3012`。Vite 将 `/api` 转发给 API。

## 验证

```sh
corepack pnpm test
corepack pnpm --filter @cym/h5 build
corepack pnpm --filter @cym/admin build
```

真实 MySQL 联调测试仅对已初始化的本地测试数据库运行：在 `packages/backend` 目录设置 `CYM_INTEGRATION=1` 后运行 `node --test test/integration.test.js`。测试创建并清理临时用户、商品和交易；不要对生产数据库运行。

本地预览可在 `packages/backend` 设置 `CYM_ALLOW_TEST_BOTS=1` 后运行 `node src/seed-test-bots.js`，创建十个四层二叉金字塔测试账户，每个账户带 500 测试产品券。手机号和随机密码只记录在该目录的 `.env`；已有记录时脚本不会重复创建。脚本仅允许连接本机且不能在生产环境运行。

## 部署规划

H5 使用 `cym.green`，后台使用 `admin.cym.green`，分别由独立 Nginx 站点提供静态文件并同源代理 `/api`。API 使用 `deploy/cym-backend.service`；Nginx 参考 `deploy/cym-web.nginx.conf` 和 `deploy/cym-admin.nginx.conf`，证书申请前使用对应的 ACME 临时配置。服务器目录为 `/srv/cym`，独立数据库为 `cym_db`，仅监听本机 3100 端口，敏感环境变量保存在 `/srv/cym/shared/backend.env`。执行前检查域名、端口、已有站点及数据库名称并备份 Nginx 配置；不要导入本地机器人数据。详细范围见 [设计方案](docs/superpowers/specs/2026-11-07-local-commerce-design.md)。

后台用户和订单支持关键词查询，最多显示匹配结果中最近 500 条；用户流水最多显示最近 500 条。运营概览按完整订单数据统计近 30 天成交和商品排行。
