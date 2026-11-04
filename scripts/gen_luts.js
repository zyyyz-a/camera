// 生成 Leica / Fujifilm 风格 .cube LUT(33³),供 Blackmagic Camera(飓风相机)导入
const fs = require('fs');
const path = require('path');

const OUT = process.argv[2] || 'D:\\pojia\\mediastorm_re\\luts';
const SIZE = 33;

// ---------- 色彩数学 ----------
const clamp = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

function mat3(m, [r, g, b]) {
  return [
    m[0] * r + m[1] * g + m[2] * b,
    m[3] * r + m[4] * g + m[5] * b,
    m[6] * r + m[7] * g + m[8] * b,
  ];
}

// ASC-CDL 式:out = (in * slope + offset) ^ power
function cdl([r, g, b], s, o, p) {
  return [
    Math.pow(clamp(r * s[0] + o[0]), p[0]),
    Math.pow(clamp(g * s[1] + o[1]), p[1]),
    Math.pow(clamp(b * s[2] + o[2]), p[2]),
  ];
}

// S 曲线(以 0.5 为轴的对比)
function sCurve(v, amount) {
  if (amount === 0) return v;
  const x = v - 0.5;
  const s = x * (1 + amount) - amount * x * x * x * 1.4;
  return clamp(0.5 + s);
}

// 分离色调:按亮度在阴影/高光各染色
function splitTone([r, g, b], shadowTint, highlightTint, strength = 1) {
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const wS = Math.pow(1 - lum, 2) * strength;
  const wH = Math.pow(lum, 2) * strength;
  return [
    clamp(r + shadowTint[0] * wS + highlightTint[0] * wH),
    clamp(g + shadowTint[1] * wS + highlightTint[1] * wH),
    clamp(b + shadowTint[2] * wS + highlightTint[2] * wH),
  ];
}

function saturate([r, g, b], s) {
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return [clamp(lum + (r - lum) * s), clamp(lum + (g - lum) * s), clamp(lum + (b - lum) * s)];
}

function mono([r, g, b], weights) {
  const y = weights[0] * r + weights[1] * g + weights[2] * b;
  return [clamp(y), clamp(y), clamp(y)];
}

