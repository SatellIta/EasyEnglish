<script setup lang="ts">
import { nextTick, reactive, ref, watch } from 'vue'
import type { Entry, EntryInput, EntryType } from '@shared/types'
import { api, errorMessage } from '@/lib/api'
import BaseModal from '@/components/BaseModal.vue'
import Icon from '@/components/Icon.vue'
import { t } from '@/i18n'

const props = withDefaults(
  defineProps<{ open: boolean; entry?: Entry | null; defaultReviewEnabled?: boolean }>(),
  { defaultReviewEnabled: true },
)
const emit = defineEmits<{ close: []; saved: [entry: Entry] }>()

const form = reactive({
  type: 'word' as EntryType,
  text: '',
  meaning: '',
  explanation: '',
  examplesText: '',
  notes: '',
  tagsText: '',
  reviewEnabled: true,
})
const saving = ref(false)
const error = ref('')

const typeOptions: Array<{
  value: EntryType
  labelKey: 'entryType.word' | 'entryType.phrase' | 'entryType.sentence'
  hintKey:
    | 'entryForm.type.wordHint'
    | 'entryForm.type.phraseHint'
    | 'entryForm.type.sentenceHint'
}> = [
  { value: 'word', labelKey: 'entryType.word', hintKey: 'entryForm.type.wordHint' },
  { value: 'phrase', labelKey: 'entryType.phrase', hintKey: 'entryForm.type.phraseHint' },
  { value: 'sentence', labelKey: 'entryType.sentence', hintKey: 'entryForm.type.sentenceHint' },
]

function reset() {
  const entry = props.entry
  form.type = entry?.type ?? 'word'
  form.text = entry?.text ?? ''
  form.meaning = entry?.meaning ?? ''
  form.explanation = entry?.explanation ?? ''
  form.examplesText = (entry?.examples ?? []).join('\n')
  form.notes = entry?.notes ?? ''
  form.tagsText = (entry?.tags ?? []).join(', ')
  form.reviewEnabled = entry?.reviewEnabled ?? props.defaultReviewEnabled
  error.value = ''
}

watch(
  () => props.open,
  (open) => {
    if (open) reset()
  },
)

watch(
  () => props.entry,
  () => {
    if (props.open) reset()
  },
)

