# UI 风格约束

> 本文件是界面实现的最高优先级约束。风格名称：**新拟物派（Neumorphism / Soft UI）**。
> 修改界面时必须逐条对照本文档与最终自检清单，禁止风格漂移。

---

# Neumorphism（新拟物派）设计系统

你是一位专精于 Neumorphism（新拟物派 / Soft UI）风格的前端开发专家。生成的所有代码都必须严格遵守以下规范。

## 绝对禁止

- 禁止使用纯黑或纯白背景
- 禁止使用高对比度配色
- 禁止使用粗边框 border-2 及以上
- 禁止使用渐变背景 bg-gradient-*
- 禁止直角 rounded-none
- 禁止按钮使用任何 translate 位移（新拟物元素是长在背景上的，不可浮起）
- 禁止 hover 时增大阴影（与光影物理规律相悖，手指靠近应使阴影缩小）
- 禁止打破光源方向（亮阴影必须在左上 -X/-Y，暗阴影必须在右下 +X/+Y）
- 禁止输入框 focus 时增大内阴影（应减小，模拟通道开放而非加压）

## 必须遵守

- 使用浅色背景 #e0e5ec 或 #f0f0f3
- 使用双重阴影 `8px 8px 16px #b8bcc2, -8px -8px 16px #ffffff`
- 凹陷效果使用 inset 阴影 `inset 8px 8px 16px #b8bcc2, inset -8px -8px 16px #ffffff`
- 使用中等圆角 12-24px
- 交互元素按下时从凸起变凹陷
- 保持元素与背景同色系
- 响应式阴影大小：桌面增大
- 按钮 hover 时减小外阴影（Hover Shadowing，手指靠近遮光效果）：从 8px 减至 4px
- 按钮 active 必须从外凸转为内凹（Extrude to Intrude）：`inset 4px 4px 8px #b8bcc2, inset -4px -4px 8px #ffffff`，禁止使用 translate 位移
- 所有过渡使用 300ms ease-in-out（Smooth Molding，软塑料柔韧性）
- 输入框 focus 时减小内阴影深度（惰性收缩，非增强）：从 inset 6px 减至 inset 2px，暗示输入通道打开
- 光源方向始终固定为左上亮、右下暗（Fixed Illuminant）：负 X/Y 偏移 = 白色高光，正 X/Y 偏移 = 暗色阴影

## 风格身份

- **名称**：Neumorphism / Soft UI（新拟物派）
- **分类**：现代、极简
- **本质**：通过双重阴影模拟光线打在类粘土表面上的效果，营造柔和的立体纵深感
- **气质**：平静、可触、精致、亲和

### 核心视觉原则

**背景基调**

```
必须使用：bg-[#e0e5ec] 或 bg-[#f0f0f3]
仅使用浅灰单色背景
元素必须与背景保持同一色系
```

**阴影系统（双光源）**

```
凸起（默认）：
8px 8px 16px #b8bcc2, -8px -8px 16px #ffffff
- 暗阴影：右下方向 (+X, +Y) → #b8bcc2
- 亮阴影：左上方向 (-X, -Y) → #ffffff
- 模糊半径：偏移量的 1.5-2 倍

凹陷（按下 / 输入框）：
inset 8px 8px 16px #b8bcc2, inset -8px -8px 16px #ffffff
- 光源方向不变，但改为 inset
```

**圆角**

```
必须使用：12px 或 16-24px
所有元素保持柔和、一致的曲率
```

## 交互规范

### 按钮状态

| 状态 | 效果 | 实现 |
| --- | --- | --- |
| Default | 凸起 | `8px 8px 16px #b8bcc2, -8px -8px 16px #ffffff` |
| Hover | 阴影缩小 | `4px 4px 8px #b8bcc2, -4px -4px 8px #ffffff` |
| Active | 凹陷（inset） | `inset 4px 4px 8px #b8bcc2, inset -4px -4px 8px #ffffff` |
| Disabled | 淡化 | opacity 50%，阴影减弱 |

### 输入框状态

| 状态 | 效果 | 实现 |
| --- | --- | --- |
| Default | 深凹陷 | `inset 6px 6px 12px #b8bcc2, inset -6px -6px 12px #ffffff` |
| Focus | 浅凹陷 | `inset 2px 2px 4px #b8bcc2, inset -2px -2px 4px #ffffff` |

## 动效规则

### 交互物理

- **Extrude to Intrude**：按钮 active 状态必须从凸起切换为凹陷阴影，禁止任何 translate 位移——元素是从表面生长出来的，不会悬浮。
- **Hover Shadowing**：hover 时阴影必须缩小（16px → 8px），模拟手指靠近遮挡光源。这与常规 hover 相反——阴影应缩小而非放大。
- **Smooth Molding**：所有过渡都使用 300ms ease-in-out，模拟软橡胶/软塑料般的柔韧弹性。
- **Fixed Illuminant**：光源方向固定锁死在左上方，任何阴影配置都不得破坏这一方向。

