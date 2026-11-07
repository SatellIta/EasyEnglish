<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute } from 'vue-router'
import type {
  AiBehaviorSettings,
  AiTeachingSettings,
  ExplanationMode,
  MarkdownSyncResult,
  Persona,
  PersonaInput,
  ReviewSettings,
} from '@shared/types'
import type { MessageKey } from '@/i18n/messages'
import Icon from '@/components/Icon.vue'
import {
  locale,
  personaDescription as personaDisplayDescription,
  personaName as personaDisplayName,
  setLocale,
  t,
} from '@/i18n'
import { api, errorMessage } from '@/lib/api'
import { useAppStore } from '@/stores/app'
import { THEMES, useThemeStore } from '@/stores/theme'

type SettingsCategory =
  | 'general'
  | 'appearance'
  | 'review'
  | 'markdown'
  | 'ai'
  | 'persona'
  | 'about'

const categories: {
  id: SettingsCategory
  labelKey: MessageKey
  hintKey: MessageKey
}[] = [
  {
    id: 'general',
    labelKey: 'settings.category.general',
    hintKey: 'settings.category.generalHint',
  },
  {
    id: 'appearance',
    labelKey: 'settings.category.appearance',
    hintKey: 'settings.category.appearanceHint',
  },
  {
    id: 'review',
    labelKey: 'settings.category.review',
    hintKey: 'settings.category.reviewHint',
  },
  {
    id: 'markdown',
    labelKey: 'settings.category.markdown',
    hintKey: 'settings.category.markdownHint',
  },
  {
    id: 'ai',
    labelKey: 'settings.category.ai',
    hintKey: 'settings.category.aiHint',
  },
  {
    id: 'persona',
    labelKey: 'settings.category.persona',
    hintKey: 'settings.category.personaHint',
  },
  {
    id: 'about',
    labelKey: 'settings.category.about',
    hintKey: 'settings.category.aboutHint',
  },
]

const store = useAppStore()
const themeStore = useThemeStore()
const route = useRoute()

const queryCategory =
  typeof route.query.category === 'string' ? route.query.category : ''
const initialCategory =
  categories.find((category) => category.id === queryCategory)?.id ?? 'general'

const activeCategory = ref<SettingsCategory>(initialCategory)

const form = reactive({
  baseUrl: '',
  model: '',
  apiKey: '',
  clearApiKey: false,
})
const reviewForm = reactive({
  intervalsText: '',
  forgotRetryMinutes: 10,
  errorRateRecentWeight: 0.35,
  errorRateIntervalPenalty: 0.6,
})
const behaviorForm = reactive({
  memoryLimit: 12,
  historyLimit: 20,
  memoryCharBudget: 2400,
})
const teachingForm = reactive<{ explanationMode: ExplanationMode }>({
  explanationMode: 'bilingual',
})
const markdownForm = reactive({ path: '' })
const personas = ref<Persona[]>([])
const selectedPersonaId = ref<number | null>(null)
const personaPrompt = ref('')
const personaName = ref('')
const personaDescription = ref('')
const creatingPersona = ref(false)
const newPersona = reactive({ name: '', description: '', prompt: '' })
const loading = ref(true)
const saving = ref(false)
const testing = ref(false)
const reviewSaving = ref(false)
const behaviorSaving = ref(false)
const teachingSaving = ref(false)
const personaSaving = ref(false)
const markdownSaving = ref(false)
const markdownSyncing = ref(false)
const savedReviewText = ref('')
const error = ref('')
const notice = ref('')
const reviewError = ref('')
const reviewNotice = ref('')
const behaviorError = ref('')
const behaviorNotice = ref('')
const teachingError = ref('')
const teachingNotice = ref('')
const personaError = ref('')
const personaNotice = ref('')
const markdownError = ref('')
const markdownNotice = ref('')
const testResult = ref<{ ok: boolean; message: string } | null>(null)
const selectedPersona = computed(
  () => personas.value.find((persona) => persona.id === selectedPersonaId.value) ?? null,
)

const presets = [
  {
    labelKey: 'settings.ai.presetOpenAI' as const,
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
  },
  {
    labelKey: 'settings.ai.presetDeepSeek' as const,
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-chat',
  },
  {
    labelKey: 'settings.ai.presetQwen' as const,
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen-plus',
  },
  {
    labelKey: 'settings.ai.presetOllama' as const,
    baseUrl: 'http://localhost:11434/v1',
    model: 'qwen2.5:7b',
  },
]

