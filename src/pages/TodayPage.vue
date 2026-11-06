<script setup lang="ts">
import { onMounted, ref, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import type { DailySummary, DraftEntry, Entry } from '@shared/types'
import Icon from '@/components/Icon.vue'
import MarkdownView from '@/components/MarkdownView.vue'
import SpeakButton from '@/components/SpeakButton.vue'
import TypeBadge from '@/components/TypeBadge.vue'
import { api, errorMessage } from '@/lib/api'
import {
  formatDateTime,
  formatRelativeTime,
  startOfTodayIso,
  todayLongLabel,
  truncate,
} from '@/lib/format'
import { useAppStore } from '@/stores/app'

const store = useAppStore()
const route = useRoute()
const router = useRouter()

const entries = ref<Entry[]>([])
const summary = ref<DailySummary | null>(null)
const summaryEntries = ref<DraftEntry[]>([])
const loading = ref(true)
const generating = ref(false)
const adding = ref(false)
const error = ref('')
const notice = ref('')

const dateLabel = todayLongLabel()

async function load() {
  loading.value = true
  error.value = ''
  try {
    const [list, saved] = await Promise.all([
      api.entries.list({ from: startOfTodayIso(), limit: 50 }),
      api.summary.today(),
    ])
    entries.value = list.items
    summary.value = saved.summary
    summaryEntries.value = saved.summary?.entries ?? []
    await store.refreshStats()
  } catch (caught) {
    error.value = errorMessage(caught)
  } finally {
    loading.value = false
  }
}

async function generateSummary() {
  if (generating.value) return
  generating.value = true
  error.value = ''
  notice.value = ''
  try {
    const result = await api.summary.generate()
    summary.value = {
      id: 0,
      date: result.date,
      content: result.summary,
      entries: result.entries,
      createdAt: new Date().toISOString(),
    }
    summaryEntries.value = result.entries
    notice.value = '今日总结已生成并保存。'
  } catch (caught) {
    error.value = errorMessage(caught)
  } finally {
    generating.value = false
  }
}

async function addSummaryEntries() {
  if (!summaryEntries.value.length || adding.value) return
  adding.value = true
  error.value = ''
  try {
    const result = await api.entries.bulkCreate(
      summaryEntries.value.map((entry) => ({
        type: entry.type,
        text: entry.text,
        meaning: entry.meaning ?? null,
        explanation: entry.explanation ?? null,
        source: 'summary',
      })),
    )
    notice.value = `已加入词库 ${result.count} 条，并进入复习队列。`
    summaryEntries.value = []
    await load()
  } catch (caught) {
    error.value = errorMessage(caught)
  } finally {
    adding.value = false
  }
}

async function handleSummarizeQuery() {
  if (route.query.summarize !== '1') return
  await router.replace({ query: {} })
  await generateSummary()
}

onMounted(async () => {
  await load()
  await handleSummarizeQuery()
})

watch(
  () => route.query.summarize,
  () => {
    if (route.query.summarize === '1') handleSummarizeQuery()
  },
)
</script>

<template>
  <div class="page">
    <header class="page-head">
      <div>
        <p class="eyebrow">{{ dateLabel }}</p>
        <h1>今天学点什么？</h1>
        <p>把遇到的词句记下来，剩下的交给遗忘曲线和 AI。</p>
      </div>
      <button class="btn btn-ghost" :disabled="loading" @click="load">
        <Icon name="refresh" :size="16" /> 刷新
      </button>
    </header>

    <p v-if="error" class="banner banner-error">{{ error }}</p>
    <p v-if="notice" class="banner banner-ok">{{ notice }}</p>

    <section class="hero">
      <div class="hero-copy">
        <p class="hero-kicker">今日复习</p>
        <h2 v-if="store.dueTotal > 0">有 {{ store.dueTotal }} 个词句等你回忆</h2>
        <h2 v-else>今天的复习已经清空</h2>
        <p>
          {{ store.stats?.due.word ?? 0 }} 个单词 · {{ store.stats?.due.phrase ?? 0 }} 个短语 ·
          {{ store.stats?.due.sentence ?? 0 }} 个句子
        </p>
      </div>
      <div class="hero-actions">
        <RouterLink to="/review" class="btn btn-light">
          <Icon name="review" :size="16" /> 开始复习
        </RouterLink>
        <RouterLink to="/chat" class="btn btn-hero-ghost">
          <Icon name="chat" :size="16" /> 问 AI
        </RouterLink>
      </div>
    </section>

    <section class="stat-grid">
      <div class="stat">
        <span class="stat-icon"><Icon name="clock" :size="17" /></span>
        <strong>{{ store.dueTotal }}</strong>
        <span>待复习</span>
      </div>
      <div class="stat">
        <span class="stat-icon"><Icon name="check" :size="17" /></span>
        <strong>{{ store.stats?.reviewedToday ?? 0 }}</strong>
        <span>今日已复习</span>
      </div>
      <div class="stat">
        <span class="stat-icon"><Icon name="plus" :size="17" /></span>
        <strong>{{ store.stats?.addedToday ?? 0 }}</strong>
        <span>今日新增</span>
      </div>
      <div class="stat">
        <span class="stat-icon"><Icon name="flame" :size="17" /></span>
        <strong>{{ store.stats?.streakDays ?? 0 }}</strong>
        <span>连续复习天数</span>
      </div>
    </section>

    <div class="today-grid">
      <section class="card panel">
        <header class="panel-head">
          <h2>今日词句</h2>
          <RouterLink to="/library" class="link">
            全部词库 <Icon name="arrow-right" :size="14" />
          </RouterLink>
        </header>

        <p v-if="loading" class="empty">加载中…</p>
        <div v-else-if="!entries.length" class="empty">
          <h3>今天还没有记录</h3>
          <p>在对话里问 AI，或直接把遇到的表达添加进来。</p>
          <RouterLink to="/chat" class="btn btn-soft">去和 AI 聊聊</RouterLink>
        </div>
        <ul v-else class="entry-list">
          <li v-for="entry in entries" :key="entry.id" class="entry-row">
            <div class="entry-main">
              <div class="row wrap">
                <TypeBadge :type="entry.type" />
                <span class="entry-text">{{ entry.text }}</span>
                <SpeakButton :text="entry.text" />
              </div>
              <p v-if="entry.meaning" class="entry-meaning">{{ truncate(entry.meaning, 100) }}</p>
            </div>
            <span class="entry-time">{{ formatRelativeTime(entry.createdAt) }}</span>
          </li>
        </ul>
      </section>

      <section class="card panel">
        <header class="panel-head">
          <h2>今日总结</h2>
          <button
            v-if="summary"
            class="btn btn-soft btn-sm"
            :disabled="generating"
            @click="generateSummary"
          >
            <Icon :name="generating ? 'refresh' : 'sparkles'" :size="15" />
            {{ generating ? '整理中…' : '重新整理' }}
          </button>
        </header>

        <div v-if="generating && !summary" class="empty">
          <p>AI 正在阅读今天的对话和词条…</p>
        </div>
        <div v-else-if="!summary" class="empty">
          <h3>让 AI 帮你收个尾</h3>
          <p>把今天聊过的内容整理成可复习的总结，并提取值得记住的词句。</p>
          <button class="btn btn-primary" @click="generateSummary">
            <Icon name="sparkles" :size="16" /> 生成今日总结
          </button>
        </div>
        <template v-else>
          <MarkdownView :content="summary.content" />

          <div v-if="summaryEntries.length" class="suggested">
            <div class="row between wrap">
              <strong>值得加入词库</strong>
              <button class="btn btn-soft btn-sm" :disabled="adding" @click="addSummaryEntries">
                <Icon name="plus" :size="15" />
                {{ adding ? '添加中…' : `全部加入（${summaryEntries.length}）` }}
              </button>
            </div>
            <ul>
              <li v-for="(entry, index) in summaryEntries" :key="index">
                <TypeBadge :type="entry.type" />
                <span class="entry-text">{{ entry.text }}</span>
                <span v-if="entry.meaning" class="muted small">{{ entry.meaning }}</span>
              </li>
            </ul>
          </div>

          <p class="small muted summary-time">更新于 {{ formatDateTime(summary.createdAt) }}</p>
        </template>
      </section>
    </div>
  </div>
</template>

<style scoped>
.hero {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  flex-wrap: wrap;
  padding: 24px 28px;
  margin-bottom: 14px;
  border-radius: var(--radius-lg);
  background: linear-gradient(135deg, #2f6b56, #47846d);
  color: #fff;
  box-shadow: 0 18px 40px -24px rgba(47, 107, 86, 0.8);
}
.hero-kicker {
  margin: 0 0 6px;
  font-size: 12px;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  opacity: 0.75;
}
.hero h2 {
  margin: 0 0 6px;
  font-family: var(--font-serif);
  font-size: clamp(22px, 3vw, 28px);
  letter-spacing: -0.01em;
}
.hero p {
  margin: 0;
  opacity: 0.82;
  font-size: 13px;
}
.hero-actions {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}
.stat-grid {
  margin-bottom: 18px;
}
.stat {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 15px 17px;
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 16px;
}
.stat-icon {
  color: var(--primary);
  margin-bottom: 4px;
}
.stat strong {
  font-family: var(--font-serif);
  font-size: 26px;
  line-height: 1.15;
}
.stat > span:last-child {
  font-size: 12px;
  color: var(--muted);
}
.today-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.05fr) minmax(0, 0.95fr);
  gap: 16px;
  align-items: start;
}
.panel {
  padding: 20px 22px;
}
.panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
}
.panel-head h2 {
  margin: 0;
  font-family: var(--font-serif);
  font-size: 18px;
}
.entry-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
}
.entry-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 0;
  border-top: 1px solid var(--border);
}
.entry-row:first-child {
  border-top: 0;
  padding-top: 0;
}
.entry-main {
  min-width: 0;
}
.entry-text {
  font-weight: 600;
  overflow-wrap: anywhere;
}
.entry-meaning {
  margin: 4px 0 0;
  color: var(--muted);
  font-size: 13px;
  overflow-wrap: anywhere;
}
.entry-time {
  flex: 0 0 auto;
  font-size: 11px;
  color: var(--muted);
}
.suggested {
  margin-top: 18px;
  padding-top: 16px;
  border-top: 1px solid var(--border);
}
.suggested ul {
  list-style: none;
  margin: 10px 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.suggested li {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  font-size: 13px;
}
.summary-time {
  margin: 16px 0 0;
}
@media (max-width: 860px) {
  .today-grid {
    grid-template-columns: 1fr;
  }
}
</style>
