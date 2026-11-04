# 飓风相机 + Leica / Fujifilm LUT

给 Android 上的「飓风相机」(`com.blackmagicdesign.android.blackmagiccam`)加装了 15 支 Leica / Fujifilm 风格 LUT 的安装包与配套脚本。

> 背景:市面上流传的「影视飓风相机安卓版」实际是 **Blackmagic Camera 官方 APK 改名重签**的二次打包(包名、原生库、内置 LUT、相机控制 proto 全是 Blackmagic Design 的,只有 `app_name` 被改成「飓风相机」)。逆向过程见 [`docs/逆向分析报告.md`](docs/逆向分析报告.md)。

## 直接装机

```
apk/飓风相机-with-Leica-Fuji-LUTs.apk
```

```bash
adb uninstall com.blackmagicdesign.android.blackmagiccam   # 签名不同,先卸载
adb install -r apk/飓风相机-with-Leica-Fuji-LUTs.apk
```

装完打开 → 主界面点 **LUT** 按钮 → 列表里就能看到 `Leica Classic`、`Fuji Classic Chrome` 等 15 支,和 Blackmagic 自带的 Cinema Teal / Vivid 排在一起。

## LUT 清单(33³ .cube)

**Leica(6)**

| 文件 | 风格 |
|---|---|
| `luts/leica/Leica Classic.cube` | 暖中间调、阴影微青、轻降饱和 |
| `luts/leica/Leica Natural.cube` | 近中性、轻微暖、低对比 |
| `luts/leica/Leica Vivid.cube` | 饱和 +12%、对比加强 |
| `luts/leica/Leica Film.cube` | 偏绿黄、抬黑位、胶片感 |
| `luts/leica/Leica Monochrom.cube` | 黑白,红通道加权 |
| `luts/leica/Leica BW Soft.cube` | 黑白柔和 |

**Fujifilm(9)**

| 文件 | 风格 |
|---|---|
| `luts/fuji/Fuji Classic Chrome.cube` | 降饱和、阴影青绿、高光偏黄 |
| `luts/fuji/Fuji Classic Neg.cube` | 高对比、阴影品红 |
| `luts/fuji/Fuji Provia.cube` | 中性略饱和 |
| `luts/fuji/Fuji Velvia.cube` | 高饱和 +30%、高对比 |
| `luts/fuji/Fuji Astia.cube` | 柔和、肤色友好 |
| `luts/fuji/Fuji Eterna.cube` | 电影感、低饱和、青绿阴影 |
| `luts/fuji/Fuji Acros.cube` | 黑白、深阴影 |
| `luts/fuji/Fuji Pro Neg Std.cube` | 柔和中性 |
| `luts/fuji/Fuji Pro Neg Hi.cube` | 对比略高 |

效果对比:[`luts/preview.png`](luts/preview.png)(第一行是原图)

## 原理:内置 LUT 是怎么塞进去的

`LutManager` 会动态扫描 assets 目录:

```smali
const-string v8, "bmc_luts/"
invoke-virtual {v1, v6}, Landroid/content/res/AssetManager;->list(Ljava/lang/String;)[Ljava/lang/String;
const-string v11, ".obj"
```

文件名去掉 `.obj` 就是 LUT 显示名,首启时同步进 Room 数据库。所以只要往 `assets/bmc_luts/Rec.709/` 放文件即可。

内置 `.obj` 不是普通 LUT,而是 **Java 序列化的 `Lut` 对象**:

```
AC ED 00 05                                    STREAM_MAGIC / VERSION
73 72                                           TC_OBJECT / TC_CLASSDESC
  00 2b  com.blackmagicdesign.android.utils.luts.Lut
  47 85 75 0f e8 dd a2 dc                      serialVersionUID
  02 00 08                                     SC_SERIALIZABLE, 8 fields
     Z isInVideoRange   Z isOutVideoRange
     I lut1dSize        I lut3dSize
     L description      L fileName(ref)
     L lut1dArrays      [ lut3dArray
78 70                                           TC_ENDBLOCKDATA / TC_NULL
<values…>                                       74 <description> 74 <fileName> 70
75 72 00 02 5B 42 ac f3 17 f8 06 08 54 e0 02 00 00 78 70
  00 02 31 84                                   数组长度 143748 = 33³ × 4 (RGBA, A 恒 255)
```

`scripts/inject_luts.js` 复用官方 `.obj` 的头部字节,只替换数据区(转换后的 obj 与原 cube 采样误差 = 0)。

## 脚本

| 文件 | 用途 |
|---|---|
| `scripts/gen_luts.js` | 生成 15 支 .cube(改里面 `STYLES` 的参数即可调风格) |
| `scripts/render_lut_preview.js` | 生成 `preview.png` 色卡对比图(纯 Node,自带 PNG 编码) |
| `scripts/inject_luts.js` | .cube → App 内置 `.obj`,写入 `apktool_out/assets/bmc_luts/<色彩空间>/` |

自己改风格重打包:

```powershell
node scripts/gen_luts.js  .\luts            # 重新生成 cube
node scripts/inject_luts.js .\apktool_out\assets\bmc_luts\Rec.709
java -jar apktool.jar b apktool_out -o out\luts_unsigned.apk
zipalign -p -f 4 out\luts_unsigned.apk out\luts_aligned.apk
apksigner sign --ks re.keystore --v3-signing-enabled true --v1-signing-enabled false `
  --out out\luts_signed.apk out\luts_aligned.apk
```

## 关于数据上传

静态分析结论(见 `docs/逆向分析报告.md`):

- LUT 全部本地解析(`liblutparser.so`),**不上传**
- 唯一的上传目标是 `*.bmd.cloud`(Blackmagic 自家云),需要登录 Resolve Cloud 才工作,且自动上传默认关闭
- 没有第三方统计 / 广告 / 下载器域名

要彻底锁死外联:在路由器或自建 DNS 上 `address=/bmd.cloud/0.0.0.0`。

## 说明

这 15 支 LUT 是按各机型光谱特征**参数化生成的风格近似**(3×3 通道矩阵 + ASC-CDL + S 曲线 + 分离色调),不是从徕卡/富士固件提取的原厂曲线。想要更贴近原厂,可以拿真机拍灰卡色卡反推 3D LUT,替换 `STYLES` 参数重跑。
