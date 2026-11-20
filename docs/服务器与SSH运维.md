# CYM 服务器与 SSH 运维

供后续维护本项目的 agent 和开发人员使用。服务器同时运行 mskj，操作前确认目标站点、服务和路径，避免影响其他项目。

## 连接

- 服务器：`47.93.185.61`；CYM H5：`https://cym.green`；后台：`https://admin.cym.green`。
- 本机已有 SSH 配置和密钥，可在 PowerShell 执行 `ssh -o BatchMode=yes -o ConnectTimeout=8 root@47.93.185.61`。若连接失败，先检查本机 `~/.ssh/config`、密钥和网络；不要把私钥、密码或配置中的敏感内容输出到日志或提交仓库。
- 上传示例：`scp -o BatchMode=yes 本地文件 root@47.93.185.61:/srv/cym/shared/`。大文件及临时文件应使用明确名称，确认无冲突后上传。
- 此文件记录的是本机既有连接方式，不表示其他机器自动具备权限。执行线上变更前遵循用户的授权范围。

## 服务与目录

截至 2026-11-16 只读检查：`cym-backend` 和 `nginx` 均为 active；`/srv/cym/current` 指向 `/srv/cym/releases/20261115-share-banner`。实际操作前重新检查，勿依赖该版本名。

- `/srv/cym/current`：当前发布目录的符号链接；历史版本位于 `/srv/cym/releases/`。
- `/srv/cym/current/packages/h5/dist` 和 `/srv/cym/current/packages/admin/dist`：H5 和后台静态文件，由对应 Nginx 站点提供。
- `cym-backend`：systemd 服务，以 `cym` 用户运行，API 监听本机 `127.0.0.1:3100`；Nginx 将两个域名的 `/api/` 转发至该服务。参考仓库 `deploy/cym-backend.service`、`deploy/cym-web.nginx.conf` 和 `deploy/cym-admin.nginx.conf`，以服务器当前配置为准。
- `/srv/cym/shared/backend.env`：服务环境配置，含敏感信息，不要打印或提交；数据库独立于 mskj。`WITHDRAWAL_ENCRYPTION_KEY` 用于解密已有支付宝账号，不能随意更换。
- `/srv/cym/uploads`：持久上传文件，含私有提现截图；`/srv/cym/downloads`：安卓安装包；`/srv/cym/shared/backups`：已有备份。发布时保留这些目录，数据库、上传目录和加密密钥须分别安全备份。
- Android 发布签名文件和配置仅在本机 `packages/android/keystore/`、`packages/android/signing.properties`，均不应上传服务器或提交 Git；覆盖安装需要保留原签名。

## 只读检查

连接后可运行：

```sh
readlink -f /srv/cym/current
systemctl status cym-backend --no-pager
systemctl status nginx --no-pager
journalctl -u cym-backend -n 100 --no-pager
curl -fsS http://127.0.0.1:3100/api/health
nginx -t
```

Nginx 日志通常位于 `/var/log/nginx/access.log` 和 `/var/log/nginx/error.log`；日志可能含用户 IP、访问路径等信息，查询时限制范围并避免公开用户数据。外部访问时检查两个域名和 `https://cym.green/api/health`，并检查 mskj 原站状态。

## 发布与回滚要点

1. 本地先测试并构建：`corepack pnpm test`、`corepack pnpm --filter @cym/h5 build`、`corepack pnpm --filter @cym/admin build`。涉及数据库的测试只能运行在本地测试库。
2. 发布前记录当前 `readlink -f /srv/cym/current`，核对服务器当前状态并按变更范围备份；不得覆盖 mskj 配置、数据库或现有上传目录。
3. 既有做法是创建一个唯一的 `/srv/cym/releases/<版本>`，复制当前版本后覆盖经过验证的构建文件，检查依赖及符号链接，再切换 `/srv/cym/current`。保留旧静态资源以兼容已打开的页面；不要覆盖已有版本目录。
4. 仅更新静态文件通常无需重启后端；更新后端代码或环境配置需根据实际情况重启 `cym-backend` 并检查日志及健康接口。Nginx 配置改动须先备份，执行 `nginx -t` 成功后才重载。
5. 检查 H5、后台、API 和原站；失败时将 `/srv/cym/current` 指回发布前记录的版本，必要时恢复配置并重启受影响服务。数据库迁移不能仅靠切换符号链接回滚，须在变更前另行制定备份与恢复方案。
