# 本地商圈（CYM）

移动 H5、商圈管理后台和独立 API。商圈用户通过邀请码或二维码注册，使用产品券购买商品、查看团队和订单；后台管理用户、商品、产品券充值、订单及到货通知。项目不含原 mskj 的代理、VIP、通证、权益值、贡献值、聊天室和语音模块。

> 订单购买后沿用原商圈的结算状态。后台发送到货通知后，用户可在订单页确认收货；确认时间单独保存，不影响产品券结算和复购收益。手机页面仍需在真实设备上完整验收。

## 本地环境

- Node.js 20 或以上、Corepack / pnpm 10.15.0、MySQL 8。
- 单独创建 `cym` 数据库及数据库账号，不使用原项目的数据库。
- 安装依赖：`corepack pnpm install`。
- 将 `packages/backend/.env.example` 复制为 `packages/backend/.env`，填写数据库配置、随机且至少 32 位的 `JWT_SECRET`。配置文件不应提交。
- 设置 `WITHDRAWAL_ENCRYPTION_KEY` 为随机的 64 位十六进制密钥（可用 `node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))"` 生成），用于加密支付宝账号；密钥必须与数据库、上传目录分别安全备份，不能随意更换，否则已有收款账号无法解密。
- 在 `packages/backend` 目录执行 `corepack pnpm init-db` 创建表。
- 商品图片由后台选择本地文件上传，支持 JPG、PNG、GIF、WebP，每张不超过 5MB；详情图最多 9 张。后台可逐条添加款式，不需要填写代码。
- 图片默认保存在后端工作目录的 `uploads` 文件夹，可通过 `UPLOAD_DIR` 指定持久目录。生产环境使用 `/srv/cym/uploads`，该目录必须由服务用户 `cym` 可写，并与数据库一起备份，发布新版本不得清空。启用服务配置前须先创建该目录并设置权限。
- 替换图片或取消编辑不会自动删除已上传文件，以避免误删仍被使用的图片；运营时需监控该目录的磁盘占用，并在备份后谨慎清理未引用文件。
- 已有数据库升级前先备份，再执行相同的 `corepack pnpm init-db`；初始化脚本会为旧订单表补充收货确认时间字段，不删除既有数据。
- 在该目录设置 `ROOT_PASSWORD` 和 `ADMIN_PASSWORD` 环境变量，执行 `corepack pnpm seed` 初始化商圈根账户和管理员；管理员名称可由 `ADMIN_USERNAME` 指定，默认为 `admin`。重复运行不会重置现有密码。
- 后台“用户管理 → 添加用户”可填写手机号、用户名、密码、可选上级手机号和初始产品券；不填上级时创建独立普通用户，充值与账户一起记账。后续用户也可使用邀请码注册。系统根账户不能邀请或购买，也不能被设置为普通用户的上级。

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

## 提现操作

团队页显示累计商圈收益；提现从产品券余额扣除，最低 50 且为 50 的整数倍，手续费 6%，按 1 产品券兑 1 元计算线下到账金额。新用户注册填写支付宝账号，已有用户可在首次提现时填写；支付宝账号加密存储。申请时扣除产品券，待审核申请可以驳回并退券；审核通过后不能直接退券，管理员应核对收款信息并线下转账，上传截图和填写转账记录后标记完成。用户可在提现记录中查看截图缩略图并点击查看原图。截图保存在上传目录的私有子目录，访问时验证账户权限；备份时需保留该目录及加密密钥。