async function submit() {
  if (!form.text.trim()) {
    error.value = t('entryForm.required')
    return
  }

  saving.value = true
  error.value = ''

  const input: EntryInput = {
    type: form.type,
    text: form.text.trim(),
    meaning: form.meaning.trim() || null,
    explanation: form.explanation.trim() || null,
    examples: form.examplesText
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean),
    notes: form.notes.trim() || null,
    tags: form.tagsText
      .split(/[,，]/)
      .map((tag) => tag.trim())
      .filter(Boolean),
    reviewEnabled: form.reviewEnabled,
  }

  try {
    const entry = props.entry
      ? await api.entries.update(props.entry.id, input)
      : await api.entries.create(input)
    emit('saved', entry)
    emit('close')
  } catch (caught) {
    error.value = errorMessage(caught)
    await nextTick()
    document.querySelector('.entry-form .banner-error')?.scrollIntoView({
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 'auto'
        : 'smooth',
      block: 'center',
    })
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <BaseModal
    :open="open"
    :title="entry ? t('entryForm.editTitle') : t('entryForm.addTitle')"
    width="620px"
    @close="emit('close')"
  >
    <form class="entry-form" @submit.prevent="submit">
      <div class="field">
        <label>{{ t('entryForm.typeLabel') }}</label>
        <div class="type-picker">
          <button
            v-for="option in typeOptions"
            :key="option.value"
            type="button"
            class="type-option"
            :class="{ active: form.type === option.value }"
            :aria-pressed="form.type === option.value"
            @click="form.type = option.value"
          >
            <strong>{{ t(option.labelKey) }}</strong>
            <small>{{ t(option.hintKey) }}</small>
          </button>
        </div>
      </div>

      <div class="field">
        <label for="entry-text">{{ t('entryForm.text') }}</label>
        <textarea
          id="entry-text"
          v-model="form.text"
          class="textarea"
          rows="2"
          :placeholder="t('entryForm.textPlaceholder')"
        />
        <span class="hint">
          {{ t('entryForm.duplicateHint') }}
        </span>
      </div>

      <div class="field">
        <label for="entry-meaning">{{ t('entryForm.meaning') }}</label>
        <input id="entry-meaning" v-model="form.meaning" class="input" :placeholder="t('entryForm.meaningPlaceholder')" />
      </div>

      <div class="field">
        <label for="entry-explanation">{{ t('entryForm.explanation') }}</label>
        <textarea
          id="entry-explanation"
          v-model="form.explanation"
          class="textarea"
          rows="3"
          :placeholder="t('entryForm.explanationPlaceholder')"
        />
      </div>

      <div class="field">
        <label for="entry-examples">{{ t('entryForm.examples') }}</label>
        <textarea
          id="entry-examples"
          v-model="form.examplesText"
          class="textarea"
          rows="3"
          placeholder="She stayed up late to make up for lost time."
        />
      </div>

      <div class="field">
        <label for="entry-notes">{{ t('entryForm.notes') }}</label>
        <textarea
          id="entry-notes"
          v-model="form.notes"
          class="textarea"
          rows="2"
          :placeholder="t('entryForm.notesPlaceholder')"
        />
      </div>

      <div class="field">
        <label for="entry-tags">{{ t('entryForm.tags') }}</label>
        <input id="entry-tags" v-model="form.tagsText" class="input" :placeholder="t('entryForm.tagsPlaceholder')" />
      </div>

      <label class="check-row">
        <input v-model="form.reviewEnabled" type="checkbox" />
        <span>
          {{ t('entryForm.reviewEnabled') }}
          <small>{{ t('entryForm.reviewEnabledHint') }}</small>
        </span>
      </label>

      <p v-if="error" class="banner banner-error">{{ error }}</p>
      <p class="hint">{{ t('entryForm.reviewHint') }}</p>
    </form>

    <template #footer>
      <button class="btn btn-ghost" type="button" @click="emit('close')">{{ t('common.cancel') }}</button>
      <button class="btn btn-primary" type="button" :disabled="saving" @click="submit">
        <Icon :name="saving ? 'refresh' : 'check'" :size="16" />
        {{ saving ? t('common.saving') : entry ? t('entryForm.saveChanges') : t('entryForm.add') }}
      </button>
    </template>
  </BaseModal>
</template>

<style scoped>
.entry-form {
  display: flex;
  flex-direction: column;
  gap: 18px;
}
.type-picker {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
}
.type-option {
  display: flex;
  flex-direction: column;
  gap: 3px;
  align-items: flex-start;
  padding: 12px 14px;
  border: 0;
  border-radius: var(--radius-sm);
  background: var(--bg);
  color: var(--ink-soft);
  text-align: left;
  box-shadow: var(--shadow-raised-sm);
  transition: box-shadow var(--transition), color var(--transition);
}
.type-option small {
  color: var(--muted);
  font-size: 11px;
}
.type-option:hover {
  box-shadow: var(--shadow-hover-sm);
}
.type-option:active {
  box-shadow: var(--shadow-pressed);
}
.type-option.active {
  box-shadow: var(--shadow-pressed);
  color: var(--accent-strong);
}
.type-option.active small {
  color: var(--accent-strong);
}
.check-row {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  font-size: 13px;
  color: var(--ink-soft);
  font-weight: 500;
  cursor: pointer;
}
.check-row input {
  margin-top: 3px;
  flex: 0 0 auto;
}
.check-row span {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.check-row small {
  font-size: 11.5px;
  color: var(--muted);
  font-weight: 400;
  line-height: 1.5;
}
</style>
