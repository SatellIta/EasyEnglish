<script setup lang="ts">
import { reactive, ref, watch } from 'vue'
import type { Entry, EntryInput, EntryType } from '@shared/types'
import { api, errorMessage } from '@/lib/api'
import BaseModal from '@/components/BaseModal.vue'
import Icon from '@/components/Icon.vue'

const props = defineProps<{ open: boolean; entry?: Entry | null }>()
const emit = defineEmits<{ close: []; saved: [entry: Entry] }>()

const form = reactive({
  type: 'word' as EntryType,
  text: '',
  meaning: '',
  explanation: '',
  examplesText: '',
  notes: '',
  tagsText: '',
})
const saving = ref(false)
const error = ref('')

const typeOptions: Array<{ value: EntryType; label: string; hint: string }> = [
  { value: 'word', label: '单词', hint: '单个词' },
  { value: 'phrase', label: '短语', hint: '固定搭配' },
  { value: 'sentence', label: '句子', hint: '整句表达' },
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
    error.value = '请填写英文内容'
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
  }

  try {
    const entry = props.entry
      ? await api.entries.update(props.entry.id, input)
      : await api.entries.create(input)
    emit('saved', entry)
    emit('close')
  } catch (caught) {
    error.value = errorMessage(caught)
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <BaseModal
    :open="open"
    :title="entry ? '编辑词条' : '添加词条'"
    width="620px"
    @close="emit('close')"
  >
    <form class="entry-form" @submit.prevent="submit">
      <div class="field">
        <label>类型</label>
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
            <strong>{{ option.label }}</strong>
            <small>{{ option.hint }}</small>
          </button>
        </div>
      </div>

      <div class="field">
        <label for="entry-text">英文内容</label>
        <textarea
          id="entry-text"
          v-model="form.text"
          class="textarea"
          rows="2"
          placeholder="例如：make up for lost time"
        />
      </div>

      <div class="field">
        <label for="entry-meaning">中文含义</label>
        <input id="entry-meaning" v-model="form.meaning" class="input" placeholder="简洁的中文释义 / 翻译" />
      </div>

      <div class="field">
        <label for="entry-explanation">解释与用法</label>
        <textarea
          id="entry-explanation"
          v-model="form.explanation"
          class="textarea"
          rows="3"
          placeholder="搭配、语域、易混点、记忆联想……"
        />
      </div>

      <div class="field">
        <label for="entry-examples">例句（每行一条）</label>
        <textarea
          id="entry-examples"
          v-model="form.examplesText"
          class="textarea"
          rows="3"
          placeholder="She stayed up late to make up for lost time."
        />
      </div>

      <div class="field">
        <label for="entry-notes">个人笔记</label>
        <textarea
          id="entry-notes"
          v-model="form.notes"
          class="textarea"
          rows="2"
          placeholder="在哪里遇到的？为什么想记下来？"
        />
      </div>

      <div class="field">
        <label for="entry-tags">标签（逗号分隔）</label>
        <input id="entry-tags" v-model="form.tagsText" class="input" placeholder="口语, 商务, 易混" />
      </div>

      <p v-if="error" class="banner banner-error">{{ error }}</p>
      <p class="hint">保存后会立即进入复习队列，并按艾宾浩斯曲线安排下一次复习。</p>
    </form>

    <template #footer>
      <button class="btn btn-ghost" type="button" @click="emit('close')">取消</button>
      <button class="btn btn-primary" type="button" :disabled="saving" @click="submit">
        <Icon :name="saving ? 'refresh' : 'check'" :size="16" />
        {{ saving ? '保存中…' : entry ? '保存修改' : '添加词条' }}
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
</style>