## 配色方案

| Token | 值 | 用途 |
| --- | --- | --- |
| 背景 | #e0e5ec | 主要表面 |
| 浅背景 | #f0f0f3 | 抬升表面 |
| 暗阴影 | #b8bcc2 | 右下阴影 |
| 亮阴影 | #ffffff | 左上高光 |
| 强调色 | #6d5dfc | 交互元素、CTA |
| 主文字 | #333333 | 标题、正文 |
| 次要文字 | #6b7280 | 弱化文字、标签 |

## 禁止使用的模式

| 模式 | 原因 |
| --- | --- |
| bg-white, bg-black | 破坏单色系的和谐感 |
| 硬边阴影 | 违背柔和美学 |
| 高对比度配色 | 破坏细腻的立体感知 |
| border-2 及以上 | 边框会破坏无缝的表面错觉 |
| 渐变背景 | 渐变与扁平光照模拟相冲突 |
| 直角 | 直角与柔软材质感相悖 |
| 按钮使用 translate | 元素属于表面的一部分，不会浮起 |
| 更大的 hover 阴影 | 违背光照物理规律（手指靠近应遮光） |

## 响应式规范

### 阴影缩放

```
移动端：4px 4px 8px #b8bcc2, -4px -4px 8px #ffffff
桌面端：8px 8px 16px #b8bcc2, -8px -8px 16px #ffffff
```

### 间距

```
内边距：16px / 24px / 32px
间隙：16px / 24px
区块：48px / 80px
```

## 自检清单

输出代码前请逐项确认：

- [ ] 背景是 #e0e5ec 或 #f0f0f3
- [ ] 所有阴影都使用双光源（亮/暗）格式
- [ ] 亮阴影位于 -X/-Y，暗阴影位于 +X/+Y
- [ ] 按钮：hover 缩小阴影，active 转为 inset
- [ ] 输入框使用 inset 阴影，focus 时减小深度
- [ ] 交互元素上没有使用 translate
- [ ] 圆角是 12px / 16-24px
- [ ] 过渡使用 300ms ease-in-out

---

# Neumorphism (新拟物派) Design System

> 柔和的内凹外凸立体效果，通过双重阴影模拟光源，浅色背景配同色系元素，营造精致的立体感。

## 核心理念

Neumorphism（新拟物派）是一种介于扁平设计和拟物设计之间的风格，通过柔和的阴影创造出元素从背景中"挤压"或"凹陷"的视觉效果。

核心理念：

- 柔和立体：通过双重阴影（亮/暗）模拟自然光源
- 同色系统一：元素与背景使用相同或相近的颜色
- 触感直觉：凸起表示可交互，凹陷表示已激活或输入区
- 克制装饰：避免过多颜色和对比，保持整体柔和感

设计原则：

- 视觉一致性：所有组件必须遵循统一的视觉语言，从色彩到字体到间距保持谐调
- 层次分明：通过颜色深浅、字号大小、留白空间建立清晰的信息层级
- 交互反馈：每个可交互元素都必须有明确的 hover、active、focus 状态反馈
- 响应式适配：设计必须在移动端、平板、桌面端上保持一致的体验
- 无障碍性：确保色彩对比度符合 WCAG 2.1 AA 标准，所有交互元素可键盘访问

---

## Token 字典（精确映射）

### 边框

```
宽度: 0
颜色: transparent
圆角: 12px / 16px / 24px
```

### 阴影

```
小: 4px 4px 8px #b8bcc2, -4px -4px 8px #ffffff
中: 6px 6px 12px #b8bcc2, -6px -6px 12px #ffffff
桌面: 8px 8px 16px #b8bcc2, -8px -8px 16px #ffffff
大: 8px 8px 16px #b8bcc2, -8px -8px 16px #ffffff
大桌面: 12px 12px 24px #b8bcc2, -12px -12px 24px #ffffff
悬停: 4px 4px 8px #b8bcc2, -4px -4px 8px #ffffff
按下: inset 5px 5px 10px #b8bcc2, inset -5px -5px 10px #ffffff
输入框: inset 6px 6px 12px #b8bcc2, inset -6px -6px 12px #ffffff
输入框聚焦: inset 2px 2px 4px #b8bcc2, inset -2px -2px 4px #ffffff
```

### 交互效果

```
悬停位移: 无
悬停缩放: 不使用
过渡动画: 300ms ease-in-out
按下状态: inset 5px 5px 10px #b8bcc2, inset -5px -5px 10px #ffffff
```

### 字体

```
标题: 600，主文字 #333333
正文: 次要文字 #4b5563 / #6b7280
等宽: monospace
禁止使用 Inter / Roboto / Geist 等过度使用的字体
```

### 字号

```
Hero: 36px / 60px
H1: 30px / 36px
H2: 24px / 30px
H3: 20px / 24px
正文: 14px / 16px
小字: 12px
```

### 间距

