<script setup lang="ts">
import type { EntryType } from '@shared/types'
import { entryTypeLabel } from '@/i18n'

defineProps<{ type: EntryType }>()
</script>

<template>
  <span class="type-badge" :class="`type-${type}`">{{ entryTypeLabel(type) }}</span>
</template>
