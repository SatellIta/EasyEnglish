<script setup lang="ts">
import { onBeforeUnmount, watch } from 'vue'
import Icon from '@/components/Icon.vue'
import { t } from '@/i18n'

const props = withDefaults(defineProps<{ open: boolean; title?: string; width?: string }>(), {
  width: '560px',
})
const emit = defineEmits<{ close: [] }>()

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') emit('close')
}

watch(
  () => props.open,
  (open) => {
    if (open) {
      document.addEventListener('keydown', onKeydown)
      document.body.style.overflow = 'hidden'
    } else {
      document.removeEventListener('keydown', onKeydown)
      document.body.style.overflow = ''
    }
  },
)

onBeforeUnmount(() => {
  document.removeEventListener('keydown', onKeydown)
  document.body.style.overflow = ''
})
</script>

<template>
  <Teleport to="body">
    <Transition name="modal">
      <div v-if="open" class="modal-overlay" @click.self="emit('close')">
        <div class="modal-card" :style="{ maxWidth: width }" role="dialog" aria-modal="true">
          <header class="modal-head">
            <h2>{{ title }}</h2>
            <button class="icon-btn" type="button" :aria-label="t('common.close')" @click="emit('close')">
              <Icon name="x" :size="18" />
            </button>
          </header>
          <div class="modal-body">
            <slot />
          </div>
          <footer v-if="$slots.footer" class="modal-foot">
            <slot name="footer" />
          </footer>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
