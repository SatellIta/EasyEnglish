<script setup lang="ts">
import { computed } from 'vue'
import { marked } from 'marked'
import DOMPurify from 'dompurify'

const props = defineProps<{ content: string }>()

marked.setOptions({ gfm: true, breaks: true })

const html = computed(() => {
  const rendered = marked.parse(props.content, { async: false }) as string
  return DOMPurify.sanitize(rendered, { USE_PROFILES: { html: true } })
})
</script>

<template>
  <div class="markdown" v-html="html" />
</template>
