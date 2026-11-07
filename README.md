# 本地商圈（CYM）

本项目计划提供移动 H5、运营后台和商圈 API，使用独立数据库。业务范围和部署边界见 [设计方案](docs/superpowers/specs/2026-11-07-local-commerce-design.md)，实施顺序见 [开发计划](docs/superpowers/plans/2026-11-07-local-commerce.md)。

**开发状态：项目尚未完成，目前仅有商圈收益归属规则及测试，不能用于运营或部署。**

## 当前可运行的测试

需要 Node.js 20 或更高版本及 Corepack：

```sh
corepack pnpm test
```

## 计划部署

H5 使用 `cym.green`，后台使用 `admin.cym.green`。部署时应单独配置数据库、API 服务、环境变量和 Nginx 站点，并先核对与现有 mskj 系统的端口及服务配置。项目不保存真实密码、密钥或历史业务数据。
