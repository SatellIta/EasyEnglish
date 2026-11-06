<script setup lang="ts">
import Icon from '@/components/Icon.vue'
import { speak } from '@/lib/speech'

const props = defineProps<{ text: string; size?: number }>()

function onClick() {
  speak(props.text)
}
</script>

<template>
  <button class="icon-btn" type="button" title="朗读" aria-label="朗读英文" @click.stop="onClick">
    <Icon name="volume" :size="size ?? 18" />
  </button>
</template>
