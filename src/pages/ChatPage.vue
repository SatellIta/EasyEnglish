<script setup lang="ts">
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import type { ChatMessage, ChatSession } from '@shared/types'
import Icon from '@/components/Icon.vue'
import MarkdownView from '@/components/MarkdownView.vue'
import { api, errorMessage, streamChat } from '@/lib/api'
import { formatRelativeTime, truncate } from '@/lib/format'
import { useAppStore } from '@/stores/app'
import { useSummaryStore } from '@/stores/summary'

const store = useAppStore()
const summaryStore = useSummaryStore()
const route = useRoute()
const router = useRouter()

const sessions = ref<ChatSession[]>([])
const activeSessionId = ref<number | null>(null)
const messages = ref<ChatMessage[]>([])
const input = ref('')
const streaming = ref(false)
const streamContent = ref('')
const loadingMessages = ref(false)
const error = ref('')
const showSessions = ref(false)
const composing = ref(false)
const messageList = ref<HTMLElement | null>(null)
let controller: AbortController | null = null

const suggestions = [
  'affect 和 effect 到底怎么区分？',
  '用简单英语解释：The ball is in your court.',
  '给我 5 个和 travel 有关的自然搭配',
  'in / on / at 表地点时怎么选？',
]

const activeTitle = computed(() => {
  if (!activeSessionId.value) return '新对话'
  const session = sessions.value.find((item) => item.id === activeSessionId.value)
  return session?.title || '新对话'
})

const composerPlaceholder = computed(() =>
  streaming.value ? 'AI 正在回答…' : '问一个英语问题，或把不认识的句子贴进来…',
)

const organizing = computed(() => summaryStore.running)

async function organizeToday() {
  error.value = ''
  const result = await summaryStore.generate()
  if (!result && summaryStore.error) error.value = summaryStore.error
}

async function loadSessions() {
  try {
    sessions.value = (await api.chat.sessions()).items
  } catch (caught) {
    error.value = errorMessage(caught)
  }
}

async function openSession(id: number) {
  activeSessionId.value = id
  showSessions.value = false
  loadingMessages.value = true
  error.value = ''
  try {
    messages.value = (await api.chat.messages(id)).items
    await scrollToBottom()
  } catch (caught) {
    error.value = errorMessage(caught)
  } finally {
    loadingMessages.value = false
  }
}

function selectSession(id: number) {
  if (id === activeSessionId.value) {
    showSessions.value = false
    return
  }
  router.push(`/chat/${id}`)
}

function newChat() {
  activeSessionId.value = null
  messages.value = []
  input.value = ''
  error.value = ''
  showSessions.value = false
  if (route.params.id) router.push('/chat')
}

async function removeSession(id: number) {
  if (!window.confirm('删除这个对话？此操作不可恢复。')) return
  try {
    await api.chat.removeSession(id)
    if (activeSessionId.value === id) newChat()
    await loadSessions()
  } catch (caught) {
    error.value = errorMessage(caught)
  }
}

async function scrollToBottom() {
  await nextTick()
  if (messageList.value) messageList.value.scrollTop = messageList.value.scrollHeight
}

async function send() {
  const text = input.value.trim()
  if (!text || streaming.value) return

  input.value = ''
  error.value = ''
  showSessions.value = false

  messages.value.push({
    id: -Date.now(),
    sessionId: activeSessionId.value ?? 0,
    role: 'user',
    content: text,
    createdAt: new Date().toISOString(),
  })

  const assistant = reactive<ChatMessage>({
    id: -1,
    sessionId: activeSessionId.value ?? 0,
    role: 'assistant',
    content: '',
    createdAt: new Date().toISOString(),
  })
  messages.value.push(assistant)

  streaming.value = true
  streamContent.value = ''
  controller = new AbortController()
  await scrollToBottom()

  try {
    await streamChat(
      { sessionId: activeSessionId.value ?? undefined, message: text },
      {
        onMeta: (meta) => {
          activeSessionId.value = meta.sessionId
          assistant.sessionId = meta.sessionId
          if (route.params.id !== String(meta.sessionId)) {
            router.replace(`/chat/${meta.sessionId}`)
          }
          loadSessions()
        },
        onDelta: (delta) => {
          streamContent.value += delta
          assistant.content = streamContent.value
          scrollToBottom()
        },
        onDone: (done) => {
          assistant.id = done.messageId
          streaming.value = false
          loadSessions()
          scrollToBottom()
          store.refreshStats().catch(() => {})
        },
        onError: (message) => {
          error.value = message
          streaming.value = false
          if (!assistant.content) assistant.content = '（回答中断）'
        },
      },
      controller.signal,
    )
  } catch (caught) {
    if ((caught as Error)?.name !== 'AbortError') {
      error.value = errorMessage(caught)
    }
    if (!assistant.content) {
      messages.value = messages.value.filter((message) => message !== assistant)
    }
  } finally {
    streaming.value = false
    controller = null
    await scrollToBottom()
  }
}

function stop() {
  controller?.abort()
}

