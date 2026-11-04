# Ycamera

Android 相机 App:**Blackmagic Camera 官方内核 + 去品牌改造 + 15 支 Leica/Fujifilm LUT**。
装完就是一台能拍、能套 LUT、不连任何云的本机相机。

```
apk/Ycamera.apk        # 直接装
luts/                          # 15 支 .cube(已内置,也可单独导入)
scripts/                       # LUT 生成、注入、去品牌脚本
docs/逆向分析报告.md            # 原始样本的逆向记录
```

## 安装

```bash
adb uninstall com.blackmagicdesign.android.blackmagiccam   # 签名不同,先卸载
adb install -r apk/Ycamera.apk
```

装完桌面叫「Ycamera」,设置里是:

```
录制 / 摄影机 / 监视 / 直播 / 媒体 / 功能按键 / LUT / 预设 / 配件
远程摄影机控制 / 云同步 / 重置 / 关于
```

## 这版改了什么

### 1. 品牌清理(用户可见层全部去掉 Blackmagic)

| 位置 | 原文案 | 现在 |
|---|---|---|
| 应用名 | 飓风相机(第三方改的) | Ycamera |
| 设置分类 | Blackmagic Cloud | 云同步 |
| 登录入口 | Log in to Blackmagic Cloud | 登录云同步 |
| 关于 | 详情请访问网址:blackmagicdesign.com | 本机版 · 无云端服务 |
| 权限提示 | Allow Blackmagic Camera to… | 允许 Ycamera… |
| 重置项 | Reset Camera and Cloud Settings | 重置Ycamera设置 |

字符串资源层 `blackmagic` 命中数:**58 → 0**。

### 2. LUT 内置

`assets/bmc_luts/Rec.709/` 里塞了 15 支自制的 Leica / Fujifilm 风格 LUT,首启自动进列表(和 Cinema Teal / Vivid 排一起)。原理见下方「内置 LUT 格式」。

### 3. 云功能

- UI 文案已改成「云同步」,不再是 Blackmagic 品牌
- 网络权限 `INTERNET` **必须保留**——实测删掉会崩:

  ```
  java.lang.SecurityException: NsdService: Neither user 10437 nor current process has android.permission.INTERNET
  ```

  App 用 mDNS(`javax/jmdns`)在局域网发现相机,没有 INTERNET 权限会在启动阶段直接抛异常退出。
- 要彻底断云端:在路由器 / 自建 DNS 上黑洞整个域

  ```
  address=/bmd.cloud/0.0.0.0
  ```

  或者手机设置 → 私人 DNS 指向自己的 dnsmasq / AdGuard Home。

- 已删除的权限:`READ_PHONE_STATE`、`BLUETOOTH_PRIVILEGED`(相机用不到)。

## 内置 LUT 格式(逆向出来的)

`LutManager` 动态扫 assets:

```smali
const-string v8, "bmc_luts/"
invoke-virtual {v1, v6}, Landroid/content/res/AssetManager;->list(Ljava/lang/String;)[Ljava/lang/String;
const-string v11, ".obj"
```

文件名去 `.obj` 即 LUT 显示名,首启写进 Room。内置 `.obj` 是 **Java 序列化的 `Lut` 对象**:

```
AC ED 00 05                                     STREAM_MAGIC / VERSION
73 72 00 2b ...utils.luts.Lut                   TC_OBJECT / TC_CLASSDESC
47 85 75 0f e8 dd a2 dc                         serialVersionUID
02 00 08                                        SC_SERIALIZABLE, 8 字段
  Z isInVideoRange   Z isOutVideoRange
  I lut1dSize        I lut3dSize
  L description      L fileName(ref)
  L lut1dArrays      [ lut3dArray
78 70                                            TC_ENDBLOCKDATA / TC_NULL
74 <description> 74 <fileName> 70                值
75 72 00 02 5B 42 ac f3 17 f8 06 08 54 e0 …
  00 02 31 84                                    数组长 143748 = 33³ × 4(RGBA,A=255)
```

`scripts/inject_luts.js` 复用官方 `.obj` 头部,只换数据区;转换后 obj 与原 cube 采样误差 0。

## 脚本

| 文件 | 用途 |
|---|---|
| `scripts/gen_luts.js` | 生成 15 支 .cube(改 `STYLES` 调风格) |
| `scripts/render_lut_preview.js` | 出色卡对比图 `preview.png` |
| `scripts/inject_luts.js` | .cube → 内置 `.obj` |
| `scripts/debrand.ps1` + `debrand-rules.json` | 批量去品牌 + 删权限 |
| `scripts/repack.ps1` | 一键:反编译 → 改 → 打包 → 对齐 → 签名 |

## 踩过的坑

1. **删 INTERNET 会崩** — mDNS 抛 SecurityException,未捕获,直接 FATAL。保留。
2. **改 `BaseSettingsCategory` 的 Availability 会崩** — 把云分类设成 `NotAvailable` 触发 `VerifyError`(`const/16 v16, 0x3` 不能当 null 传给 `Availability` 参数,只有 0 可以)。想隐藏该分类得改 UI 列表构建,不值得。
3. **改 smali 里的 `"DCIM/Blackmagic Camera"` / `"Blackmagic Cloud"` 会崩** — `settings.u` 用它们做 when 分支匹配,改了落进 `TODO()`。目录名保持原样。
4. **apktool 回写 smali 带 BOM 会打包失败** — `required (...)+ loop did not match anything at input '?'`,去 BOM 即可。
5. **包名不能改** — `liblutparser.so` 的 JNI 符号写死了 `Java_com_blackmagicdesign_android_utils_luts_NativeLutParser_parseCubeFile`,改包名 LUT 解析直接废。

## 说明

15 支 LUT 是按机型光谱特征参数化生成的风格近似(3×3 矩阵 + ASC-CDL + S 曲线 + 分离色调),不是从徕卡/富士固件提取的原厂曲线。要更贴近原厂,拿真机拍灰卡色卡反推 3D LUT,替换 `STYLES` 重跑。
