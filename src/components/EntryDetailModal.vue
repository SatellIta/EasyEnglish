<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { AiWordExplanation, Entry } from '@shared/types'
import BaseModal from '@/components/BaseModal.vue'
import ClickableText from '@/components/ClickableText.vue'
import EntryDetails from '@/components/EntryDetails.vue'
import Icon from '@/components/Icon.vue'
import SpeakButton from '@/components/SpeakButton.vue'
import TypeBadge from '@/components/TypeBadge.vue'
import { ApiError, api } from '@/lib/api'
import { localizeServerError, t } from '@/i18n'

const props = defineProps<{ entry: Entry | null }>()

const emit = defineEmits<{
  close: []
  edit: [entry: Entry]
  created: [entry: Entry]
}>()

interface WordView {
  text: string
  entry: Entry | null
  loading: boolean
  error: string | null
}

const selectedWord = ref<string | null>(null)
const wordView = ref<WordView | null>(null)
const ai = ref<{
  loading: boolean
  error: string | null
  draft: AiWordExplanation | null
}>({ loading: false, error: null, draft: null })
const adding = ref(false)
const addError = ref<string | null>(null)

/** 防止快速连点不同单词时，旧请求覆盖新结果。 */
let lookupToken = 0

const title = computed(() =>
  wordView.value ? t('lookup.title') : t('library.detail.title'),
)

function resetWordState() {
  lookupToken += 1
  selectedWord.value = null
  wordView.value = null
  ai.value = { loading: false, error: null, draft: null }
  addError.value = null
}

watch(
  () => props.entry?.id,
  () => resetWordState(),
)

function selectWord(word: string) {
  selectedWord.value = word
}

async function openWord(word: string) {
  selectedWord.value = word
  ai.value = { loading: false, error: null, draft: null }
  addError.value = null
  const token = (lookupToken += 1)
  wordView.value = { text: word, entry: null, loading: true, error: null }

  try {
    const result = await api.entries.lookup(word)
    if (token !== lookupToken) return
    wordView.value = { text: word, entry: result.entry, loading: false, error: null }
  } catch (error) {
    if (token !== lookupToken) return
    wordView.value = {
      text: word,
      entry: null,
      loading: false,
      error: localizeServerError(error instanceof Error ? error.message : String(error)),
    }
  }
}

function backToEntry() {
  resetWordState()
}

async function askAi() {
  if (!wordView.value || ai.value.loading) return
  const word = wordView.value.text
  ai.value = { loading: true, error: null, draft: null }
  try {
    const result = await api.entries.explain(word)
    ai.value = { loading: false, error: null, draft: result.draft }
  } catch (error) {
    ai.value = {
      loading: false,
      error: localizeServerError(error instanceof Error ? error.message : String(error)),
      draft: null,
    }
  }
}

async function addToLibrary() {
  const draft = ai.value.draft
  if (!draft || !wordView.value || adding.value) return
  const word = wordView.value.text
  adding.value = true
  addError.value = null
  try {
    const created = await api.entries.create({
      type: 'word',
      text: word,
      meaning: draft.meaning,
      englishDefinition: draft.englishDefinition,
      explanation: draft.explanation,
      examples: draft.examples,
      phonetic: draft.phonetic,
      source: 'ai-lookup',
    })
    wordView.value = { text: word, entry: created, loading: false, error: null }
    ai.value = { loading: false, error: null, draft: null }
    emit('created', created)
  } catch (error) {
    addError.value = localizeServerError(error instanceof Error ? error.message : String(error))
    // 409：这个词刚被别处加入，重新查一次并显示已有词条。
    if (error instanceof ApiError && error.status === 409) {
      const found = await api.entries.lookup(word).catch(() => null)
      if (found?.entry && wordView.value) {
        wordView.value = { ...wordView.value, entry: found.entry }
        ai.value = { loading: false, error: null, draft: null }
      }
    }
  } finally {
    adding.value = false
  }
}
</script>