// ---------- 风格定义 ----------
// 说明:全部按 Rec.709 显示输入设计(手机直出画面),可直接当"显示 LUT"用
const STYLES = [
  // ===== Leica =====
  {
    group: 'Leica', name: 'Leica Classic',
    desc: '徕卡经典:暖中间调、阴影微青、轻降饱和',
    matrix: [0.98, 0.02, 0.00, 0.01, 0.97, 0.02, 0.00, 0.03, 0.97],
    slope: [1.03, 1.00, 0.96], offset: [0.005, 0.004, 0.006], power: [1.02, 1.0, 0.99],
    contrast: 0.14, sat: 0.92,
    shadow: [-0.004, 0.004, 0.012], highlight: [0.018, 0.006, -0.010], tint: 1.2,
  },
  {
    group: 'Leica', name: 'Leica Natural',
    desc: '徕卡自然:近中性、轻微暖、低对比',
    matrix: [1.00, 0.00, 0.00, 0.00, 1.00, 0.00, 0.00, 0.01, 0.99],
    slope: [1.015, 1.005, 0.99], offset: [0.006, 0.006, 0.008], power: [1.0, 1.0, 1.0],
    contrast: 0.05, sat: 0.98,
    shadow: [0.000, 0.002, 0.006], highlight: [0.008, 0.004, -0.004], tint: 1.0,
  },
  {
    group: 'Leica', name: 'Leica Vivid',
    desc: '徕卡鲜明:饱和 +12%、对比加强、红黄突出',
    matrix: [1.04, 0.00, -0.02, 0.00, 1.03, 0.00, -0.02, 0.02, 1.03],
    slope: [1.05, 1.02, 0.98], offset: [0.000, 0.000, 0.002], power: [1.03, 1.01, 1.0],
    contrast: 0.22, sat: 1.12,
    shadow: [-0.006, 0.000, 0.010], highlight: [0.014, 0.004, -0.012], tint: 1.3,
  },
  {
    group: 'Leica', name: 'Leica Film',
    desc: '徕卡胶片:偏绿黄、抬黑位、低对比',
    matrix: [0.97, 0.03, 0.00, 0.02, 0.96, 0.02, 0.00, 0.04, 0.95],
    slope: [1.00, 1.01, 0.96], offset: [0.022, 0.024, 0.020], power: [1.05, 1.04, 1.02],
    contrast: 0.05, sat: 0.90,
    shadow: [0.006, 0.010, 0.004], highlight: [0.010, 0.012, -0.008], tint: 1.4,
  },
  {
    group: 'Leica', name: 'Leica Monochrom',
    desc: '徕卡黑白:高对比、红通道加权(皮肤透亮)',
    matrix: [1, 0, 0, 0, 1, 0, 0, 0, 1],
    slope: [1, 1, 1], offset: [0, 0, 0], power: [1, 1, 1],
    contrast: 0.28, sat: 1.0,
    mono: [0.34, 0.52, 0.14],
    shadow: [0, 0, 0], highlight: [0, 0, 0], tint: 0,
  },
  {
    group: 'Leica', name: 'Leica BW Soft',
    desc: '徕卡黑白柔和:低对比、高光柔、阴影透气',
    matrix: [1, 0, 0, 0, 1, 0, 0, 0, 1],
    slope: [1, 1, 1], offset: [0.012, 0.012, 0.012], power: [1.04, 1.04, 1.04],
    contrast: 0.10, sat: 1.0,
    mono: [0.30, 0.55, 0.15],
    shadow: [0, 0, 0], highlight: [0, 0, 0], tint: 0,
  },

  // ===== Fujifilm =====
  {
    group: 'Fuji', name: 'Fuji Classic Chrome',
    desc: '富士经典正片:降饱和、阴影青绿、高光偏黄、纪实感',
    matrix: [0.94, 0.05, 0.01, 0.02, 0.95, 0.03, 0.00, 0.06, 0.94],
    slope: [1.01, 1.00, 0.97], offset: [0.012, 0.014, 0.016], power: [1.02, 1.02, 1.03],
    contrast: 0.12, sat: 0.80,
    shadow: [-0.010, 0.012, 0.018], highlight: [0.020, 0.012, -0.014], tint: 1.6,
  },
  {
    group: 'Fuji', name: 'Fuji Classic Neg',
    desc: '富士经典负片:高对比、阴影品红、高光黄绿',
    matrix: [0.99, 0.02, -0.01, 0.01, 0.97, 0.02, 0.02, 0.04, 0.94],
    slope: [1.04, 1.00, 0.97], offset: [-0.004, 0.002, 0.010], power: [1.06, 1.02, 1.0],
    contrast: 0.24, sat: 0.95,
    shadow: [0.014, -0.008, 0.014], highlight: [-0.004, 0.012, -0.010], tint: 1.5,
  },
  {
    group: 'Fuji', name: 'Fuji Provia',
    desc: '富士标准:中性略饱和、干净',
    matrix: [1.01, 0.00, -0.01, 0.00, 1.00, 0.00, -0.01, 0.01, 1.00],
    slope: [1.02, 1.00, 0.99], offset: [0.002, 0.002, 0.004], power: [1.01, 1.0, 1.0],
    contrast: 0.10, sat: 1.05,
    shadow: [-0.002, 0.002, 0.006], highlight: [0.006, 0.002, -0.004], tint: 1.0,
  },
  {
    group: 'Fuji', name: 'Fuji Velvia',
    desc: '富士反转片:高饱和 +30%、高对比、红绿浓烈',
    matrix: [1.06, -0.02, -0.02, -0.01, 1.05, -0.01, -0.02, 0.01, 1.05],
    slope: [1.06, 1.03, 0.99], offset: [-0.002, -0.002, 0.000], power: [1.04, 1.02, 1.02],
    contrast: 0.30, sat: 1.30,
    shadow: [-0.010, 0.004, 0.014], highlight: [0.016, 0.004, -0.014], tint: 1.4,
  },
  {
    group: 'Fuji', name: 'Fuji Astia',
    desc: '富士柔和:肤色友好、低饱和、低对比',
    matrix: [0.99, 0.02, -0.01, 0.01, 1.00, 0.00, -0.01, 0.02, 0.99],
    slope: [1.01, 1.00, 0.99], offset: [0.010, 0.010, 0.012], power: [1.0, 1.0, 1.0],
    contrast: 0.04, sat: 0.95,
    shadow: [0.000, 0.004, 0.008], highlight: [0.010, 0.006, -0.006], tint: 0.8,
  },
  {
    group: 'Fuji', name: 'Fuji Eterna',
    desc: '富士电影感:低饱和、青绿阴影、平曲线',
    matrix: [0.96, 0.03, 0.01, 0.01, 0.98, 0.01, 0.00, 0.04, 0.96],
    slope: [1.00, 1.00, 0.98], offset: [0.018, 0.020, 0.022], power: [1.03, 1.03, 1.02],
    contrast: 0.02, sat: 0.85,
    shadow: [-0.008, 0.010, 0.016], highlight: [0.008, 0.010, -0.006], tint: 1.5,
  },
  {
    group: 'Fuji', name: 'Fuji Acros',
    desc: '富士 ACROS 黑白:深阴影、高光细腻',
    matrix: [1, 0, 0, 0, 1, 0, 0, 0, 1],
    slope: [1, 1, 1], offset: [0.002, 0.002, 0.002], power: [1.02, 1.02, 1.02],
    contrast: 0.22, sat: 1.0,
    mono: [0.24, 0.60, 0.16],
    shadow: [0, 0, 0], highlight: [0, 0, 0], tint: 0,
  },
  {
    group: 'Fuji', name: 'Fuji Pro Neg Std',
    desc: '富士专业负片标准:柔和中性、适合人像',
    matrix: [0.99, 0.01, 0.00, 0.01, 0.99, 0.00, 0.00, 0.02, 0.98],
    slope: [1.00, 1.00, 0.99], offset: [0.012, 0.012, 0.014], power: [1.0, 1.0, 1.0],
    contrast: 0.03, sat: 0.97,
    shadow: [-0.002, 0.004, 0.008], highlight: [0.008, 0.006, -0.004], tint: 0.9,
  },
  {
    group: 'Fuji', name: 'Fuji Pro Neg Hi',
    desc: '富士专业负片高对比:对比略高、肤色依旧柔',
    matrix: [0.99, 0.01, 0.00, 0.01, 0.99, 0.00, 0.00, 0.02, 0.98],
    slope: [1.02, 1.01, 0.99], offset: [0.006, 0.006, 0.008], power: [1.02, 1.01, 1.0],
    contrast: 0.16, sat: 1.02,
    shadow: [-0.004, 0.002, 0.010], highlight: [0.010, 0.004, -0.006], tint: 1.1,
  },
];

