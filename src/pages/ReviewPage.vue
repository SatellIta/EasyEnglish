<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import type { Entry, EntryType } from '@shared/types'
import { ENTRY_TYPE_LABELS } from '@shared/types'
import Icon from '@/components/Icon.vue'
import SpeakButton from '@/components/SpeakButton.vue'
import TypeBadge from '@/components/TypeBadge.vue'
import { api, errorMessage } from '@/lib/api'
import { stageLabel } from '@/lib/format'
import { useAppStore } from '@/stores/app'

type Phase = 'setup' | 'session' | 'done'

const store = useAppStore()
const router = useRouter()

const phase = ref<Phase>('setup')
const selectedTypes = ref<EntryType[]>(['word', 'phrase', 'sentence'])
const queue = ref<Entry[]>([])
const index = ref(0)
const revealed = ref(false)
const remembered = ref(0)
const forgot = ref(0)
const loading = ref(false)
const error = ref('')
const retryMinutes = ref(10)

const allTypes: EntryType[] = ['word', 'phrase', 'sentence']
const current = computed(() => queue.value[index.value] ?? null)
const progress = computed(() =>
  queue.value.length ? Math.round((index.value / queue.value.length) * 100) : 0,
)

function dueCount(type: EntryType): number {
  return store.stats?.due[type] ?? 0
}

function toggleType(type: EntryType) {
  if (selectedTypes.value.includes(type)) {
    if (selectedTypes.value.length === 1) return
    selectedTypes.value = selectedTypes.value.filter((item) => item !== type)
  } else {
    selectedTypes.value = [...selectedTypes.value, type]
  }
}

async function start() {
  loading.value = true
  error.value = ''
  phase.value = 'setup'
  try {
    const result = await api.review.queue(selectedTypes.value, 200)
    queue.value = result.items
    index.value = 0
    remembered.value = 0
    forgot.value = 0
    revealed.value = false
    if (!queue.value.length) {
      error.value = '当前筛选下没有到期的复习内容。可以先去词库添加，或者稍后再来。'
      return
    }
    phase.value = 'session'
  } catch (caught) {
    error.value = errorMessage(caught)
  } finally {
    loading.value = false
  }
}

async function rate(rating: 'remembered' | 'forgot') {
  const entry = current.value
  if (!entry || loading.value || revealed.value) return

  loading.value = true
  error.value = ''
  try {
    await api.review.rate(entry.id, rating)
    if (rating === 'remembered') {
      remembered.value += 1
      advance()
    } else {
      forgot.value += 1
      revealed.value = true
    }
    store.refreshStats().catch(() => {})
  } catch (caught) {
    error.value = errorMessage(caught)
  } finally {
    loading.value = false
  }
}

function advance() {
  revealed.value = false
  if (index.value + 1 >= queue.value.length) {
    phase.value = 'done'
  } else {
    index.value += 1
  }
}

function exit() {
  phase.value = 'setup'
  queue.value = []
  index.value = 0
  revealed.value = false
  store.refreshStats().catch(() => {})
}

function onKeydown(event: KeyboardEvent) {
  if (phase.value !== 'session' || loading.value) return
  const key = event.key.toLowerCase()

  if (!revealed.value) {
    if (event.key === '1' || key === 'j') {
      event.preventDefault()
      rate('remembered')
    } else if (event.key === '2' || key === 'k') {
      event.preventDefault()
      rate('forgot')
    }
  } else if (event.key === ' ' || event.key === 'Enter') {
    event.preventDefault()
    advance()
  }
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown)
  if (!store.stats) store.refreshStats().catch(() => {})
  api.settings
    .review()
    .then((config) => {
      retryMinutes.value = config.forgotRetryMinutes
    })
    .catch(() => {})
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
})
</script>

