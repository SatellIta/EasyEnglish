<script setup lang="ts">
import type { EntryType } from '@shared/types'
import { ENTRY_TYPE_LABELS } from '@shared/types'

defineProps<{ type: EntryType }>()
</script>

<template>
  <span class="type-badge" :class="`type-${type}`">{{ ENTRY_TYPE_LABELS[type] }}</span>
</template>
