# UI 风格索引

应用支持两套可切换主题。完整风格提示词分别存档在：

- [新拟物派（Neumorphism）](UI_STYLE_NEUMORPHISM.md) — 默认主题，`data-theme="neumorphism"`
- [瑞士国际风格（Swiss International）](UI_STYLE_SWISS.md) — `data-theme="swiss"`

## 主题实现

- 主题通过 `<html data-theme="...">` 切换，保存在浏览器 `localStorage` 的 `easyenglish.theme` 键中。
- 全局样式位于 `src/styles/main.css`，主题变量位于 `src/styles/themes/neumorphism.css` 与 `src/styles/themes/swiss.css`。
- 默认主题为新拟物派；首次加载时 `index.html` 的内联脚本会在样式生效前恢复主题，避免闪烁。
- 设置页的「外观」区块和侧栏底部的主题按钮都可以切换主题。

## 修改约定

1. 结构、布局和组件类写在 `main.css`，颜色、阴影、边框、圆角、字体、动效时长通过 CSS 变量表达。
2. 新增主题时，在 `src/styles/themes/` 下创建变量文件，并在 `src/lib/theme.ts` 注册。
3. 任何主题改动都要同时检查两套主题在桌面（1440px）与手机（390px）下的表现。
4. 两套风格各自的「绝对禁止 / 必须遵守 / 自检清单」优先级最高，发生冲突时以对应主题文档为准。
5. AI 生成的 Markdown 必须继续经过 DOMPurify 清洗。