<template>
  <div class="page">
    <header class="page-head">
      <div>
        <h1>复习</h1>
        <p>先看英文，主动回忆。记得就跳过，不记得再展开答案。</p>
      </div>
    </header>

    <p v-if="error" class="banner banner-error">{{ error }}</p>

    <template v-if="phase === 'setup'">
      <section class="card setup-card">
        <h2>选择要复习的类型</h2>
        <div class="type-filters">
          <button
            v-for="type in allTypes"
            :key="type"
            class="filter-chip"
            :class="{ active: selectedTypes.includes(type) }"
            :aria-pressed="selectedTypes.includes(type)"
            @click="toggleType(type)"
          >
            <span>{{ ENTRY_TYPE_LABELS[type] }}</span>
            <strong>{{ dueCount(type) }}</strong>
          </button>
        </div>

        <div class="setup-summary">
          <div>
            <strong>{{ store.dueTotal }}</strong>
            <span>当前到期</span>
          </div>
          <div>
            <strong>{{ store.stats?.reviewedToday ?? 0 }}</strong>
            <span>今日已复习</span>
          </div>
          <div>
            <strong>{{ store.stats?.streakDays ?? 0 }}</strong>
            <span>连续天数</span>
          </div>
        </div>

        <button
          class="btn btn-primary btn-lg"
          :disabled="loading || !selectedTypes.length"
          @click="start"
        >
          <Icon :name="loading ? 'refresh' : 'review'" :size="18" />
          {{ loading ? '加载中…' : '开始复习' }}
        </button>
        <p class="hint">进入复习后：按 1 表示记得，按 2 表示不记得；展开答案后按空格继续。</p>
      </section>
    </template>

    <template v-else-if="phase === 'session' && current">
      <div class="review-bar">
        <button class="btn btn-ghost btn-sm" @click="exit">
          <Icon name="chevron-left" :size="15" /> 退出
        </button>
        <div class="progress-track">
          <div class="progress-fill" :style="{ width: `${progress}%` }" />
        </div>
        <span class="muted small">{{ index + 1 }} / {{ queue.length }}</span>
      </div>

      <section class="review-card card" :class="{ revealed }">
        <div class="review-meta">
          <TypeBadge :type="current.type" />
          <span class="muted small">{{ stageLabel(current.review?.stage ?? 0) }}</span>
          <SpeakButton :text="current.text" :size="20" />
        </div>

        <p class="review-text" :class="{ sentence: current.type === 'sentence' }">
          {{ current.text }}
        </p>

        <template v-if="!revealed">
          <p class="recall-prompt">你记得它的意思吗？</p>
          <div class="recall-actions">
            <button class="btn btn-primary btn-lg" :disabled="loading" @click="rate('remembered')">
              <Icon name="check" :size="18" /> 记得
            </button>
            <button class="btn btn-ghost btn-lg" :disabled="loading" @click="rate('forgot')">
              <Icon name="refresh" :size="18" /> 不记得
            </button>
          </div>
        </template>

        <template v-else>
          <div class="reveal">
            <div v-if="current.meaning" class="reveal-block">
              <h3>含义</h3>
              <p>{{ current.meaning }}</p>
            </div>
            <div v-if="current.explanation" class="reveal-block">
              <h3>解释与用法</h3>
              <p class="pre-wrap">{{ current.explanation }}</p>
            </div>
            <div v-if="current.examples.length" class="reveal-block">
              <h3>例句</h3>
              <ul>
                <li v-for="(example, exampleIndex) in current.examples" :key="exampleIndex">
                  {{ example }}
                </li>
              </ul>
            </div>
            <div v-if="current.notes" class="reveal-block">
              <h3>我的笔记</h3>
              <p class="pre-wrap">{{ current.notes }}</p>
            </div>
            <div v-if="current.tags.length" class="reveal-tags">
              <span v-for="tag in current.tags" :key="tag" class="tag">{{ tag }}</span>
            </div>
          </div>

          <button class="btn btn-primary btn-lg" :disabled="loading" @click="advance">
            继续 <Icon name="arrow-right" :size="18" />
          </button>
          <p class="hint">按空格继续 · 这个词条会在 {{ retryMinutes }} 分钟后再次出现</p>
        </template>
      </section>

      <div class="review-stats">
        <span class="ok">记得 {{ remembered }}</span>
        <span class="bad">不记得 {{ forgot }}</span>
      </div>
    </template>

    <template v-else-if="phase === 'done'">
      <section class="card done-card">
        <div class="done-mark"><Icon name="check" :size="30" /></div>
        <h2>这一轮复习完成</h2>
        <p class="muted">
          共 {{ queue.length }} 条 · 记得 {{ remembered }} · 不记得 {{ forgot }}
        </p>
        <div class="done-actions">
          <button class="btn btn-primary" @click="start">再来一轮</button>
          <button class="btn btn-ghost" @click="router.push('/today')">回到今日</button>
        </div>
      </section>
    </template>
  </div>
</template>

