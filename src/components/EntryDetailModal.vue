<script setup lang="ts">
import type { Entry } from '@shared/types'
import BaseModal from '@/components/BaseModal.vue'
import EntryDetails from '@/components/EntryDetails.vue'
import Icon from '@/components/Icon.vue'
import SpeakButton from '@/components/SpeakButton.vue'
import TypeBadge from '@/components/TypeBadge.vue'
import { t } from '@/i18n'

defineProps<{ entry: Entry | null }>()

const emit = defineEmits<{
  close: []
  edit: [entry: Entry]
}>()
</script>

<template>
  <BaseModal
    :open="Boolean(entry)"
    :title="t('library.detail.title')"
    width="680px"
    @close="emit('close')"
  >
    <div v-if="entry" class="entry-detail">
      <div class="detail-title">
        <TypeBadge :type="entry.type" />
        <h2>{{ entry.text }}</h2>
        <SpeakButton :text="entry.text" :size="20" />
      </div>
      <EntryDetails :entry="entry" />
    </div>

    <template #footer>
      <div v-if="entry" class="detail-actions">
        <button class="btn btn-ghost" type="button" @click="emit('close')">
          {{ t('common.close') }}
        </button>
        <button class="btn btn-primary" type="button" @click="emit('edit', entry)">
          <Icon name="edit" :size="16" /> {{ t('library.detail.edit') }}
        </button>
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
</style>
