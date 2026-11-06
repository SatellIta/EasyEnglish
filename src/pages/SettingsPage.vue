<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import type { ReviewSettings } from '@shared/types'
import Icon from '@/components/Icon.vue'
import { api, errorMessage } from '@/lib/api'
import { useAppStore } from '@/stores/app'
import { THEMES, useThemeStore } from '@/stores/theme'

const store = useAppStore()
const themeStore = useThemeStore()

const form = reactive({
  baseUrl: '',
  model: '',
  apiKey: '',
  clearApiKey: false,
})
const reviewForm = reactive({
  intervalsText: '',
  forgotRetryMinutes: 10,
})
const loading = ref(true)
const saving = ref(false)
const testing = ref(false)
const reviewSaving = ref(false)
const savedReviewText = ref('')
const error = ref('')
const notice = ref('')
const reviewError = ref('')
const reviewNotice = ref('')
const testResult = ref<{ ok: boolean; message: string } | null>(null)

const presets = [
  { name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  { name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  {
    name: '通义千问',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen-plus',
  },
  { name: 'Ollama 本地', baseUrl: 'http://localhost:11434/v1', model: 'qwen2.5:7b' },
]

async function load() {
  loading.value = true
  error.value = ''
  try {
    const [settings, review] = await Promise.all([
      api.settings.get(),
      api.settings.review(),
    ])
    form.baseUrl = settings.baseUrl
    form.model = settings.model
    form.apiKey = ''
    form.clearApiKey = false
    store.settings = settings

    reviewForm.intervalsText = review.intervalsDays.join(', ')
    reviewForm.forgotRetryMinutes = review.forgotRetryMinutes
    savedReviewText.value = `${review.intervalsDays.join(' / ')} 天 · 重试 ${review.forgotRetryMinutes} 分钟`
  } catch (caught) {
    error.value = errorMessage(caught)
  } finally {
    loading.value = false
  }
}

function applyPreset(preset: (typeof presets)[number]) {
  form.baseUrl = preset.baseUrl
  form.model = preset.model
  notice.value = `已填入 ${preset.name} 的地址，保存前请确认模型名可用。`
}

async function save() {
  saving.value = true
  error.value = ''
  notice.value = ''
  try {
    const settings = await api.settings.update({
      baseUrl: form.baseUrl.trim(),
      model: form.model.trim(),
      apiKey: form.apiKey.trim() || undefined,
      clearApiKey: form.clearApiKey,
    })
    store.settings = settings
    form.apiKey = ''
    form.clearApiKey = false
    notice.value = '设置已保存。'
  } catch (caught) {
    error.value = errorMessage(caught)
  } finally {
    saving.value = false
  }
}

async function test() {
  testing.value = true
  error.value = ''
  testResult.value = null
  try {
    const result = await api.settings.test({
      baseUrl: form.baseUrl.trim() || undefined,
      model: form.model.trim() || undefined,
      apiKey: form.apiKey.trim() || undefined,
    })
    testResult.value = result.ok
      ? {
          ok: true,
          message: `连接成功，模型 ${result.model} 返回：${result.reply || 'OK'}`,
        }
      : { ok: false, message: result.error || '连接失败' }
  } catch (caught) {
    testResult.value = { ok: false, message: errorMessage(caught) }
  } finally {
    testing.value = false
  }
}

async function saveReview() {
  reviewSaving.value = true
  reviewError.value = ''
  reviewNotice.value = ''
  try {
    const intervals = reviewForm.intervalsText
      .split(/[,，\s]+/)
      .map((value) => Number(value))
      .filter((value) => Number.isFinite(value) && value > 0)

    if (!intervals.length) throw new Error('请至少填写一个大于 0 的复习间隔')
    const retry = Number(reviewForm.forgotRetryMinutes)
    if (!Number.isFinite(retry) || retry <= 0) {
      throw new Error('遗忘后重试窗口必须大于 0 分钟')
    }

    const saved: ReviewSettings = await api.settings.updateReview({
      intervalsDays: intervals,
      forgotRetryMinutes: retry,
    })
    reviewForm.intervalsText = saved.intervalsDays.join(', ')
    reviewForm.forgotRetryMinutes = saved.forgotRetryMinutes
    savedReviewText.value = `${saved.intervalsDays.join(' / ')} 天 · 重试 ${saved.forgotRetryMinutes} 分钟`
    reviewNotice.value = '遗忘曲线已保存，新的安排会应用于之后的复习。'
  } catch (caught) {
    reviewError.value = errorMessage(caught)
  } finally {
    reviewSaving.value = false
  }
}

onMounted(load)
</script>

<template>
  <div class="page settings-page">
    <header class="page-head">
      <div>
        <h1>设置</h1>
        <p>配置 AI 接入、遗忘曲线与界面主题，数据全部保存在本机。</p>
      </div>
    </header>

    <p v-if="error" class="banner banner-error">{{ error }}</p>
    <p v-if="notice" class="banner banner-ok">{{ notice }}</p>

    <section class="card settings-card">
      <div class="card-title">
        <div>
          <h2>外观</h2>
          <p class="hint">切换后立即生效，偏好保存在当前浏览器。</p>
        </div>
        <span class="status-pill ok">
          {{ themeStore.theme === 'swiss' ? '瑞士国际' : '新拟物派' }}
        </span>
      </div>

      <div class="theme-options">
        <button
          v-for="option in THEMES"
          :key="option.id"
          type="button"
          class="theme-option"
          :class="{ active: themeStore.theme === option.id }"
          :aria-pressed="themeStore.theme === option.id"
          @click="themeStore.setTheme(option.id)"
        >
          <span class="theme-swatch" :class="`swatch-${option.id}`" aria-hidden="true" />
          <span class="theme-copy">
            <strong>{{ option.name }}</strong>
            <small>{{ option.description }}</small>
          </span>
          <Icon
            v-if="themeStore.theme === option.id"
            class="theme-check"
            name="check"
            :size="17"
          />
        </button>
      </div>
    </section>

    <section class="card settings-card">
      <div class="card-title">
        <div>
          <h2>遗忘曲线</h2>
          <p class="hint">控制每个复习阶段之间的窗口长度。</p>
        </div>
      </div>

      <p v-if="reviewError" class="banner banner-error">{{ reviewError }}</p>
      <p v-if="reviewNotice" class="banner banner-ok">{{ reviewNotice }}</p>

      <div class="field">
        <label for="review-intervals">复习间隔（天）</label>
        <input
          id="review-intervals"
          v-model="reviewForm.intervalsText"
          class="input"
          placeholder="1, 2, 4, 7, 15, 30, 60, 120, 240"
          :disabled="loading"
        />
        <span class="hint">
          用逗号分隔。第 N 次选择「记得」后，按第 N 个间隔安排下一次复习；走完最后一个间隔后视为已掌握。
        </span>
      </div>

      <div class="field">
        <label for="review-retry">遗忘后重试窗口（分钟）</label>
        <input
          id="review-retry"
          v-model.number="reviewForm.forgotRetryMinutes"
          type="number"
          min="1"
          max="1440"
          class="input"
          :disabled="loading"
        />
        <span class="hint">
          选择「不记得」后，词条会在该时间后重新进入复习队列。默认 10 分钟。
        </span>
      </div>

      <div class="actions">
        <button class="btn btn-primary" :disabled="reviewSaving" @click="saveReview">
          {{ reviewSaving ? '保存中…' : '保存遗忘曲线' }}
        </button>
      </div>
    </section>

    <section class="card settings-card">
      <div class="card-title">
        <div>
          <h2>AI 接入</h2>
          <p class="hint">支持 OpenAI / DeepSeek / 通义千问 / Ollama 等兼容接口。</p>
        </div>
        <span
          class="status-pill"
          :class="store.settings?.configured ? 'ok' : 'warn'"
        >
          {{ store.settings?.configured ? '已配置' : '未配置' }}
        </span>
      </div>

      <div class="field">
        <label>快捷预设</label>
        <div class="presets">
          <button
            v-for="preset in presets"
            :key="preset.name"
            class="preset"
            type="button"
            @click="applyPreset(preset)"
          >
            {{ preset.name }}
          </button>
        </div>
      </div>

      <div class="field">
        <label for="base-url">Base URL</label>
        <input
          id="base-url"
          v-model="form.baseUrl"
          class="input"
          placeholder="https://api.openai.com/v1"
          :disabled="loading"
        />
      </div>

      <div class="field">
        <label for="model">模型</label>
        <input
          id="model"
          v-model="form.model"
          class="input"
          list="model-options"
          placeholder="gpt-4o-mini"
          :disabled="loading"
        />
        <datalist id="model-options">
          <option value="gpt-4o-mini" />
          <option value="gpt-4o" />
          <option value="deepseek-chat" />
          <option value="deepseek-reasoner" />
          <option value="qwen-plus" />
          <option value="qwen-max" />
          <option value="qwen2.5:7b" />
          <option value="llama3.1" />
        </datalist>
        <span class="hint">可从常见模型中选择，也可以直接输入自定义模型名。</span>
      </div>

      <div class="field">
        <label for="api-key">API Key</label>
        <input
          id="api-key"
          v-model="form.apiKey"
          type="password"
          class="input"
          :placeholder="
            store.settings?.hasApiKey
              ? `已保存 ${store.settings.apiKeyMasked}，留空表示不修改`
              : 'sk-...'
          "
          :disabled="loading || form.clearApiKey"
          autocomplete="off"
        />
        <label v-if="store.settings?.hasApiKey" class="check-row">
          <input v-model="form.clearApiKey" type="checkbox" />
          清除已保存的 API Key
        </label>
        <span class="hint">
          本地 Ollama 等无需鉴权的服务可以留空；Key 仅保存在本机数据库。
        </span>
      </div>

      <div class="actions">
        <button class="btn btn-ghost" :disabled="testing" @click="test">
          <Icon :name="testing ? 'refresh' : 'layers'" :size="16" />
          {{ testing ? '测试中…' : '测试连接' }}
        </button>
        <button class="btn btn-primary" :disabled="saving" @click="save">
          <Icon :name="saving ? 'refresh' : 'check'" :size="16" />
          {{ saving ? '保存中…' : '保存设置' }}
        </button>
      </div>

      <p v-if="testResult" class="banner" :class="testResult.ok ? 'banner-ok' : 'banner-error'">
        {{ testResult.message }}
      </p>
    </section>

    <section class="card info-card">
      <div class="card-title">
        <h2>本地数据</h2>
        <Icon name="info" :size="18" />
      </div>
      <ul class="info-list">
        <li>
          <span>数据库</span>
          <code>data/easy-english.db</code>
        </li>
        <li>
          <span>配置来源</span>
          <code>{{ store.settings?.source === 'env' ? '环境变量' : store.settings?.source === 'settings' ? '设置页' : '默认值' }}</code>
        </li>
        <li>
          <span>复习配置</span>
          <code>{{ savedReviewText || '未读取' }}</code>
        </li>
      </ul>
      <p class="hint">
        备份时复制整个 <code>data/</code> 目录即可；所有词条、对话和总结都在这一个 SQLite 文件里。
      </p>
    </section>
  </div>
</template>

<style scoped>
.settings-page {
  max-width: 760px;
}
.settings-card,
.info-card {
  padding: 26px 28px;
  display: flex;
  flex-direction: column;
  gap: 20px;
  margin-bottom: 20px;
}
.card-title {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}
.card-title h2 {
  margin: 0;
  font-size: 19px;
  font-weight: 600;
}
.card-title p {
  margin: 4px 0 0;
}
.status-pill {
  flex: 0 0 auto;
  padding: 4px 11px;
  border-radius: var(--radius-sm);
  font-size: 12px;
  font-weight: 600;
}
.status-pill.ok {
  background: var(--success-soft);
  color: var(--success);
}
.status-pill.warn {
  background: var(--warning-soft);
  color: var(--warning);
}
.presets {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}
.preset {
  padding: 8px 14px;
  border: 0;
  border-radius: var(--radius-sm);
  background: var(--bg);
  color: var(--ink-soft);
  font-size: 12.5px;
  box-shadow: var(--shadow-raised-sm);
  transition: box-shadow var(--transition), color var(--transition);
}
.preset:hover {
  box-shadow: var(--shadow-hover-sm);
  color: var(--accent-strong);
}
.preset:active {
  box-shadow: var(--shadow-pressed);
}
.check-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--ink-soft);
  font-weight: 500;
}
.actions {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  flex-wrap: wrap;
}
.theme-options {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}
.theme-option {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px;
  border: var(--border-width, 0) solid var(--border-color, transparent);
  border-radius: var(--radius);
  background: var(--bg);
  color: var(--ink-soft);
  text-align: left;
  box-shadow: var(--shadow-raised-sm);
  transition: box-shadow var(--transition), background-color var(--transition),
    border-color var(--transition), color var(--transition);
}
.theme-option:hover {
  box-shadow: var(--shadow-hover-sm);
}
.theme-option:active {
  box-shadow: var(--shadow-pressed);
}
.theme-option.active {
  box-shadow: var(--shadow-pressed);
}
.theme-option.active .theme-copy strong {
  color: var(--accent-strong);
}
.theme-copy {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.theme-copy strong {
  font-size: 14px;
  font-weight: 600;
  color: var(--ink);
}
.theme-copy small {
  font-size: 12px;
  line-height: 1.45;
  color: var(--muted);
}
.theme-swatch {
  width: 38px;
  height: 38px;
  flex: 0 0 38px;
  border-radius: var(--radius-sm);
}
.swatch-neumorphism {
  background: #e0e5ec;
  box-shadow: 4px 4px 8px #b8bcc2, -4px -4px 8px #ffffff;
}
.swatch-swiss {
  position: relative;
  overflow: hidden;
  background: #ffffff;
  border: 2px solid #000000;
  border-radius: 0;
}
.swatch-swiss::after {
  content: "";
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  width: 9px;
  background: #ff0000;
}
.theme-check {
  margin-left: auto;
  flex: 0 0 auto;
  color: var(--accent-strong);
}
@media (max-width: 620px) {
  .theme-options {
    grid-template-columns: 1fr;
  }
}
.info-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 14px;
}
.info-list li {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 16px;
  font-size: 13px;
}
.info-list span {
  color: var(--muted);
}
.info-list code {
  background: var(--bg);
  padding: 3px 9px;
  border-radius: var(--radius-sm);
  box-shadow: var(--shadow-inset-sm);
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--ink);
  overflow-wrap: anywhere;
  text-align: right;
}
</style>