// ---------- 生成 ----------
function applyStyle(r, g, b, s) {
  let v = [r, g, b];
  v = mat3(s.matrix, v);
  v = cdl(v, s.slope, s.offset, s.power);
  if (s.mono) {
    v = mono(v, s.mono);
  } else {
    v = saturate(v, s.sat);
    v = splitTone(v, s.shadow, s.highlight, s.tint);
  }
  v = [sCurve(v[0], s.contrast), sCurve(v[1], s.contrast), sCurve(v[2], s.contrast)];
  return v.map(clamp);
}

function writeCube(style) {
  const dir = path.join(OUT, style.group.toLowerCase());
  fs.mkdirSync(dir, { recursive: true });
  const lines = [`TITLE "${style.name}"`, `# ${style.desc}`, `LUT_3D_SIZE ${SIZE}`,
                 'DOMAIN_MIN 0.0 0.0 0.0', 'DOMAIN_MAX 1.0 1.0 1.0', ''];
  for (let r = 0; r < SIZE; r++) {
    for (let g = 0; g < SIZE; g++) {
      for (let b = 0; b < SIZE; b++) {
        const out = applyStyle(r / (SIZE - 1), g / (SIZE - 1), b / (SIZE - 1), style);
        lines.push(`${out[0].toFixed(6)} ${out[1].toFixed(6)} ${out[2].toFixed(6)}`);
      }
    }
  }
  const file = path.join(dir, `${style.name}.cube`);
  fs.writeFileSync(file, lines.join('\n') + '\n', 'utf8');
  return { file, bytes: fs.statSync(file).size };
}

let n = 0;
for (const s of STYLES) {
  const r = writeCube(s);
  console.log(`${(r.bytes / 1024).toFixed(0).padStart(5)} KB  ${r.file}`);
  n++;
}
console.log(`\n生成 ${n} 个 LUT,尺寸 ${SIZE}³ = ${SIZE ** 3} 个体素`);
