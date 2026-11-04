# Ycamera Hub · 摄影团队素材中继

多台手机往自己的服务器上交素材,**不整包全传**:手机上先看缩略图,挑要的再传。
管理员在网页里看全部、按日期/设备筛、预览、批量打包下载。

```
手机浏览器 ──> /            选文件 → 本地生成缩略图预览 → 勾选 → 上传(并发 2)
管理员浏览器 ─> /admin       网格浏览 → 筛选 → 预览/播放 → 勾选打包下载 zip
                    │
              Node + Express
                    │
        /srv/ycamera/files/<日期>/<id>.<ext>     原文件
        /srv/ycamera/thumbs/<id>.jpg             缩略图
        /srv/ycamera/db.json                     元数据
```

## 为什么这样做

- **不转码**:缩略图由手机浏览器 Canvas 生成,服务端只存字节。1 核 1.5G 也能跑,不会因为转码卡死。
- **不整包传**:手机端先本地预览,勾选才上传。一场活动几百个文件,先挑 20 个传上去就行。
- **零 App**:手机浏览器打开就用,可"添加到主屏幕"当 PWA。
- **按设备分账号**:每个摄影师填自己的设备名,文件落在 `设备名` 目录下,管理员能按设备筛。

## 快速开始(本地)

```bash
cd server
npm install
ADMIN_PASSWORD=testpass DEVICE_CODE=shoot2026 node server.js
```

- 上传页: http://localhost:8787/
- 管理页: http://localhost:8787/admin

## 部署到自己的服务器

```bash
# 本地
scp -r server root@45.202.254.212:/tmp/ycamera-hub

# 服务器
ssh root@45.202.254.212
ADMIN_PASSWORD='你的管理员口令' DEVICE_CODE='团队口令' bash /tmp/ycamera-hub/setup-server.sh
```

脚本会装 Node 20、建 `ycamera` 用户、起 systemd 服务、配数据目录 `/srv/ycamera`、开防火墙。
最后打印访问地址和口令。

HTTPS(建议,Caddy 反代 + 4GB 请求体上限):

```
:80 {
  reverse_port 127.0.0.1:8787
  request_body { max_size 4GB }
}
```

有域名时 Caddy 自动签证书;没域名就 `http://IP`,手机也能用。

## 手机端怎么用

1. 浏览器开 `http://服务器IP:8787/`
2. 填设备名(如 `iPhone-小张`)+ 团队口令
3. 点「选照片/视频」,可以一次选几十个
4. 网格里出现缩略图(图片直接缩放,视频抽首帧并显示时长)
5. 点要传的(选中打勾),点「上传」
6. 进度条逐条走,绿条满 = 成功,红条 = 失败原因

> iOS Safari 选「照片图库」时,视频会被转成 H.264 再上传;选「文件」里的原始文件则原样上传。

## 管理员怎么用

1. 开 `/admin`,输入管理员口令
2. 顶部是总数和总大小;筛选栏可按日期、设备、类型、文件名搜
3. 点缩略图 = 选中,双击/长按 = 大图预览或直接播放视频
4. 选中若干后点「打包下载」,服务端流式打 zip:
   `2026-11-04/iPhone-小张/IMG_0421.HEIC`
5. 单文件下载:预览窗口右上角

## API(想自己接脚本的话)

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/login` | `{mode:"shooter"/"admin", name, code}` → `{token}` |
| POST | `/api/upload` | multipart: `file`, `thumb`, `meta`(JSON) |
| GET | `/api/items?day=&device=&kind=&q=&page=` | 列表(摄影师只看自己) |
| GET | `/f/:id/orig` / `/f/:id/thumb` | 原文件(支持 Range)/ 缩略图 |
| GET | `/api/zip?ids=a,b,c` | 打包下载 |
| GET | `/api/stats` | 管理员:总数/总大小/按设备 |
| DELETE | `/api/items/:id` | 管理员删除 |

所有请求带 `x-token` 头(或 `?token=`)。

命令行批量传(比如从读卡器直接推):

```bash
TOKEN=$(curl -s -X POST http://IP:8787/api/login -H 'content-type: application/json' \
  -d '{"mode":"shooter","name":"读卡器-A","code":"shoot2026"}' | jq -r .token)

for f in /Volumes/CARD/DCIM/**/*.JPG; do
  curl -s -X POST http://IP:8787/api/upload -H "x-token: $TOKEN" -F "file=@$f"
done
```

## 运维

```bash
systemctl status ycamera-hub
journalctl -u ycamera-hub -f
du -sh /srv/ycamera/*
```

备份只要拷 `/srv/ycamera`(files + thumbs + db.json)。

容量估算:1000GB/月流量的机器,按 4K 视频 1 分钟 ~400MB 算,注意磁盘和流量;`/srv` 建议单独挂盘。

## 已知取舍

- 元数据用 JSON 文件,几万条以内没问题;上到十万级换 SQLite(`better-sqlite3`)或 Postgres。
- 没有断点续传;超大单文件(>2GB)建议先在电脑上压缩或切片。
- 权限模型只有两级:管理员 / 摄影师(只能看自己的)。要多项目、多团队,加一个 `project` 字段即可。