<template>
  <BaseModal
    :open="Boolean(entry)"
    :title="title"
    width="680px"
    @close="emit('close')"
  >
    <!-- 单词查询视图 -->
    <div v-if="wordView" class="entry-detail">
      <button class="lookup-back" type="button" @click="backToEntry">
        <Icon name="chevron-left" :size="16" />
        {{ t('lookup.back') }}
      </button>

      <div v-if="wordView.loading" class="lookup-state">{{ t('lookup.loading') }}</div>

      <template v-else-if="wordView.error">
        <div class="lookup-state lookup-error">{{ wordView.error }}</div>
      </template>

      <template v-else-if="wordView.entry">
        <div class="detail-title">
          <TypeBadge :type="wordView.entry.type" />
          <h2>
            <ClickableText
              :text="wordView.entry.text"
              :selected="selectedWord"
              :enabled="wordView.entry.type !== 'word'"
              @select="selectWord"
              @open="openWord"
            />
          </h2>
          <SpeakButton :text="wordView.entry.text" :size="20" />
        </div>
        <EntryDetails
          :entry="wordView.entry"
          interactive
          :selected-word="selectedWord"
          @select-word="selectWord"
          @open-word="openWord"
        />
      </template>

      <template v-else>
        <div class="lookup-empty">
          <div class="detail-title">
            <TypeBadge type="word" />
            <h2>
              <ClickableText
                :text="wordView.text"
                :selected="selectedWord"
                @select="selectWord"
                @open="openWord"
              />
            </h2>
            <SpeakButton :text="wordView.text" :size="20" />
          </div>
          <p class="lookup-empty-title">{{ t('lookup.notInLibrary') }}</p>
          <p class="lookup-note">{{ t('lookup.ankiHint') }}</p>
        </div>

        <div v-if="ai.loading" class="lookup-state">{{ t('lookup.askingAi') }}</div>
        <div v-else-if="ai.error" class="lookup-state lookup-error">{{ ai.error }}</div>

        <div v-else-if="ai.draft" class="ai-draft card">
          <div class="ai-draft-head">
            <Icon name="sparkles" :size="16" />
            <h3>{{ t('lookup.aiDraft') }}</h3>
          </div>
          <p v-if="ai.draft.phonetic" class="entry-phonetic">{{ ai.draft.phonetic }}</p>

          <div v-if="ai.draft.meaning" class="detail-block">
            <h3>{{ t('learn.meaning') }}</h3>
            <p class="pre-wrap">{{ ai.draft.meaning }}</p>
          </div>

          <div v-if="ai.draft.englishDefinition" class="detail-block">
            <h3>{{ t('learn.englishDefinition') }}</h3>
            <p class="english-def">
              <ClickableText
                :text="ai.draft.englishDefinition"
                :selected="selectedWord"
                @select="selectWord"
                @open="openWord"
              />
            </p>
          </div>

          <div v-if="ai.draft.explanation" class="detail-block">
            <h3>{{ t('learn.explanation') }}</h3>
            <p class="pre-wrap">
              <ClickableText
                :text="ai.draft.explanation"
                :selected="selectedWord"
                @select="selectWord"
                @open="openWord"
              />
            </p>
          </div>

          <div v-if="ai.draft.examples.length" class="detail-block">
            <h3>{{ t('learn.examples') }}</h3>
            <ul>
              <li v-for="(example, index) in ai.draft.examples" :key="index">
                <ClickableText
                  :text="example"
                  :selected="selectedWord"
                  @select="selectWord"
                  @open="openWord"
                />
              </li>
            </ul>
          </div>
        </div>

        <p v-if="addError" class="lookup-error">{{ addError }}</p>
      </template>
    </div>

    <!-- 原词条详情 -->
    <div v-else-if="entry" class="entry-detail">
      <div class="detail-title">
        <TypeBadge :type="entry.type" />
        <h2>
          <ClickableText
            :text="entry.text"
            :selected="selectedWord"
            :enabled="entry.type !== 'word'"
            @select="selectWord"
            @open="openWord"
          />
        </h2>
        <SpeakButton :text="entry.text" :size="20" />
      </div>
      <p v-if="entry.type !== 'word'" class="lookup-hint">{{ t('lookup.clickHint') }}</p>
      <EntryDetails
        :entry="entry"
        interactive
        :selected-word="selectedWord"
        @select-word="selectWord"
        @open-word="openWord"
      />
    </div>

    <template #footer>
      <div class="detail-actions">
        <template v-if="wordView">
          <button class="btn btn-ghost" type="button" @click="emit('close')">
            {{ t('common.close') }}
          </button>
          <button
            v-if="wordView.entry && !wordView.loading"
            class="btn btn-ghost"
            type="button"
            @click="emit('edit', wordView.entry)"
          >
            <Icon name="edit" :size="16" /> {{ t('library.detail.edit') }}
          </button>
          <button
            v-else-if="!wordView.loading && !wordView.error && !ai.draft"
            class="btn btn-primary"
            type="button"
            :disabled="ai.loading"
            @click="askAi"
          >
            <Icon name="sparkles" :size="16" />
            {{ ai.loading ? t('lookup.askingAi') : t('lookup.askAi') }}
          </button>
          <button
            v-else-if="ai.draft"
            class="btn btn-primary"
            type="button"
            :disabled="adding"
            @click="addToLibrary"
          >
            <Icon name="plus" :size="16" />
            {{ adding ? t('lookup.adding') : t('lookup.addToLibrary') }}
          </button>
        </template>
        <template v-else-if="entry">
          <button class="btn btn-ghost" type="button" @click="emit('close')">
            {{ t('common.close') }}
          </button>
          <button class="btn btn-primary" type="button" @click="emit('edit', entry)">
            <Icon name="edit" :size="16" /> {{ t('library.detail.edit') }}
          </button>
        </template>
      </div>
    </template>
  </BaseModal>
