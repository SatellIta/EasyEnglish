<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import Icon from '@/components/Icon.vue'
import { api, errorMessage } from '@/lib/api'
import { useAppStore } from '@/stores/app'

const store = useAppStore()

const form = reactive({
  baseUrl: '',
  model: '',
  apiKey: '',
  clearApiKey: false,
})
const loading = ref(true)
const saving = ref(false)
const testing = ref(false)
const error = ref('')
const notice = ref('')
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
    const settings = await api.settings.get()
    form.baseUrl = settings.baseUrl
    form.model = settings.model
    form.apiKey = ''
    form.clearApiKey = false
    store.settings = settings
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

onMounted(load)
</script>

<template>
  <div class="page settings-page">
    <header class="page-head">
      <div>
        <h1>设置</h1>
        <p>接入任意 OpenAI 兼容接口，数据全部保存在本机。</p>
      </div>
    </header>

    <p v-if="error" class="banner banner-error">{{ error }}</p>
    <p v-if="notice" class="banner banner-ok">{{ notice }}</p>

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
          placeholder="gpt-4o-mini"
          :disabled="loading"
        />
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
          <span>复习算法</span>
          <code>艾宾浩斯间隔 1 / 2 / 4 / 7 / 15 / 30 / 60 / 120 / 240 天</code>
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
  border-radius: 12px;
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
  border-radius: 12px;
  box-shadow: var(--shadow-inset-sm);
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--ink);
  overflow-wrap: anywhere;
  text-align: right;
}
</style>