```
Section: 48px / 80px
容器: 24px / 32px
卡片: 24px / 32px
小间距: 12px / 16px
中间距: 16px / 24px
大间距: 24px / 32px
```

### 颜色角色

```
背景主色: #e0e5ec
背景辅色: #f0f0f3
强调色: #6d5dfc
辅助强调: #ff6b6b / #4ecdc4 / #ffe66d
正文主色: #333333
正文辅色: #4b5563
正文弱化色: #6b7280
按钮主色: #6d5dfc + 白色文字
按钮辅色: #e0e5ec + #4b5563 文字
```

---

## [FORBIDDEN] 绝对禁止

以下模式在本风格中**绝对禁止使用**，生成时必须检查并避免：

### 禁止的 Class / 模式

- `rounded-none`
- `rounded-sm`
- `shadow-sm` / `shadow` / `shadow-md` / `shadow-lg` / `shadow-xl` / `shadow-2xl`
- `bg-black` / `bg-white` / `bg-gray-900` / `bg-gray-950`
- `border-2` / `border-4` / `border-8` / `border`
- `bg-gradient-to-r` / `bg-gradient-to-l` / `bg-gradient-to-t` / `bg-gradient-to-b`

### 禁止原因

- 直角与柔软材质感相悖，Neumorphism 需要 12-24px 圆角
- Neumorphism 使用双光源阴影系统，不使用标准阴影
- Neumorphism 使用浅灰背景（#e0e5ec），不使用纯白或纯黑
- 边框会破坏无缝的表面错觉，元素之间靠阴影与留白区分
- 渐变与扁平光照模拟相冲突

---

## [REQUIRED] 必须包含

### 按钮

```
bg-[#e0e5ec]
圆角 12px
hover 时阴影缩小
active 时 inset 阴影
transition 300ms ease-in-out
禁止 translate
```

### 卡片

```
bg-[#e0e5ec]
圆角 16-24px
双光源外凸阴影
```

### 输入框

```
bg-[#e0e5ec]
圆角 12-16px
默认 inset 阴影
focus 时 inset 阴影减小
focus 不增大阴影
```

---

## 页面骨架约定

### 导航栏

```
浅灰背景 #e0e5ec，文字 #333333 / #4b5563
无边框，圆角 12px 的导航项
选中项使用 inset 阴影，hover 使用缩小后的凸起阴影
```

### Hero 区块

```
浅灰背景，不使用渐变
大圆角外凸面板
标题 #333333，强调信息可用 #6d5dfc
CTA 使用强调色按钮
```

### 卡片网格

```
bg-[#e0e5ec]，圆角 16-24px
双光源外凸阴影
卡片之间用 16-24px 间距，不嵌套卡片
```

### 表单输入

```
bg-[#e0e5ec]，圆角 12-16px
默认 inset 6px/12px 阴影
focus 时收缩为 inset 2px/4px
```

---

## 最终自检清单

**输出代码前，逐项验证当前风格的 token 和规则。如有违反，先修正再交付：**

### Token 检查

- [ ] 按钮：同色背景、12px 圆角、hover 阴影缩小、active inset、300ms ease-in-out
- [ ] 卡片：同色背景、16-24px 圆角、双光源外凸阴影
- [ ] 输入框：同色背景、12-16px 圆角、inset 阴影、focus 减小、无 outline 增大

### 禁止项检查

- [ ] 没有使用直角或小圆角
- [ ] 没有使用标准阴影类
- [ ] 没有使用纯黑 / 纯白背景
- [ ] 没有使用可见边框
- [ ] 没有使用渐变背景
- [ ] 没有使用按钮 translate 位移
- [ ] 没有在 hover 时增大阴影
- [ ] 没有在输入框 focus 时增大内阴影

### 风格规则检查

- [ ] 使用浅色背景 #e0e5ec 或 #f0f0f3
- [ ] 使用双重阴影（亮/暗）
- [ ] 凹陷效果使用 inset 阴影
- [ ] 使用中等圆角 12-24px
- [ ] 交互元素按下时从凸起变凹陷
- [ ] 光源方向始终为左上亮、右下暗

### 通用交付检查

- [ ] 响应式布局在手机、平板和桌面下稳定，没有横向溢出
- [ ] 所有交互元素有清晰焦点、可访问名称和 reduced-motion 方案
- [ ] 文本对比度达到 WCAG AA，且没有用颜色单独传递状态
- [ ] 结果仍然能够一眼识别为 Neumorphism
- [ ] 没有紫色到蓝色的渐变
- [ ] 没有使用 Inter / Roboto / Geist 等过度使用的字体
- [ ] 没有嵌套卡片（卡片里面套卡片）
- [ ] 没有在彩色背景上放灰色文字
- [ ] 没有 bounce / elastic 缓动曲线
- [ ] 没有单侧粗边框装饰
- [ ] 没有渐变文字
- [ ] 没有把玻璃态（glassmorphism）当作默认风格
- [ ] 没有 tiny uppercase tracked eyebrow 放在每个 section 标题上面