async function load() {
  loading.value = true
  error.value = ''
  try {
    const [settings, review, behavior, teaching, personaList, personaSetting, markdown] =
      await Promise.all([
        api.settings.get(),
        api.settings.review(),
        api.settings.aiBehavior(),
        api.settings.aiTeaching(),
        api.personas.list(),
        api.settings.aiPersona(),
        api.settings.markdown(),
      ])
    form.baseUrl = settings.baseUrl
    form.model = settings.model
    form.apiKey = ''
    form.clearApiKey = false
    store.settings = settings

    reviewForm.intervalsText = review.intervalsDays.join(', ')
    reviewForm.forgotRetryMinutes = review.forgotRetryMinutes
    reviewForm.errorRateRecentWeight = review.errorRateRecentWeight
    reviewForm.errorRateIntervalPenalty = review.errorRateIntervalPenalty
    savedReviewText.value = t('settings.review.summary', {
      intervals: review.intervalsDays.join(' / '),
      retry: review.forgotRetryMinutes,
      weight: review.errorRateRecentWeight,
    })

    behaviorForm.memoryLimit = behavior.memoryLimit
    behaviorForm.historyLimit = behavior.historyLimit
    behaviorForm.memoryCharBudget = behavior.memoryCharBudget
    teachingForm.explanationMode = teaching.explanationMode
    markdownForm.path = markdown.path ?? ''

    personas.value = personaList.items
    const selected =
      personaList.items.find((persona) => persona.id === personaSetting.personaId) ??
      personaList.items[0] ??
      null
    selectedPersonaId.value = selected?.id ?? null
    syncPersonaFields(selected)
  } catch (caught) {
    error.value = errorMessage(caught)
  } finally {
    loading.value = false
  }
}

function applyPreset(preset: (typeof presets)[number]) {
  form.baseUrl = preset.baseUrl
  form.model = preset.model
  notice.value = t('settings.ai.presetApplied', { name: t(preset.labelKey) })
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
    notice.value = t('settings.ai.saved')
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
          message: t('settings.ai.testSuccess', {
            model: result.model ?? '',
            reply: result.reply || 'OK',
          }),
        }
      : { ok: false, message: result.error || t('settings.ai.testFailed') }
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

    if (!intervals.length) throw new Error(t('settings.review.invalidIntervals'))
    const retry = Number(reviewForm.forgotRetryMinutes)
    if (!Number.isFinite(retry) || retry <= 0) {
      throw new Error(t('settings.review.invalidRetry'))
    }

    const saved: ReviewSettings = await api.settings.updateReview({
      intervalsDays: intervals,
      forgotRetryMinutes: retry,
      errorRateRecentWeight: Number(reviewForm.errorRateRecentWeight),
      errorRateIntervalPenalty: Number(reviewForm.errorRateIntervalPenalty),
    })
    reviewForm.intervalsText = saved.intervalsDays.join(', ')
    reviewForm.forgotRetryMinutes = saved.forgotRetryMinutes
    reviewForm.errorRateRecentWeight = saved.errorRateRecentWeight
    reviewForm.errorRateIntervalPenalty = saved.errorRateIntervalPenalty
    savedReviewText.value = t('settings.review.summary', {
      intervals: saved.intervalsDays.join(' / '),
      retry: saved.forgotRetryMinutes,
      weight: saved.errorRateRecentWeight,
    })
    reviewNotice.value = t('settings.review.saved')
  } catch (caught) {
    reviewError.value = errorMessage(caught)
  } finally {
    reviewSaving.value = false
  }
}

async function saveMarkdownPath() {
  markdownSaving.value = true
  markdownError.value = ''
  markdownNotice.value = ''
  try {
    const saved = await api.settings.updateMarkdown(markdownForm.path.trim() || null)
    markdownForm.path = saved.path ?? ''
    markdownNotice.value = t('settings.markdown.saved')
  } catch (caught) {
    markdownError.value = errorMessage(caught)
  } finally {
    markdownSaving.value = false
  }
}

async function syncMarkdownNow() {
  markdownSyncing.value = true
  markdownError.value = ''
  markdownNotice.value = ''
  try {
    const saved = await api.settings.updateMarkdown(markdownForm.path.trim() || null)
    markdownForm.path = saved.path ?? ''
    if (!saved.path) throw new Error(t('settings.markdown.noPath'))
    const result: MarkdownSyncResult = await api.imports.syncMarkdown()
    const changed = result.created + result.linked + result.updated
    markdownNotice.value = changed
      ? t('review.syncDone', {
          created: result.created,
          linked: result.linked,
          updated: result.updated,
        })
      : t('review.syncNoChanges')
    store.refreshStats().catch(() => {})
  } catch (caught) {
    markdownError.value = errorMessage(caught)
  } finally {
    markdownSyncing.value = false
  }
}

