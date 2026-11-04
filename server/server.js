/**
 * Ycamera Hub —— 摄影团队素材中继
 *
 * 手机端:打开网页 -> 选择本地照片/视频 -> 浏览器生成缩略图预览 -> 勾选后上传
 * 服务端:只存原图 + 前端生成的小缩略图,不做任何转码(1C/1.5G 也能跑)
 * 管理端:/admin 登录后网格浏览、筛选、预览、批量打包下载
 *
 * 启动:
 *   npm install
 *   node server.js            # 默认 0.0.0.0:8787
 *   PORT=8080 ADMIN_PASSWORD=xxx node server.js
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const archiver = require('archiver');

const PORT = process.env.PORT || 8787;
const ROOT = process.env.DATA_DIR || path.join(__dirname, 'data');
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'admin123';
const DEVICE_CODE = process.env.DEVICE_CODE || 'shoot2026';   // 摄影师口令
const MAX_UPLOAD = (process.env.MAX_UPLOAD_MB || 4096) * 1024 * 1024;

const DIRS = {
  files: path.join(ROOT, 'files'),
  thumbs: path.join(ROOT, 'thumbs'),
  tmp: path.join(ROOT, 'tmp'),
  db: path.join(ROOT, 'db.json'),
};
for (const d of [DIRS.files, DIRS.thumbs, DIRS.tmp]) fs.mkdirSync(d, { recursive: true });

// ---------------- 极简持久化 ----------------
let db = { items: [], sessions: {}, devices: {}, tasks: [] };
if (fs.existsSync(DIRS.db)) {
  try { db = JSON.parse(fs.readFileSync(DIRS.db, 'utf8')); } catch (e) { console.error('db 读取失败', e.message); }
}
db.devices = db.devices || {};
db.tasks = db.tasks || [];
let saveTimer = null;
function save() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    const tmp = DIRS.db + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(db));
    fs.renameSync(tmp, DIRS.db);
  }, 300);
}

// ---------------- 鉴权 ----------------
function newToken() { return crypto.randomBytes(24).toString('hex'); }
function auth(role) {
  return (req, res, next) => {
    const t = (req.headers['x-token'] || req.query.token || '').toString();
    const s = db.sessions[t];
    if (!s) return res.status(401).json({ error: '未登录' });
    if (role && s.role !== role) return res.status(403).json({ error: '无权限' });
    req.session = s;
    next();
  };
}

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public'), { extensions: ['html'] }));

// ---------------- 登录 ----------------
app.post('/api/login', (req, res) => {
  const { mode, name, code } = req.body || {};
  if (mode === 'admin') {
    if ((code || '') !== ADMIN_PASSWORD) return res.status(403).json({ error: '管理员口令错误' });
    const token = newToken();
    db.sessions[token] = { role: 'admin', name: 'admin', ts: Date.now() };
    save();
    return res.json({ token, role: 'admin', name: 'admin' });
  }
  // 摄影师:设备名 + 团队口令
  const who = (name || '').trim();
  if (!who) return res.status(400).json({ error: '请填写设备名' });
  if ((code || '') !== DEVICE_CODE) return res.status(403).json({ error: '团队口令错误' });
  const token = newToken();
  db.sessions[token] = { role: 'shooter', name: who, ts: Date.now() };
  save();
  res.json({ token, role: 'shooter', name: who });
});

// ---------------- 磁盘保护 ----------------
const MIN_FREE_BYTES = (process.env.MIN_FREE_MB ? parseInt(process.env.MIN_FREE_MB, 10) : 800) * 1024 * 1024;

function diskInfo() {
  try {
    const s = fs.statfsSync(DIRS.files);
    return { free: s.bavail * s.bsize, total: s.blocks * s.bsize };
  } catch (e) {
    return { free: null, total: null };
  }
}

app.get('/api/health', (req, res) => {
  const d = diskInfo();
  res.json({
    ok: true,
    items: db.items.length,
    freeBytes: d.free,
    totalBytes: d.total,
    minFreeBytes: MIN_FREE_BYTES,
  });
});

// ---------------- 上传 ----------------
const upload = multer({
  dest: DIRS.tmp,
  limits: { fileSize: MAX_UPLOAD, files: 2 },
});

function extOf(name, mime) {
  const e = path.extname(name || '').toLowerCase();
  if (e && e.length <= 6) return e;
  if ((mime || '').startsWith('video/')) return '.mp4';
  if ((mime || '').startsWith('image/')) return '.jpg';
  return '.bin';
}

app.post('/api/upload', auth('shooter'), upload.fields([{ name: 'file', maxCount: 1 }, { name: 'thumb', maxCount: 1 }]), (req, res) => {
  const f = req.files && req.files.file && req.files.file[0];
  const thumb0 = req.files && req.files.thumb && req.files.thumb[0];
  if (!f && !thumb0) return res.status(400).json({ error: '缺少文件' });

  let meta0 = {};
  try { meta0 = JSON.parse(req.body.meta || '{}'); } catch (e) {}

  // —— 只传缩略图(手机相册同步模式):不占原图空间,电脑端能看能筛 ——
  if (!f && thumb0) {
    const d0 = diskInfo();
    if (d0.free !== null && d0.free - thumb0.size < MIN_FREE_BYTES) {
      fs.unlink(thumb0.path, () => {});
      return res.status(507).json({ error: `服务器空间不足(剩余 ${(d0.free / 1073741824).toFixed(1)} GB)` });
    }
    // 同一设备同一路径只记一次
    if (meta0.devicePath) {
      const exist = db.items.find((i) => i.device === req.session.name && i.devicePath === meta0.devicePath);
      if (exist) {
        fs.unlink(thumb0.path, () => {});
        return res.json({ ok: true, dup: true, item: exist });
      }
    }
    const rid = 'r' + Date.now().toString(36) + crypto.randomBytes(3).toString('hex');
    const thumbName = rid + '.jpg';
    fs.renameSync(thumb0.path, path.join(DIRS.thumbs, thumbName));
    const it = {
      id: rid, sha: null, name: meta0.name || (rid + '.jpg'), ext: meta0.ext || '.jpg',
      size: meta0.size || 0, mime: meta0.mime || '', kind: meta0.kind || 'image',
      duration: meta0.duration || 0, width: meta0.width || 0, height: meta0.height || 0,
      device: req.session.name, takenAt: meta0.takenAt || null,
      uploadedAt: new Date().toISOString(), day: (meta0.takenAt || new Date().toISOString()).slice(0, 10),
      thumb: thumbName, path: null, thumbOnly: true, devicePath: meta0.devicePath || '',
      temp: !!meta0.temp, source: meta0.source || 'sync',
    };
    db.items.push(it);
    save();
    return res.json({ ok: true, item: it });
  }

  const thumb = thumb0;

  const d = diskInfo();
  if (d.free !== null && d.free - f.size < MIN_FREE_BYTES) {
    fs.unlink(f.path, () => {});
    if (thumb) fs.unlink(thumb.path, () => {});
    return res.status(507).json({
      error: `服务器空间不足(剩余 ${(d.free / 1073741824).toFixed(1)} GB),请联系管理员清理或扩容`,
    });
  }

  let meta = {};
  try { meta = JSON.parse(req.body.meta || '{}'); } catch (e) {}

  // 按内容哈希去重
  const h = crypto.createHash('sha256');
  const rs = fs.createReadStream(f.path);
  rs.on('data', (c) => h.update(c));
  rs.on('end', () => {
    const sha = h.digest('hex');
    const dup = db.items.find((it) => it.sha === sha);
    if (dup) {
      fs.unlink(f.path, () => {});
      if (thumb) fs.unlink(thumb.path, () => {});
      return res.json({ ok: true, dup: true, item: dup });
    }

    const id = Date.now().toString(36) + crypto.randomBytes(3).toString('hex');
    const day = new Date().toISOString().slice(0, 10);
    const dir = path.join(DIRS.files, day);
    fs.mkdirSync(dir, { recursive: true });
    const ext = extOf(f.originalname, f.mimetype);
    const origPath = path.join(dir, id + ext);
    fs.renameSync(f.path, origPath);

    let thumbName = null;
    if (thumb) {
      thumbName = id + '.jpg';
      fs.renameSync(thumb.path, path.join(DIRS.thumbs, thumbName));
    }

    const item = {
      id,
      sha,
      name: f.originalname || (id + ext),
      ext,
      size: f.size,
      mime: f.mimetype || '',
      kind: (f.mimetype || '').startsWith('video/') ? 'video' : 'image',
      duration: meta.duration || 0,
      width: meta.width || 0,
      height: meta.height || 0,
      device: req.session.name,
      takenAt: meta.takenAt || null,
      uploadedAt: new Date().toISOString(),
      day,
      thumb: thumbName,
      path: path.relative(DIRS.files, origPath),
    };
    db.items.push(item);
    save();
    res.json({ ok: true, item });
  });
  rs.on('error', (e) => {
    fs.unlink(f.path, () => {});
    res.status(500).json({ error: '读取失败: ' + e.message });
  });
});

// ---------------- 列表 ----------------
app.get('/api/items', auth(), (req, res) => {
  const { day, device, kind, q, page = 1, size = 60, temp } = req.query;
  let list = db.items.slice();
  if (req.session.role !== 'admin') list = list.filter((i) => i.device === req.session.name);
  if (day) list = list.filter((i) => i.day === day);
  if (device) list = list.filter((i) => i.device === device);
  if (kind) list = list.filter((i) => i.kind === kind);
  if (temp === '1') list = list.filter((i) => i.temp);
  if (temp === '0') list = list.filter((i) => !i.temp);
  if (q) {
    const s = String(q).toLowerCase();
    list = list.filter((i) => i.name.toLowerCase().includes(s));
  }
  list.sort((a, b) => (a.uploadedAt < b.uploadedAt ? 1 : -1));
  const total = list.length;
  const p = Math.max(1, parseInt(page, 10) || 1);
  const sz = Math.min(200, Math.max(1, parseInt(size, 10) || 60));
  list = list.slice((p - 1) * sz, p * sz);

  const devices = [...new Set(db.items.map((i) => i.device))];
  const days = [...new Set(db.items.map((i) => i.day))].sort().reverse();
  res.json({ total, page: p, size: sz, items: list, devices, days });
});

app.get('/api/stats', auth('admin'), (req, res) => {
  const total = db.items.length;
  const bytes = db.items.reduce((s, i) => s + (i.size || 0), 0);
  const byDevice = {};
  for (const i of db.items) {
    byDevice[i.device] = byDevice[i.device] || { count: 0, bytes: 0 };
    byDevice[i.device].count++;
    byDevice[i.device].bytes += i.size || 0;
  }
  res.json({ total, bytes, byDevice });
});

// ---------------- 文件 ----------------
function findItem(id) { return db.items.find((i) => i.id === id); }

app.get('/f/:id/orig', auth(), (req, res) => {
  const it = findItem(req.params.id);
  if (!it) return res.status(404).end();
  if (!it.path) {   // 相册同步模式:只有缩略图
    if (!it.thumb) return res.status(404).end();
    return res.sendFile(path.join(DIRS.thumbs, it.thumb));
  }
  const abs = path.join(DIRS.files, it.path);
  res.setHeader('Content-Type', it.mime || 'application/octet-stream');
  res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(it.name)}`);
  res.sendFile(abs, { acceptRanges: true });
});

app.get('/f/:id/thumb', auth(), (req, res) => {
  const it = findItem(req.params.id);
  if (!it || !it.thumb) return res.status(404).end();
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  res.sendFile(path.join(DIRS.thumbs, it.thumb));
});

// ---------------- 打包下载 ----------------
app.get('/api/zip', auth(), (req, res) => {
  const ids = String(req.query.ids || '').split(',').filter(Boolean);
  const items = ids.map(findItem).filter(Boolean);
  if (!items.length) return res.status(400).json({ error: '没有可下载的文件' });
  if (req.session.role !== 'admin' && items.some((i) => i.device !== req.session.name)) {
    return res.status(403).json({ error: '无权限' });
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="ycamera-${stamp}.zip"`);

  const zip = archiver('zip', { zlib: { level: 0 } }); // 媒体文件压不动,直接 store
  zip.on('error', (e) => { console.error('zip', e); try { res.end(); } catch (_) {} });
  zip.pipe(res);
  const used = new Set();
  for (const it of items) {
    let name = `${it.day}/${it.device}/${it.name}`;
    let n = 1;
    while (used.has(name)) name = `${it.day}/${it.device}/${path.parse(it.name).name}_${n++}${it.ext}`;
    used.add(name);
    zip.file(path.join(DIRS.files, it.path), { name });
  }
  zip.finalize();
});

// ---------------- 管理 ----------------
app.delete('/api/items/:id', auth('admin'), (req, res) => {
  const i = db.items.findIndex((x) => x.id === req.params.id);
  if (i < 0) return res.status(404).json({ error: '不存在' });
  const it = db.items.splice(i, 1)[0];
  try { fs.unlinkSync(path.join(DIRS.files, it.path)); } catch (e) {}
  if (it.thumb) { try { fs.unlinkSync(path.join(DIRS.thumbs, it.thumb)); } catch (e) {} }
  save();
  res.json({ ok: true });
});

app.get('/api/whoami', auth(), (req, res) => res.json(req.session));

// ============================================================
//  设备监控 + 按需拉取(手机端 Agent 轮询)
// ============================================================
const ONLINE_MS = 90 * 1000;

function deviceView(name) {
  const d = db.devices[name];
  if (!d) return null;
  const online = Date.now() - (d.lastSeen || 0) < ONLINE_MS;
  return { ...d, name, online };
}

// 手机心跳:上报电量/定位/相册数量,顺带取任务
app.post('/api/device/heartbeat', auth('shooter'), (req, res) => {
  const b = req.body || {};
  const name = req.session.name;
  const prev = db.devices[name] || {};
  db.devices[name] = {
    ...prev,
    battery: b.battery != null ? b.battery : prev.battery,
    charging: b.charging != null ? b.charging : prev.charging,
    lat: b.lat != null ? b.lat : prev.lat,
    lng: b.lng != null ? b.lng : prev.lng,
    accuracy: b.accuracy != null ? b.accuracy : prev.accuracy,
    photoCount: b.photoCount != null ? b.photoCount : prev.photoCount,
    videoCount: b.videoCount != null ? b.videoCount : prev.videoCount,
    freeBytes: b.freeBytes != null ? b.freeBytes : prev.freeBytes,
    model: b.model || prev.model,
    android: b.android || prev.android,
    appVersion: b.appVersion || prev.appVersion,
    lastSeen: Date.now(),
    ip: req.headers['x-forwarded-for'] || req.socket.remoteAddress,
  };
  save();
  // 取走即标记 running,避免手机在长任务期间重复领取同一个任务
  const now = Date.now();
  for (const t of db.tasks) {
    if (t.status === 'running' && now - (t.takenAt || 0) > 5 * 60 * 1000) t.status = 'pending'; // 超时回收
  }
  const tasks = db.tasks.filter((t) => t.device === name && t.status === 'pending');
  for (const t of tasks) { t.status = 'running'; t.takenAt = now; }
  if (tasks.length) save();
  res.json({ ok: true, tasks, serverTime: Date.now() });
});

// 手机执行完任务回报
app.post('/api/device/task/:id', auth('shooter'), (req, res) => {
  const t = db.tasks.find((x) => x.id === req.params.id);
  if (!t) return res.status(404).json({ error: '任务不存在' });
  if (t.device !== req.session.name) return res.status(403).json({ error: '不是你的任务' });
  const b = req.body || {};
  t.status = b.ok ? 'done' : 'failed';
  t.finishedAt = Date.now();
  t.result = b.message || '';
  t.uploaded = b.uploaded || 0;
  save();
  res.json({ ok: true });
});

// 管理端:设备列表
app.get('/api/devices', auth('admin'), (req, res) => {
  const list = Object.keys(db.devices).map(deviceView).filter(Boolean);
  list.sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0));
  const now = Date.now();
  const pending = db.tasks.filter((t) => t.status === 'pending' && now - t.createdAt < 10 * 60 * 1000);
  res.json({ devices: list, pendingTasks: pending });
});

// 管理端:给某台设备下任务
app.post('/api/devices/:name/tasks', auth('admin'), (req, res) => {
  const { name } = req.params;
  const { type, params } = req.body || {};
  if (!type) return res.status(400).json({ error: '缺少任务类型' });
  const t = {
    id: 't' + Date.now().toString(36) + crypto.randomBytes(2).toString('hex'),
    device: name, type, params: params || {},
    status: 'pending', createdAt: Date.now(),
  };
  db.tasks.push(t);
  // 只保留最近 200 条任务记录
  if (db.tasks.length > 200) db.tasks = db.tasks.slice(-200);
  save();
  res.json({ ok: true, task: t });
});

// 管理端:某台设备的任务记录
app.get('/api/devices/:name/tasks', auth('admin'), (req, res) => {
  const list = db.tasks.filter((t) => t.device === req.params.name).slice(-30).reverse();
  res.json({ tasks: list });
});

// 管理端:清空临时预览(thumb-only 且标记 temp)
app.delete('/api/temp', auth('admin'), (req, res) => {
  const keep = [];
  let removed = 0;
  for (const it of db.items) {
    if (it.temp) {
      if (it.thumb) { try { fs.unlinkSync(path.join(DIRS.thumbs, it.thumb)); } catch (e) {} }
      if (it.path) { try { fs.unlinkSync(path.join(DIRS.files, it.path)); } catch (e) {} }
      removed++;
    } else keep.push(it);
  }
  db.items = keep;
  save();
  res.json({ ok: true, removed });
});

// ============================================================
//  相册在线预览:图片只在内存里中转,不落盘、不进素材库
// ============================================================
const memUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024, files: 1 } });
const relayMap = new Map();   // rid -> { buf, ts }
const albumMap = new Map();   // device -> { items, ts }

function gcRelay() {
  const now = Date.now();
  for (const [k, v] of relayMap) if (now - v.ts > 120000) relayMap.delete(k);
  for (const [k, v] of albumMap) if (now - v.ts > 30 * 60 * 1000) albumMap.delete(k);
}
setInterval(gcRelay, 30000).unref();

// 手机上传一张预览图到内存
app.post('/api/relay/:rid', auth('shooter'), memUpload.single('img'), (req, res) => {
  if (!req.file || !req.file.buffer) return res.status(400).json({ error: '没有图片' });
  relayMap.set(req.params.rid, { buf: req.file.buffer, ts: Date.now() });
  res.json({ ok: true, size: req.file.buffer.length });
});

// 查询某前缀下已就绪的内存缩略图 key
app.get('/api/relay/ready', auth(), (req, res) => {
  const prefix = String(req.query.prefix || '');
  const ids = [];
  for (const k of relayMap.keys()) {
    if (k.startsWith(prefix)) ids.push(k.slice(prefix.length));
  }
  res.json({ ids, count: ids.length });
});
// 浏览器取走(用完 2 分钟后自动过期)
app.get('/api/relay/:rid', auth(), (req, res) => {
  const e = relayMap.get(req.params.rid);
  if (!e) return res.status(404).json({ error: 'not ready' });
  res.setHeader('Content-Type', 'image/jpeg');
  res.setHeader('Cache-Control', 'no-store');
  res.send(e.buf);
});


// 手机上报相册文件列表(只有元数据)
app.post('/api/album/:device', auth('shooter'), express.json({ limit: '4mb' }), (req, res) => {
  const items = (req.body && req.body.items) || [];
  albumMap.set(req.params.device, { items, ts: Date.now() });
  res.json({ ok: true, count: items.length });
});

// 管理员取相册列表
app.get('/api/album/:device', auth('admin'), (req, res) => {
  const e = albumMap.get(req.params.device);
  res.json(e ? { items: e.items, ts: e.ts } : { items: [], ts: 0 });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Ycamera Hub 运行在 http://0.0.0.0:${PORT}`);
  console.log(`  数据目录: ${ROOT}`);
  console.log(`  管理员口令: ${ADMIN_PASSWORD === 'admin123' ? 'admin123 (默认,请改 ADMIN_PASSWORD)' : '(已自定义)'}`);
});