</template>

<style scoped>
.entry-detail {
  display: flex;
  flex-direction: column;
  gap: 18px;
}
.detail-title {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
}
.detail-title h2 {
  margin: 0;
  min-width: 0;
  font-size: 24px;
  font-weight: 600;
  line-height: 1.3;
  color: var(--ink);
  overflow-wrap: anywhere;
}
.detail-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  flex-wrap: wrap;
}
.lookup-back {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  align-self: flex-start;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--muted);
  font: inherit;
  font-size: 13px;
  cursor: pointer;
  transition: color var(--transition);
}
.lookup-back:hover {
  color: var(--accent-strong);
}
.lookup-hint,
.lookup-note {
  margin: -6px 0 0;
  color: var(--muted);
  font-size: 12.5px;
  line-height: 1.6;
}
.lookup-empty {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 18px;
  border-radius: var(--radius-md);
  background: var(--bg);
  box-shadow: var(--shadow-inset);
}
.lookup-empty-title {
  margin: 0;
  color: var(--ink-soft);
  font-size: 14.5px;
}
.lookup-state {
  padding: 14px 16px;
  border-radius: var(--radius-sm);
  background: var(--bg);
  color: var(--ink-soft);
  font-size: 14px;
}
.lookup-error {
  color: var(--danger);
}
.ai-draft {
  display: flex;
  flex-direction: column;
  gap: 14px;
  padding: 18px;
}
.ai-draft-head {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--accent-strong);
}
.ai-draft-head h3 {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
}
.entry-phonetic {
  margin: 0;
  color: var(--muted);
  font-size: 14px;
}
.detail-block h3 {
  margin: 0 0 6px;
  font-size: 12px;
  font-weight: 600;
  color: var(--muted);
}
.detail-block p,
.detail-block ul {
  margin: 0;
  font-size: 14.5px;
  line-height: 1.7;
  color: var(--ink-soft);
}
.detail-block ul {
  padding-left: 1.15em;
}
.detail-block li + li {
  margin-top: 4px;
}
.english-def {
  overflow-wrap: anywhere;
}
.pre-wrap {
  white-space: pre-wrap;
}
</style>
