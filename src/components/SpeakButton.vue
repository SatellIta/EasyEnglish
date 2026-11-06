<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'
import Icon from '@/components/Icon.vue'
import { t } from '@/i18n'
import { speak, speechSupported, stopSpeaking } from '@/lib/speech'

const props = defineProps<{ text: string; size?: number }>()

const speaking = ref(false)
const failed = ref(false)
const supported = speechSupported()

const label = computed(() => {
  if (!supported || failed.value) return t('speak.unsupported')
  return speaking.value ? t('speak.stop') : t('speak.speak')
})

function onClick() {
  if (speaking.value) {
    stopSpeaking()
    speaking.value = false
    return
  }

  failed.value = false
  const ok = speak(props.text, {
    onStart: () => {
      speaking.value = true
    },
    onEnd: () => {
      speaking.value = false
    },
    onError: () => {
      speaking.value = false
      failed.value = true
    },
  })
  if (!ok) failed.value = true
}

onBeforeUnmount(() => {
  if (speaking.value) stopSpeaking()
})
</script>

<template>
  <button
    class="icon-btn"
    :class="{ speaking, failed: !supported || failed }"
    type="button"
    :title="label"
    :aria-label="label"
    :aria-pressed="speaking"
    @click.stop="onClick"
  >
    <Icon :name="speaking ? 'stop' : 'volume'" :size="size ?? 18" />
  </button>
</template>

<style scoped>
.icon-btn.speaking {
  color: var(--accent-strong);
  box-shadow: var(--shadow-pressed);
}
.icon-btn.failed {
  color: var(--muted);
}
</style>
