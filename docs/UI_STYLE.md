# UI 风格索引

应用支持两套可切换主题，每套主题都有浅色与深色模式。完整风格提示词分别存档在：

- [新拟物派（Neumorphism）](UI_STYLE_NEUMORPHISM.md) — 默认主题，`data-theme="neumorphism"`
- [瑞士国际风格（Swiss International）](UI_STYLE_SWISS.md) — `data-theme="swiss"`

## 主题实现

- 视觉主题通过 `<html data-theme="...">` 切换，保存在浏览器 `localStorage` 的 `easyenglish.theme` 键中。
- 深浅色通过 `<html data-mode="light|dark">` 独立切换，保存在 `localStorage` 的 `easyenglish.colorMode` 键中。两套主题分别提供 `[data-theme="..."][data-mode="dark"]` 的完整深色变量与组件覆盖。
- 全局样式位于 `src/styles/main.css`，主题变量位于 `src/styles/themes/neumorphism.css` 与 `src/styles/themes/swiss.css`。
- 默认主题为新拟物派、默认浅色；首次加载时 `index.html` 的内联脚本会在样式生效前恢复主题与模式，避免闪烁。
- 设置页有独立分类侧栏（通用 / 外观 / 复习 / AI / 人格 / 本地数据）；视觉主题和深浅色都在「外观」中切换。侧栏底部的月亮/太阳按钮只切换深浅色。
- `main.css` 中不得写死只适合浅色的颜色；使用 `--type-sentence-bg`、`--danger-ink`、`--overlay` 等 token，并在四套调色板（两主题 × 浅/深）中定义。

## 修改约定

1. 结构、布局和组件类写在 `main.css`，颜色、阴影、边框、圆角、字体、动效时长通过 CSS 变量表达。
2. 新增主题时，在 `src/styles/themes/` 下创建变量文件，并在 `src/stores/theme.ts` 注册；同时提供深色 `[data-mode="dark"]` 变量。
3. 任何主题改动都要同时检查两套主题 × 浅/深色在桌面（1440px）与手机（390px）下的表现。
4. 两套风格各自的「绝对禁止 / 必须遵守 / 自检清单」优先级最高，发生冲突时以对应主题文档为准；深色模式仍需遵守同一风格的光影、边框和排版规则。
5. AI 生成的 Markdown 必须继续经过 DOMPurify 清洗。