function onComposerEnter(event: KeyboardEvent) {
  // 中文输入法选词时按 Enter 不应该发送消息
  if (event.shiftKey || composing.value || event.isComposing) return
  event.preventDefault()
  send()
}

watch(
  () => route.params.id,
  (value) => {
    const id = value ? Number(value) : null
    if (id === activeSessionId.value) return
    if (id) openSession(id)
    else {
      activeSessionId.value = null
      messages.value = []
    }
  },
)

onMounted(async () => {
  await Promise.all([loadSessions(), store.refreshStats().catch(() => {})])
  const id = route.params.id ? Number(route.params.id) : null
  if (id) await openSession(id)
})
</script>

<template>
  <div class="page chat-page">
    <header class="chat-head">
      <div class="row chat-title-row">
        <button
          class="icon-btn chat-menu-btn"
          type="button"
          title="显示对话列表"
          aria-label="显示对话列表"
          @click="showSessions = !showSessions"
        >
          <Icon name="menu" :size="19" />
        </button>
        <div class="chat-title-copy">
          <h1>{{ activeTitle }}</h1>
          <p class="muted small">
            {{ store.totalEntries }} 条词句记忆 · AI 会参考你学过的内容
          </p>
        </div>
      </div>
      <button
        class="btn btn-soft btn-sm"
        type="button"
        :disabled="organizing"
        @click="organizeToday"
      >
        <Icon :name="organizing ? 'refresh' : 'sparkles'" :size="15" />
        {{ organizing ? '整理中…' : '整理今天' }}
      </button>
    </header>

    <p v-if="error" class="banner banner-error">{{ error }}</p>

    <div class="chat-layout">
      <aside class="sessions card" :class="{ open: showSessions }">
        <div class="sessions-head">
          <strong>对话</strong>
          <button class="btn btn-soft btn-sm" @click="newChat">
            <Icon name="plus" :size="15" /> 新对话
          </button>
        </div>

        <ul v-if="sessions.length" class="session-list">
          <li
            v-for="session in sessions"
            :key="session.id"
            class="session-item"
            :class="{ active: session.id === activeSessionId }"
          >
            <button class="session-button" @click="selectSession(session.id)">
              <span class="session-title">{{ session.title || '新对话' }}</span>
              <span v-if="session.preview" class="session-preview">
                {{ truncate(session.preview, 42) }}
              </span>
              <span class="session-meta">
                {{ session.messageCount }} 条 · {{ formatRelativeTime(session.updatedAt) }}
              </span>
            </button>
            <button
              class="icon-btn session-delete"
              title="删除对话"
              aria-label="删除对话"
              @click.stop="removeSession(session.id)"
            >
              <Icon name="trash" :size="15" />
            </button>
          </li>
        </ul>
        <p v-else class="empty small">还没有对话</p>
      </aside>

      <section class="conversation card">
        <div ref="messageList" class="messages">
          <div v-if="loadingMessages" class="empty">正在加载对话…</div>

          <div v-else-if="!messages.length" class="chat-welcome">
            <div class="welcome-mark"><Icon name="sparkles" :size="26" /></div>
            <h2>开箱即用的英语助手</h2>
            <p>
              可以问词义、辨析、语法和地道表达。AI 会参考你记录过的
              {{ store.totalEntries }} 条词句，在学习时帮你联想复习。
            </p>
            <div class="suggestions">
              <button
                v-for="suggestion in suggestions"
                :key="suggestion"
                class="suggestion"
                @click="input = suggestion; send()"
              >
                {{ suggestion }}
              </button>
            </div>
            <p v-if="store.settings && !store.settings.configured" class="banner banner-info">
              AI 还没配置。去
              <RouterLink to="/settings" class="link">设置</RouterLink>
              填写模型和 API Key。
            </p>
          </div>

          <div
            v-for="message in messages"
            :key="message.id"
            class="message"
            :class="message.role"
          >
            <div class="message-role">{{ message.role === 'user' ? '你' : 'EasyEnglish' }}</div>
            <div class="message-bubble">
              <MarkdownView v-if="message.role === 'assistant'" :content="message.content || '…'" />
              <p v-else class="user-text">{{ message.content }}</p>
              <span
                v-if="streaming && message.role === 'assistant' && message === messages[messages.length - 1]"
                class="cursor"
              />
            </div>
          </div>
        </div>

        <div class="composer">
          <textarea
            v-model="input"
            class="composer-input"
            rows="2"
            aria-label="输入英语问题"
            :placeholder="composerPlaceholder"
            @compositionstart="composing = true"
            @compositionend="composing = false"
            @keydown.enter="onComposerEnter"
          />
          <div class="composer-actions">
            <span class="hint">Enter 发送 · Shift+Enter 换行</span>
            <div class="row">
              <button v-if="streaming" class="btn btn-ghost btn-sm" @click="stop">
                <Icon name="stop" :size="15" /> 停止
              </button>
              <button
                class="btn btn-primary btn-sm"
                :disabled="!input.trim() || streaming"
                @click="send"
              >
                <Icon name="send" :size="15" /> 发送
              </button>
            </div>
          </div>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.chat-page {
  display: flex;
  flex-direction: column;
  height: calc(100vh - 100px);
  min-height: 520px;
}
.chat-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 16px;
}
.chat-title-row {
  flex: 1;
  min-width: 0;
}
.chat-title-copy {
  min-width: 0;
}
.chat-head h1 {
  margin: 0;
  font-size: 24px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.chat-head p {
  margin: 3px 0 0;
}
.chat-menu-btn {
  display: none;
}
.chat-layout {
  flex: 1;
  min-height: 0;
  display: grid;
  grid-template-columns: 250px minmax(0, 1fr);
  gap: 20px;
}
.sessions {
  display: flex;
  flex-direction: column;
  min-height: 0;
  padding: 16px;
}
.sessions-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 12px;
}
.session-list {
  list-style: none;
  margin: 0;
  padding: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.session-item {
  display: flex;
  align-items: flex-start;
  gap: 2px;
  border-radius: var(--radius-sm);
  transition: box-shadow var(--transition);
}
.session-item:hover .session-title {
  color: var(--accent-strong);
}
.session-item.active {
  box-shadow: var(--shadow-pressed);
}
.session-button {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 10px 11px;
  border: 0;
  background: transparent;
  text-align: left;
}
.session-title {
  font-weight: 600;
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.session-preview,
.session-meta {
  font-size: 11px;
  color: var(--muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.session-delete {
  width: 28px;
  height: 28px;
  margin-top: 5px;
  opacity: 0;
  box-shadow: none;
}
.session-item:hover .session-delete {
  opacity: 1;
}
.session-delete:focus-visible {
  opacity: 1;
}
.conversation {
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}
.messages {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 24px clamp(16px, 3vw, 30px);
  display: flex;
  flex-direction: column;
  gap: 22px;
}
.chat-welcome {
  max-width: 620px;
  margin: auto;
  text-align: center;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 24px 8px;
}
.welcome-mark {
  width: 56px;
  height: 56px;
  border-radius: var(--radius);
  display: grid;
  place-items: center;
  color: var(--accent-strong);
  background: var(--accent-soft);
  box-shadow: var(--shadow-inset-sm);
}
.chat-welcome h2 {
  margin: 4px 0 0;
  font-size: 24px;
  font-weight: 600;
}
.chat-welcome p {
  margin: 0;
  color: var(--muted);
  font-size: 14px;
  line-height: 1.7;
}
.suggestions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 10px;
  margin-top: 8px;
}
.suggestion {
  padding: 9px 14px;
  border: 0;
  border-radius: var(--radius-sm);
  background: var(--bg);
  color: var(--ink-soft);
  font-size: 12.5px;
  box-shadow: var(--shadow-raised-sm);
  transition: box-shadow var(--transition), color var(--transition);
}
.suggestion:hover {
  box-shadow: var(--shadow-hover-sm);
  color: var(--accent-strong);
}
.suggestion:active {
  box-shadow: var(--shadow-pressed);
}
.message {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-width: min(760px, 92%);
}
.message.user {
  align-self: flex-end;
  align-items: flex-end;
}
.message.assistant {
  align-self: flex-start;
}
.message-role {
  font-size: 11px;
  font-weight: 600;
  color: var(--muted);
  padding: 0 5px;
}
.message-bubble {
  padding: 13px 17px;
  border-radius: var(--radius);
  background: var(--bg);
  box-shadow: var(--shadow-inset-sm);
}
.message.user .message-bubble {
  background: var(--accent-soft);
  color: #3b327f;
  box-shadow: var(--shadow-inset-sm);
}
.message.assistant .message-bubble {
  width: 100%;
}
.user-text {
  margin: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-size: 14.5px;
  line-height: 1.65;
  color: #3b327f;
}
.cursor {
  display: inline-block;
  width: 7px;
  height: 15px;
  margin-left: 3px;
  border-radius: var(--radius-sm);
  background: var(--accent);
  animation: blink 1s steps(1) infinite;
  vertical-align: -2px;
}
@keyframes blink {
  50% {
    opacity: 0;
  }
}
.composer {
  padding: 14px clamp(16px, 3vw, 30px) 18px;
  background: var(--bg);
}
.composer-input {
  resize: none;
  min-height: 64px;
  line-height: 1.55;
}
.composer-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-top: 10px;
}
@media (max-width: 900px) {
  .chat-page {
    height: calc(100vh - 146px);
    height: calc(100dvh - 146px);
    min-height: 460px;
  }
  .chat-title-copy p {
    display: none;
  }
  .chat-menu-btn {
    display: inline-grid;
  }
  .chat-layout {
    grid-template-columns: 1fr;
    position: relative;
    gap: 16px;
  }
  .sessions {
    display: none;
    position: absolute;
    z-index: 20;
    top: 0;
    left: 0;
    width: min(300px, 86vw);
    max-height: 70vh;
    box-shadow: var(--shadow-raised-lg);
    background: var(--bg);
  }
  .sessions.open {
    display: flex;
  }
  .session-delete {
    opacity: 0.55;
  }
  .conversation {
    min-height: 0;
  }
  .message {
    max-width: 100%;
  }
}
</style>