async function saveBehavior() {
  behaviorSaving.value = true
  behaviorError.value = ''
  behaviorNotice.value = ''
  try {
    const saved: AiBehaviorSettings = await api.settings.updateAiBehavior({
      memoryLimit: Number(behaviorForm.memoryLimit),
      historyLimit: Number(behaviorForm.historyLimit),
      memoryCharBudget: Number(behaviorForm.memoryCharBudget),
    })
    behaviorForm.memoryLimit = saved.memoryLimit
    behaviorForm.historyLimit = saved.historyLimit
    behaviorForm.memoryCharBudget = saved.memoryCharBudget
    behaviorNotice.value = t('settings.context.saved')
  } catch (caught) {
    behaviorError.value = errorMessage(caught)
  } finally {
    behaviorSaving.value = false
  }
}

async function saveTeaching() {
  teachingSaving.value = true
  teachingError.value = ''
  teachingNotice.value = ''
  try {
    const saved: AiTeachingSettings = await api.settings.updateAiTeaching({
      explanationMode: teachingForm.explanationMode,
    })
    teachingForm.explanationMode = saved.explanationMode
    teachingNotice.value =
      saved.explanationMode === 'english'
        ? t('settings.teaching.savedEnglish')
        : t('settings.teaching.savedBilingual')
  } catch (caught) {
    teachingError.value = errorMessage(caught)
  } finally {
    teachingSaving.value = false
  }
}

function syncPersonaFields(persona: Persona | null) {
  personaName.value = persona?.name ?? ''
  personaDescription.value = persona?.description ?? ''
  personaPrompt.value = persona?.prompt ?? ''
}

async function changePersona(id: number) {
  const persona = personas.value.find((item) => item.id === id)
  if (!persona) return

  selectedPersonaId.value = persona.id
  syncPersonaFields(persona)
  personaError.value = ''
  personaNotice.value = ''
  try {
    await api.settings.updateAiPersona({ personaId: persona.id })
    personaNotice.value = t('settings.persona.switched', {
      name: personaDisplayName(persona),
    })
  } catch (caught) {
    personaError.value = errorMessage(caught)
  }
}

function onPersonaChange(event: Event) {
  const id = Number((event.target as HTMLSelectElement).value)
  if (Number.isInteger(id) && id > 0) changePersona(id)
}

async function savePersona() {
  const persona = selectedPersona.value
  if (!persona || personaSaving.value) return

  personaSaving.value = true
  personaError.value = ''
  personaNotice.value = ''
  try {
    const input: Partial<PersonaInput> = { prompt: personaPrompt.value }
    if (!persona.isDefault) {
      input.name = personaName.value
      input.description = personaDescription.value
    }
    const updated = await api.personas.update(persona.id, input)
    personas.value = personas.value.map((item) =>
      item.id === updated.id ? updated : item,
    )
    syncPersonaFields(updated)
    personaNotice.value = t('settings.persona.saved')
  } catch (caught) {
    personaError.value = errorMessage(caught)
  } finally {
    personaSaving.value = false
  }
}

async function resetPersona() {
  const persona = selectedPersona.value
  if (!persona || !persona.isDefault) return
  if (
    !window.confirm(
      t('settings.persona.resetConfirm', { name: personaDisplayName(persona) }),
    )
  ) {
    return
  }

  personaSaving.value = true
  personaError.value = ''
  personaNotice.value = ''
  try {
    const updated = await api.personas.reset(persona.id)
    personas.value = personas.value.map((item) =>
      item.id === updated.id ? updated : item,
    )
    syncPersonaFields(updated)
    personaNotice.value = t('settings.persona.resetDone')
  } catch (caught) {
    personaError.value = errorMessage(caught)
  } finally {
    personaSaving.value = false
  }
}

async function createPersona() {
  if (!newPersona.name.trim() || !newPersona.prompt.trim()) {
    personaError.value = t('settings.persona.invalid')
    return
  }

  personaSaving.value = true
  personaError.value = ''
  personaNotice.value = ''
  try {
    const created = await api.personas.create({
      name: newPersona.name,
      description: newPersona.description || null,
      prompt: newPersona.prompt,
    })
    personas.value = [...personas.value, created]
    selectedPersonaId.value = created.id
    syncPersonaFields(created)
    newPersona.name = ''
    newPersona.description = ''
    newPersona.prompt = ''
    creatingPersona.value = false
    await changePersona(created.id)
    personaNotice.value = t('settings.persona.created')
  } catch (caught) {
    personaError.value = errorMessage(caught)
  } finally {
    personaSaving.value = false
  }
}

async function removePersona() {
  const persona = selectedPersona.value
  if (!persona || persona.isDefault) return
  if (
    !window.confirm(
      t('settings.persona.deleteConfirm', { name: personaDisplayName(persona) }),
    )
  ) {
    return
  }

  personaSaving.value = true
  personaError.value = ''
  personaNotice.value = ''
  try {
    await api.personas.remove(persona.id)
    personas.value = personas.value.filter((item) => item.id !== persona.id)
    const next = personas.value[0] ?? null
    if (next) {
      await changePersona(next.id)
    } else {
      selectedPersonaId.value = null
      syncPersonaFields(null)
    }
    personaNotice.value = t('settings.persona.deleted')
  } catch (caught) {
    personaError.value = errorMessage(caught)
  } finally {
    personaSaving.value = false
  }
}

