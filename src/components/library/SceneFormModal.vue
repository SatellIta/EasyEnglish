<script setup lang="ts">
import { reactive, ref, watch } from 'vue'
import type { Scene, SceneSummary } from '@shared/types'
import BaseModal from '@/components/BaseModal.vue'
import Icon from '@/components/Icon.vue'
import { t } from '@/i18n'
import { api, errorMessage } from '@/lib/api'

const props = defineProps<{ open: boolean; scene?: SceneSummary | null }>()
const emit = defineEmits<{ close: []; saved: [scene: Scene] }>()

const form = reactive({ name: '', description: '' })
const saving = ref(false)
const error = ref('')

watch(
  () => props.open,
  (open) => {
    if (!open) return
    form.name = props.scene?.name ?? ''
    form.description = props.scene?.description ?? ''
    error.value = ''
  },
)

async function submit() {
  if (!form.name.trim()) {
    error.value = t('scene.form.nameRequired')
    return
  }
  saving.value = true
  error.value = ''
  try {
    const input = {
      name: form.name.trim(),
      description: form.description.trim() || null,
    }
    const scene = props.scene
      ? await api.scenes.update(props.scene.id, input)
      : await api.scenes.create(input)
    emit('saved', scene)
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
    :title="scene ? t('scene.form.edit') : t('scene.form.new')"
    width="520px"
    @close="emit('close')"
  >
    <form class="scene-form" @submit.prevent="submit">
      <div class="field">
        <label for="scene-name">{{ t('scene.form.name') }}</label>
        <input
          id="scene-name"
          v-model="form.name"
          class="input"
          :placeholder="t('scene.form.namePlaceholder')"
          maxlength="60"
        />
      </div>
      <div class="field">
        <label for="scene-description">{{ t('scene.form.description') }}</label>
        <textarea
          id="scene-description"
          v-model="form.description"
          class="textarea"
          rows="3"
          :placeholder="t('scene.form.descriptionPlaceholder')"
          maxlength="500"
        />
      </div>
      <p v-if="error" class="banner banner-error">{{ error }}</p>
    </form>

    <template #footer>
      <button class="btn btn-ghost" type="button" @click="emit('close')">{{ t('common.cancel') }}</button>
      <button class="btn btn-primary" type="button" :disabled="saving" @click="submit">
        <Icon :name="saving ? 'refresh' : 'check'" :size="16" />
        {{ saving ? t('common.saving') : scene ? t('scene.form.saveChanges') : t('scene.form.create') }}
      </button>
    </template>
  </BaseModal>
</template>

<style scoped>
.scene-form {
  display: flex;
  flex-direction: column;
  gap: 18px;
}
</style>
