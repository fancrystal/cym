# 本地商圈（CYM）

移动 H5、商圈管理后台和独立 API。商圈用户通过邀请码或二维码注册，使用产品券购买商品、查看团队和订单；后台管理用户、商品、产品券充值、订单及到货通知。项目不含原 mskj 的代理、VIP、通证、权益值、贡献值、聊天室和语音模块。

> 当前为本地预览版本。购买和转赠的基本流程已做 MySQL 联调；更多并发、异常恢复、权限及手机页面测试尚需完成，暂不应投入生产或连接真实用户资产。

## 本地环境

- Node.js 20 或以上、Corepack / pnpm 10.15.0、MySQL 8。
- 单独创建 `cym` 数据库及数据库账号，不使用原项目的数据库。
- 安装依赖：`corepack pnpm install`。
- 将 `packages/backend/.env.example` 复制为 `packages/backend/.env`，填写数据库配置、随机且至少 32 位的 `JWT_SECRET`。配置文件不应提交。
- 在 `packages/backend` 目录执行 `corepack pnpm init-db` 创建表。
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

## 部署规划

H5 使用 `cym.green`，后台使用 `admin.cym.green`，分别由独立 Nginx 站点提供静态文件并同源代理 `/api`。使用独立进程、数据库、账号、环境变量及上传目录；上服务器前先检查 mskj 的端口、DNS 和证书，备份现有配置。详细范围见 [设计方案](docs/superpowers/specs/2026-11-07-local-commerce-design.md)。本仓库尚未提供可直接用于生产的部署配置。