<style scoped>
.setup-card {
  max-width: 720px;
  padding: 28px;
  display: flex;
  flex-direction: column;
  gap: 22px;
}
.setup-card h2 {
  margin: 0;
  font-size: 20px;
  font-weight: 600;
}
.type-filters {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
}
.filter-chip {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 14px 16px;
  border: 0;
  border-radius: var(--radius-sm);
  background: var(--bg);
  color: var(--ink-soft);
  box-shadow: var(--shadow-raised-sm);
  transition: box-shadow var(--transition), color var(--transition);
}
.filter-chip:hover {
  box-shadow: var(--shadow-hover-sm);
}
.filter-chip:active {
  box-shadow: var(--shadow-pressed);
}
.filter-chip strong {
  font-size: 19px;
  font-weight: 600;
  color: var(--ink);
}
.filter-chip.active {
  box-shadow: var(--shadow-pressed);
  color: var(--accent-strong);
}
.filter-chip.active strong {
  color: var(--accent-strong);
}
.setup-summary {
  display: flex;
  gap: 34px;
  padding: 4px 0;
}
.setup-summary div {
  display: flex;
  flex-direction: column;
}
.setup-summary strong {
  font-size: 24px;
  font-weight: 600;
  color: var(--ink);
}
.setup-summary span {
  font-size: 12px;
  color: var(--muted);
}
.review-bar {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-bottom: 18px;
}
.progress-track {
  flex: 1;
  height: 10px;
  border-radius: var(--radius-sm);
  background: var(--bg);
  box-shadow: var(--shadow-inset-sm);
  overflow: hidden;
}
.progress-fill {
  height: 100%;
  border-radius: var(--radius-sm);
  background: var(--accent);
  transition: width var(--transition);
}
.review-card {
  max-width: 760px;
  margin: 0 auto;
  padding: clamp(24px, 4vw, 40px);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 24px;
  text-align: center;
}
.review-meta {
  display: flex;
  align-items: center;
  gap: 10px;
}
.review-text {
  margin: 0;
  font-size: clamp(32px, 6vw, 52px);
  font-weight: 600;
  line-height: 1.2;
  letter-spacing: -0.02em;
  color: var(--ink);
  overflow-wrap: anywhere;
}
.review-text.sentence {
  font-size: clamp(23px, 4.4vw, 36px);
  line-height: 1.4;
  font-weight: 500;
}
.recall-prompt {
  margin: 0;
  color: var(--muted);
  font-size: 14px;
}
.recall-actions {
  display: flex;
  gap: 14px;
  flex-wrap: wrap;
  justify-content: center;
}
.reveal {
  width: 100%;
  display: flex;
  flex-direction: column;
  gap: 20px;
  text-align: left;
  padding-top: 8px;
}
.reveal-block h3 {
  margin: 0 0 6px;
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0;
  text-transform: none;
  color: var(--muted);
}
.reveal-block p {
  margin: 0;
  font-size: 15px;
  line-height: 1.7;
  color: var(--ink-soft);
}
.reveal-block ul {
  margin: 0;
  padding-left: 1.2em;
  font-size: 14.5px;
  line-height: 1.7;
  color: var(--ink-soft);
}
.reveal-block li + li {
  margin-top: 4px;
}
.reveal-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
.review-stats {
  display: flex;
  justify-content: center;
  gap: 20px;
  margin-top: 20px;
  font-size: 13px;
  font-weight: 600;
}
.review-stats .ok {
  color: var(--success);
}
.review-stats .bad {
  color: var(--warning);
}
.done-card {
  max-width: 520px;
  margin: 40px auto;
  padding: 36px;
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
}
.done-mark {
  width: 64px;
  height: 64px;
  border-radius: var(--radius);
  display: grid;
  place-items: center;
  background: var(--accent-soft);
  color: var(--accent-strong);
  box-shadow: var(--shadow-inset-sm);
}
.done-card h2 {
  margin: 6px 0 0;
  font-size: 24px;
  font-weight: 600;
}
.done-card p {
  margin: 0;
}
.done-actions {
  display: flex;
  gap: 12px;
  margin-top: 16px;
  flex-wrap: wrap;
  justify-content: center;
}
.pre-wrap {
  white-space: pre-wrap;
}
@media (max-width: 620px) {
  .type-filters {
    grid-template-columns: 1fr;
  }
  .setup-summary {
    gap: 22px;
  }
}
</style>