onMounted(load)
</script>

<template>
  <div class="page settings-page">
    <header class="page-head">
      <div>
        <h1>{{ t('settings.title') }}</h1>
        <p>{{ t('settings.subtitle') }}</p>
      </div>
    </header>

    <p v-if="error" class="banner banner-error">{{ error }}</p>
    <p v-if="notice" class="banner banner-ok">{{ notice }}</p>

    <div class="settings-layout">
      <nav class="settings-nav" :aria-label="t('settings.title')">
        <button
          v-for="category in categories"
          :key="category.id"
          type="button"
          class="settings-nav-item"
          :class="{ active: activeCategory === category.id }"
          :aria-pressed="activeCategory === category.id"
          @click="activeCategory = category.id"
        >
          <strong>{{ t(category.labelKey) }}</strong>
          <small>{{ t(category.hintKey) }}</small>
        </button>
      </nav>

      <div class="settings-content">
        <template v-if="activeCategory === 'general'">
          <section class="card settings-card">
            <div class="card-title">
              <div>
                <h2>{{ t('settings.language.title') }}</h2>
                <p class="hint">{{ t('settings.language.hint') }}</p>
              </div>
              <span class="status-pill ok">
                {{ locale === 'en' ? t('settings.language.en') : t('settings.language.zh') }}
              </span>
            </div>

            <div class="theme-options">
              <button
                class="theme-option"
                :class="{ active: locale === 'zh' }"
                type="button"
                :aria-pressed="locale === 'zh'"
                @click="setLocale('zh')"
              >
                <span class="theme-copy">
                  <strong>{{ t('settings.language.zh') }}</strong>
                  <small>{{ t('settings.language.zhDesc') }}</small>
                </span>
                <Icon
                  v-if="locale === 'zh'"
                  class="theme-check"
                  name="check"
                  :size="17"
                />
              </button>
              <button
                class="theme-option"
                :class="{ active: locale === 'en' }"
                type="button"
                :aria-pressed="locale === 'en'"
                @click="setLocale('en')"
              >
                <span class="theme-copy">
                  <strong>{{ t('settings.language.en') }}</strong>
                  <small>{{ t('settings.language.enDesc') }}</small>
                </span>
                <Icon
                  v-if="locale === 'en'"
                  class="theme-check"
                  name="check"
                  :size="17"
                />
              </button>
            </div>
          </section>
        </template>

        <template v-else-if="activeCategory === 'appearance'">
          <section class="card settings-card">
            <div class="card-title">
              <div>
                <h2>{{ t('settings.appearance.title') }}</h2>
                <p class="hint">{{ t('settings.appearance.hint') }}</p>
              </div>
              <span class="status-pill ok">
                {{ t(themeStore.theme === 'swiss' ? 'theme.swiss.name' : 'theme.neumorphism.name') }}
              </span>
            </div>

            <div class="settings-subsection">
              <div class="subsection-head">
                <h3>{{ t('settings.appearance.theme') }}</h3>
                <p class="hint">{{ t('settings.appearance.themeHint') }}</p>
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
                    <strong>{{ t(option.nameKey) }}</strong>
                    <small>{{ t(option.descriptionKey) }}</small>
                  </span>
                  <Icon
                    v-if="themeStore.theme === option.id"
                    class="theme-check"
                    name="check"
                    :size="17"
                  />
                </button>
              </div>
            </div>

            <div class="settings-subsection">
              <div class="subsection-head">
                <h3>{{ t('settings.appearance.mode') }}</h3>
                <p class="hint">{{ t('settings.appearance.modeHint') }}</p>
              </div>
              <div class="theme-options">
                <button
                  type="button"
                  class="theme-option"
                  :class="{ active: themeStore.colorMode === 'light' }"
                  :aria-pressed="themeStore.colorMode === 'light'"
                  @click="themeStore.setColorMode('light')"
                >
                  <span class="theme-swatch mode-swatch swatch-mode-light" aria-hidden="true">
                    <span class="mode-dot" />
                  </span>
                  <span class="theme-copy">
                    <strong>{{ t('theme.mode.light') }}</strong>
                    <small>{{ t('theme.mode.lightDesc') }}</small>
                  </span>
                  <Icon
                    v-if="themeStore.colorMode === 'light'"
                    class="theme-check"
                    name="check"
                    :size="17"
                  />
                </button>
                <button
                  type="button"
                  class="theme-option"
                  :class="{ active: themeStore.colorMode === 'dark' }"
                  :aria-pressed="themeStore.colorMode === 'dark'"
                  @click="themeStore.setColorMode('dark')"
                >
                  <span class="theme-swatch mode-swatch swatch-mode-dark" aria-hidden="true">
                    <span class="mode-dot" />
                  </span>
                  <span class="theme-copy">
                    <strong>{{ t('theme.mode.dark') }}</strong>
                    <small>{{ t('theme.mode.darkDesc') }}</small>
                  </span>
                  <Icon
                    v-if="themeStore.colorMode === 'dark'"
                    class="theme-check"
                    name="check"
                    :size="17"
                  />
                </button>
              </div>
            </div>
          </section>
        </template>

        <template v-else-if="activeCategory === 'review'">
          <section class="card settings-card">
            <div class="card-title">
              <div>
                <h2>{{ t('settings.review.title') }}</h2>
                <p class="hint">{{ t('settings.review.hint') }}</p>
              </div>
            </div>

            <p v-if="reviewError" class="banner banner-error">{{ reviewError }}</p>
            <p v-if="reviewNotice" class="banner banner-ok">{{ reviewNotice }}</p>

            <div class="field">
              <label for="review-intervals">{{ t('settings.review.intervals') }}</label>
              <input
                id="review-intervals"
                v-model="reviewForm.intervalsText"
                class="input"
                placeholder="1, 2, 4, 7, 15, 30, 60, 120, 240"
                :disabled="loading"
              />
              <span class="hint">
                {{ t('settings.review.intervalsHint') }}
              </span>
            </div>

            <div class="field">
              <label for="review-retry">{{ t('settings.review.retry') }}</label>
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
                {{ t('settings.review.retryHint') }}
              </span>
            </div>

            <div class="field">
              <label for="review-error-weight">{{ t('settings.review.errorWeight') }}</label>
              <input
                id="review-error-weight"
                v-model.number="reviewForm.errorRateRecentWeight"
                type="number"
                min="0"
                max="1"
                step="0.05"
                class="input"
                :disabled="loading"
              />
              <span class="hint">
                {{ t('settings.review.errorWeightHint') }}
              </span>
            </div>

            <div class="field">
              <label for="review-error-penalty">{{ t('settings.review.errorPenalty') }}</label>
              <input
                id="review-error-penalty"
                v-model.number="reviewForm.errorRateIntervalPenalty"
                type="number"
                min="0"
                max="1"
                step="0.05"
                class="input"
                :disabled="loading"
              />
              <span class="hint">
                {{ t('settings.review.errorPenaltyHint') }}
              </span>
            </div>

            <div class="actions">
              <button class="btn btn-primary" :disabled="reviewSaving" @click="saveReview">
                {{ reviewSaving ? t('common.saving') : t('settings.review.save') }}
              </button>
            </div>
          </section>
        </template>

        <template v-else-if="activeCategory === 'markdown'">
          <section class="card settings-card">
            <div class="card-title">
              <div>
                <h2>{{ t('settings.markdown.title') }}</h2>
                <p class="hint">{{ t('settings.markdown.hint') }}</p>
              </div>
              <span class="status-pill" :class="markdownForm.path ? 'ok' : 'warn'">
                {{
                  t(
                    markdownForm.path
                      ? 'settings.markdown.configured'
                      : 'settings.markdown.notConfigured',
                  )
                }}
              </span>
            </div>

            <p v-if="markdownError" class="banner banner-error">{{ markdownError }}</p>
            <p v-if="markdownNotice" class="banner banner-ok">{{ markdownNotice }}</p>

            <div class="field">
              <label for="markdown-path">{{ t('settings.markdown.path') }}</label>
              <input
                id="markdown-path"
                v-model="markdownForm.path"
                class="input"
                :placeholder="t('settings.markdown.pathPlaceholder')"
                :disabled="loading"
              />
              <span class="hint">{{ t('settings.markdown.pathHint') }}</span>
            </div>

            <div class="actions">
              <button
                class="btn btn-primary"
                :disabled="markdownSaving || markdownSyncing"
                @click="saveMarkdownPath"
              >
                {{ markdownSaving ? t('common.saving') : t('settings.markdown.save') }}
              </button>
              <button
                class="btn btn-ghost"
                :disabled="markdownSyncing || markdownSaving"
                @click="syncMarkdownNow"
              >
                <Icon name="refresh" :size="16" />
                {{ markdownSyncing ? t('settings.markdown.syncing') : t('settings.markdown.syncNow') }}
              </button>
            </div>
          </section>
        </template>

        <template v-else-if="activeCategory === 'ai'">
          <section class="card settings-card">
            <div class="card-title">
              <div>
                <h2>{{ t('settings.ai.title') }}</h2>
                <p class="hint">{{ t('settings.ai.hint') }}</p>
              </div>
              <span
                class="status-pill"
                :class="store.settings?.configured ? 'ok' : 'warn'"
              >
                {{ store.settings?.configured ? t('settings.ai.configured') : t('settings.ai.notConfigured') }}
              </span>
            </div>

            <div class="field">
              <label>{{ t('settings.ai.presets') }}</label>
              <div class="presets">
                <button
                  v-for="preset in presets"
                  :key="preset.labelKey"
                  class="preset"
                  type="button"
                  @click="applyPreset(preset)"
                >
                  {{ t(preset.labelKey) }}
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
              <label for="model">{{ t('settings.ai.model') }}</label>
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
              <span class="hint">{{ t('settings.ai.modelHint') }}</span>
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
                    ? t('settings.ai.apiKeySaved', { masked: store.settings.apiKeyMasked ?? '' })
                    : 'sk-...'
                "
                :disabled="loading || form.clearApiKey"
                autocomplete="off"
              />
              <label v-if="store.settings?.hasApiKey" class="check-row">
                <input v-model="form.clearApiKey" type="checkbox" />
                {{ t('settings.ai.clearApiKey') }}
              </label>
              <span class="hint">
                {{ t('settings.ai.apiKeyHint') }}
              </span>
            </div>

            <div class="actions">
              <button class="btn btn-ghost" :disabled="testing" @click="test">
                <Icon :name="testing ? 'refresh' : 'layers'" :size="16" />
                {{ testing ? t('settings.ai.testing') : t('settings.ai.test') }}
              </button>
              <button class="btn btn-primary" :disabled="saving" @click="save">
                <Icon :name="saving ? 'refresh' : 'check'" :size="16" />
                {{ saving ? t('common.saving') : t('settings.ai.save') }}
              </button>
            </div>

            <p v-if="testResult" class="banner" :class="testResult.ok ? 'banner-ok' : 'banner-error'">
              {{ testResult.message }}
            </p>
          </section>

          <section class="card settings-card">
            <div class="card-title">
              <div>
                <h2>{{ t('settings.context.title') }}</h2>
                <p class="hint">{{ t('settings.context.hint') }}</p>
              </div>
            </div>

            <p v-if="behaviorError" class="banner banner-error">{{ behaviorError }}</p>
            <p v-if="behaviorNotice" class="banner banner-ok">{{ behaviorNotice }}</p>

            <div class="field">
              <label for="memory-limit">{{ t('settings.context.memoryLimit') }}</label>
              <input
                id="memory-limit"
                v-model.number="behaviorForm.memoryLimit"
                type="number"
                min="1"
                max="30"
                class="input"
                :disabled="loading"
              />
              <span class="hint">{{ t('settings.context.memoryLimitHint') }}</span>
            </div>

            <div class="field">
              <label for="memory-budget">{{ t('settings.context.charBudget') }}</label>
              <input
                id="memory-budget"
                v-model.number="behaviorForm.memoryCharBudget"
                type="number"
                min="200"
                max="12000"
                step="100"
                class="input"
                :disabled="loading"
              />
              <span class="hint">{{ t('settings.context.charBudgetHint') }}</span>
            </div>

            <div class="field">
              <label for="history-limit">{{ t('settings.context.historyLimit') }}</label>
              <input
                id="history-limit"
                v-model.number="behaviorForm.historyLimit"
                type="number"
                min="2"
                max="50"
                class="input"
                :disabled="loading"
              />
              <span class="hint">{{ t('settings.context.historyLimitHint') }}</span>
            </div>

            <div class="actions">
              <button class="btn btn-primary" :disabled="behaviorSaving" @click="saveBehavior">
                {{ behaviorSaving ? t('common.saving') : t('settings.context.save') }}
              </button>
            </div>
          </section>

          <section class="card settings-card">
            <div class="card-title">
              <div>
                <h2>{{ t('settings.teaching.title') }}</h2>
                <p class="hint">
                  {{ t('settings.teaching.hint') }}
                </p>
              </div>
              <span class="status-pill ok">
                {{ teachingForm.explanationMode === 'english' ? t('settings.teaching.english') : t('settings.teaching.bilingual') }}
              </span>
            </div>

            <p v-if="teachingError" class="banner banner-error">{{ teachingError }}</p>
            <p v-if="teachingNotice" class="banner banner-ok">{{ teachingNotice }}</p>

            <div class="theme-options">
              <button
                class="theme-option"
                :class="{ active: teachingForm.explanationMode === 'bilingual' }"
                type="button"
                :aria-pressed="teachingForm.explanationMode === 'bilingual'"
                @click="teachingForm.explanationMode = 'bilingual'"
              >
                <span class="theme-copy">
                  <strong>{{ t('settings.teaching.bilingual') }}</strong>
                  <small>{{ t('settings.teaching.bilingualDesc') }}</small>
                </span>
                <Icon
                  v-if="teachingForm.explanationMode === 'bilingual'"
                  class="theme-check"
                  name="check"
                  :size="17"
                />
              </button>
              <button
                class="theme-option"
                :class="{ active: teachingForm.explanationMode === 'english' }"
                type="button"
                :aria-pressed="teachingForm.explanationMode === 'english'"
                @click="teachingForm.explanationMode = 'english'"
              >
                <span class="theme-copy">
                  <strong>{{ t('settings.teaching.english') }}</strong>
                  <small>{{ t('settings.teaching.englishDesc') }}</small>
                </span>
                <Icon
                  v-if="teachingForm.explanationMode === 'english'"
                  class="theme-check"
                  name="check"
                  :size="17"
                />
              </button>
            </div>

            <div class="actions">
              <button class="btn btn-primary" :disabled="teachingSaving" @click="saveTeaching">
                {{ teachingSaving ? t('common.saving') : t('settings.teaching.save') }}
              </button>
            </div>
          </section>
        </template>

        <template v-else-if="activeCategory === 'persona'">
          <section class="card settings-card">
            <div class="card-title">
              <div>
                <h2>{{ t('settings.persona.title') }}</h2>
                <p class="hint">
                  {{ t('settings.persona.hint') }}
                </p>
              </div>
              <span class="status-pill ok">
                {{ selectedPersona?.isDefault ? t('persona.defaultTag') : t('persona.customTag') }}
              </span>
            </div>

            <p v-if="personaError" class="banner banner-error">{{ personaError }}</p>
            <p v-if="personaNotice" class="banner banner-ok">{{ personaNotice }}</p>

            <div class="field">
              <label for="persona-select">{{ t('settings.persona.current') }}</label>
              <select
                id="persona-select"
                class="input"
                :value="selectedPersonaId ?? ''"
                :disabled="loading"
                @change="onPersonaChange"
              >
                <option v-for="persona in personas" :key="persona.id" :value="persona.id">
                  {{ personaDisplayName(persona) }}{{ persona.isDefault ? ` · ${t('persona.defaultTag')}` : '' }}
                </option>
              </select>
              <span v-if="selectedPersona?.description" class="hint">
                {{ personaDisplayDescription(selectedPersona) }}
              </span>
            </div>

            <template v-if="selectedPersona">
              <div v-if="!selectedPersona.isDefault" class="persona-meta">
                <div class="field">
                  <label for="persona-name">{{ t('settings.persona.name') }}</label>
                  <input
                    id="persona-name"
                    v-model="personaName"
                    class="input"
                    maxlength="80"
                    :disabled="personaSaving"
                  />
                </div>
                <div class="field">
                  <label for="persona-description">{{ t('settings.persona.description') }}</label>
                  <input
                    id="persona-description"
                    v-model="personaDescription"
                    class="input"
                    maxlength="300"
                    :disabled="personaSaving"
                  />
                </div>
              </div>

              <div class="field">
                <label for="persona-prompt">{{ t('settings.persona.prompt') }}</label>
                <textarea
                  id="persona-prompt"
                  v-model="personaPrompt"
                  class="input persona-textarea"
                  rows="6"
                  :disabled="personaSaving"
                />
                <span class="hint">
                  {{ t('settings.persona.promptHint') }}
                </span>
              </div>

              <div class="actions">
                <button
                  v-if="selectedPersona.isDefault"
                  class="btn btn-ghost"
                  :disabled="personaSaving"
                  @click="resetPersona"
                >
                  {{ t('settings.persona.reset') }}
                </button>
                <button
                  v-if="!selectedPersona.isDefault"
                  class="btn btn-ghost"
                  :disabled="personaSaving"
                  @click="removePersona"
                >
                  {{ t('settings.persona.delete') }}
                </button>
                <button class="btn btn-primary" :disabled="personaSaving" @click="savePersona">
                  {{ personaSaving ? t('common.saving') : t('settings.persona.save') }}
                </button>
              </div>
            </template>

            <div class="persona-create">
              <button
                v-if="!creatingPersona"
                class="btn btn-soft btn-sm"
                @click="creatingPersona = true"
              >
                <Icon name="plus" :size="15" /> {{ t('settings.persona.new') }}
              </button>
              <template v-else>
                <div class="persona-meta">
                  <div class="field">
                    <label for="new-persona-name">{{ t('settings.persona.newName') }}</label>
                    <input
                      id="new-persona-name"
                      v-model="newPersona.name"
                      class="input"
                      maxlength="80"
                    />
                  </div>
                  <div class="field">
                    <label for="new-persona-description">{{ t('settings.persona.newDescription') }}</label>
                    <input
                      id="new-persona-description"
                      v-model="newPersona.description"
                      class="input"
                      maxlength="300"
                    />
                  </div>
                </div>
                <div class="field">
                  <label for="new-persona-prompt">{{ t('settings.persona.newPrompt') }}</label>
                  <textarea
                    id="new-persona-prompt"
                    v-model="newPersona.prompt"
                    class="input persona-textarea"
                    rows="5"
                  />
                </div>
                <div class="actions">
                  <button class="btn btn-ghost" :disabled="personaSaving" @click="creatingPersona = false">
                    {{ t('common.cancel') }}
                  </button>
                  <button class="btn btn-primary" :disabled="personaSaving" @click="createPersona">
                    {{ personaSaving ? t('common.saving') : t('settings.persona.create') }}
                  </button>
                </div>
              </template>
            </div>
          </section>
        </template>

        <template v-else-if="activeCategory === 'about'">
          <section class="card info-card">
            <div class="card-title">
              <h2>{{ t('settings.local.title') }}</h2>
              <Icon name="info" :size="18" />
            </div>
            <ul class="info-list">
              <li>
                <span>{{ t('settings.local.database') }}</span>
                <code>data/easy-english.db</code>
              </li>
              <li>
                <span>{{ t('settings.local.source') }}</span>
                <code>{{ store.settings?.source === 'env' ? t('settings.local.env') : store.settings?.source === 'settings' ? t('settings.local.settings') : t('settings.local.default') }}</code>
              </li>
              <li>
                <span>{{ t('settings.local.review') }}</span>
                <code>{{ savedReviewText || t('settings.local.notRead') }}</code>
              </li>
            </ul>
            <p class="hint">
              {{ t('settings.local.backupHint') }}
            </p>
          </section>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.settings-page {
  max-width: 1080px;
}
.settings-layout {
  display: grid;
  grid-template-columns: 218px minmax(0, 1fr);
  gap: 24px;
  align-items: start;
}
.settings-nav {
  position: sticky;
  top: 24px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px;
  border: var(--border-width, 0) solid var(--border-color, transparent);
  border-radius: var(--radius-lg);
  background: var(--bg-soft);
}
.settings-nav-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
  width: 100%;
  padding: 10px 12px;
  border: 0;
  border-left: 3px solid transparent;
  border-radius: var(--radius-sm);
  background: transparent;
  color: var(--ink-soft);
  text-align: left;
  font: inherit;
  cursor: pointer;
  transition: background-color var(--transition), color var(--transition),
    box-shadow var(--transition), border-color var(--transition);
}
.settings-nav-item strong {
  font-size: 13.5px;
  font-weight: 600;
}
.settings-nav-item small {
  font-size: 11.5px;
  line-height: 1.35;
  color: var(--muted);
}
.settings-nav-item:hover {
  background: var(--bg);
  color: var(--ink);
}
.settings-nav-item.active {
  background: var(--accent-soft);
  border-left-color: var(--accent);
  color: var(--accent-strong);
  box-shadow: var(--shadow-raised-sm);
}
.settings-nav-item.active small {
  color: var(--accent-strong);
  opacity: 0.8;
}
.settings-nav-item:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
.settings-content {
  min-width: 0;
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
.settings-subsection {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.subsection-head h3 {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: var(--ink);
}
.subsection-head p {
  margin: 3px 0 0;
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
.mode-swatch {
  display: grid;
  place-items: center;
  border: var(--border-width, 0) solid var(--border-color, transparent);
}
.swatch-mode-light {
  background: var(--surface-2);
  color: var(--accent);
  box-shadow: var(--shadow-raised-sm);
}
.swatch-mode-dark {
  background: var(--ink);
  color: var(--bg);
}
.mode-dot {
  width: 17px;
  height: 17px;
  border-radius: 50%;
  background: currentColor;
}
.theme-check {
  margin-left: auto;
  flex: 0 0 auto;
  color: var(--accent-strong);
}
.persona-meta {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
}
.persona-textarea {
  min-height: 120px;
  resize: vertical;
  line-height: 1.6;
}
.persona-create {
  display: flex;
  flex-direction: column;
  gap: 14px;
}
@media (max-width: 820px) {
  .settings-layout {
    grid-template-columns: 1fr;
    gap: 16px;
  }
  .settings-nav {
    position: static;
    flex-direction: row;
    gap: 6px;
    overflow-x: auto;
    padding: 6px;
  }
  .settings-nav-item {
    flex: 0 0 auto;
    width: auto;
    border-left: 0;
    border-bottom: 3px solid transparent;
    white-space: nowrap;
  }
  .settings-nav-item.active {
    border-left-color: transparent;
    border-bottom-color: var(--accent);
  }
  .settings-nav-item small {
    display: none;
  }
  .settings-content {
    max-width: none;
  }
}
@media (max-width: 620px) {
  .theme-options {
    grid-template-columns: 1fr;
  }
  .persona-meta {
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
