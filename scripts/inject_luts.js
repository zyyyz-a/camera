// 把 luts\ 下的 .cube 转成 App 内置 LUT 格式(.obj = Java 序列化的 Lut 对象)
// 做法:直接复用官方 .obj 的头部字节(类描述符 + 字段 + description/fileName 字符串 + 数组头),
// 只替换后面 143748 字节的 LUT 数据。显示名由 assets 文件名决定,与头部字符串无关。
const fs = require('fs');
const path = require('path');

const TEMPLATE = 'D:\\pojia\\mediastorm_re\\apktool_out\\assets\\bmc_luts\\Rec.709\\Cinema Teal.obj';
const SRC = 'D:\\pojia\\mediastorm_re\\luts';
const DST = process.argv[2] || 'D:\\pojia\\mediastorm_re\\apktool_out\\assets\\bmc_luts\\Rec.709';
const S = 33, VOX = S ** 3, ARR = VOX * 4;

const tpl = fs.readFileSync(TEMPLATE);
// 数据区起点 = 75 72 00 02 '[B' + suid(8) + flags(1) + fields(2) + 78 70 + len(4)
const marker = Buffer.from([0x75, 0x72, 0x00, 0x02, 0x5b, 0x42]);
const mi = tpl.indexOf(marker);
const dataOff = mi + 19 + 4;
const header = tpl.slice(0, dataOff);
const origLen = tpl.readInt32BE(dataOff - 4);

console.log(`模板: ${path.basename(TEMPLATE)}`);
console.log(`  数据区起点=${dataOff}  声明长度=${origLen}  实际剩余=${tpl.length - dataOff}`);
if (origLen !== ARR || tpl.length - dataOff !== ARR) {
  throw new Error('模板长度与预期不符,换一个模板');
}

function cubeToBytes(file) {
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  const vals = [];
  for (const L of lines) {
    if (!L || L.startsWith('#')) continue;
    if (L.startsWith('TITLE') || L.startsWith('LUT_3D_SIZE') || L.startsWith('DOMAIN')) continue;
    const p = L.trim().split(/\s+/).map(Number);
    if (p.length === 3 && p.every((v) => !isNaN(v))) vals.push(p);
  }
  if (vals.length !== VOX) throw new Error(`${path.basename(file)} 体素数 ${vals.length} != ${VOX}`);
  const out = Buffer.alloc(ARR);
  for (let i = 0; i < VOX; i++) {
    out[i * 4] = Math.min(255, Math.round(vals[i][0] * 255));
    out[i * 4 + 1] = Math.min(255, Math.round(vals[i][1] * 255));
    out[i * 4 + 2] = Math.min(255, Math.round(vals[i][2] * 255));
    out[i * 4 + 3] = 255;
  }
  return out;
}

let n = 0;
for (const group of ['leica', 'fuji']) {
  const dir = path.join(SRC, group);
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.cube'))) {
    const name = f.replace(/\.cube$/, '');
    const data = cubeToBytes(path.join(dir, f));
    const out = Buffer.concat([header, data]);
    const dst = path.join(DST, name + '.obj');
    fs.writeFileSync(dst, out);
    console.log(`  ${(out.length / 1024).toFixed(0).padStart(4)} KB  ${group}/${name}.obj`);
    n++;
  }
}
console.log(`\n写入 ${n} 个内置 LUT -> ${DST}`);
