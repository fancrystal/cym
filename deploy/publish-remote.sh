#!/bin/sh
set -eu
release=${1:?missing release}
case "$release" in *[!a-zA-Z0-9-]*|'') exit 1;; esac
old=$(readlink -f /srv/cym/current)
case "$old" in /srv/cym/releases/*) ;; *) echo 'Unexpected current release' >&2; exit 1;; esac
new=/srv/cym/releases/$release
archive=/srv/cym/shared/cym-$release.tgz
test -f "$archive"
test ! -e "$new"
mkdir "$new"
cp -a "$old/." "$new/"
tar -xzf "$archive" -C "$new"
ln -sfn "$new/sharp-deps/node_modules/sharp" "$new/packages/backend/node_modules/sharp"
test -e "$new/packages/backend/node_modules/sharp"
rollback() { ln -sfn "$old" /srv/cym/current; systemctl restart cym-backend || true; }
trap rollback EXIT
ln -sfn "$new" /srv/cym/current
systemctl restart cym-backend
curl -fsS --retry 5 --retry-delay 1 --retry-connrefused --max-time 10 http://127.0.0.1:3100/api/health
trap - EXIT
echo " Published $release"
