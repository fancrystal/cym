from pathlib import Path
import os
import shutil
import subprocess
import tempfile

path = Path('/etc/letsencrypt/renewal-hooks/deploy/livekit-certificates')
backup = Path('/srv/cym/shared/backups/livekit-certificates-before-cym')
line = 'lineage="${RENEWED_LINEAGE:-/etc/letsencrypt/live/voice.maishikeji.com.cn}"'
guard = '[[ "$lineage" == "/etc/letsencrypt/live/voice.maishikeji.com.cn" ]] || exit 0'
original = path.read_text(encoding='utf-8')
if original.count(line) != 1 or guard in original or backup.exists():
    raise SystemExit('现有续期钩子不符合预期，未修改')
shutil.copy2(path, backup)
updated = original.replace(line, line + '\n' + guard, 1)
fd, temp = tempfile.mkstemp(dir=str(path.parent), prefix='.livekit-guard-')
try:
    with os.fdopen(fd, 'w', encoding='utf-8', newline='\n') as output:
        output.write(updated)
    os.chmod(temp, path.stat().st_mode & 0o777)
    subprocess.run(['bash', '-n', temp], check=True)
    subprocess.run(['bash', temp], env={**os.environ, 'RENEWED_LINEAGE': '/etc/letsencrypt/live/admin.cym.green'}, check=True)
    os.replace(temp, path)
finally:
    if os.path.exists(temp): os.unlink(temp)
print('语音证书钩子已限定为原有语音域名；原文件已备份。')
