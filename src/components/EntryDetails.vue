<script setup lang="ts">
import type { Entry } from '@shared/types'
import ClickableText from '@/components/ClickableText.vue'
import { t } from '@/i18n'

withDefaults(
  defineProps<{
    entry: Entry
    showPhonetic?: boolean
    showImages?: boolean
    showTags?: boolean
    /** 详细预览里允许点击单词 */
    interactive?: boolean
    selectedWord?: string | null
  }>(),
  {
    showPhonetic: true,
    showImages: true,
    showTags: true,
    interactive: false,
    selectedWord: null,
  },
)

const emit = defineEmits<{
  selectWord: [word: string]
  openWord: [word: string]
}>()
</script>

<template>
  <div class="entry-details">
    <p v-if="showPhonetic && entry.phonetic" class="entry-phonetic">{{ entry.phonetic }}</p>

    <div v-if="showImages && entry.images.length" class="entry-images">
      <img
        v-for="src in entry.images"
        :key="src"
        :src="src"
        :alt="t('learn.imageAlt')"
        loading="lazy"
      />
    </div>

    <div v-if="entry.meaning" class="detail-block">
      <h3>{{ t('learn.meaning') }}</h3>
      <p class="pre-wrap">{{ entry.meaning }}</p>
    </div>

    <div v-if="entry.englishDefinition" class="detail-block">
      <h3>{{ t('learn.englishDefinition') }}</h3>
      <p v-if="!interactive" class="english-def">{{ entry.englishDefinition }}</p>
      <p v-else class="english-def">
        <ClickableText
          :text="entry.englishDefinition"
          :selected="selectedWord"
          @select="emit('selectWord', $event)"
          @open="emit('openWord', $event)"
        />
      </p>
    </div>

    <div v-if="entry.explanation" class="detail-block">
      <h3>{{ t('learn.explanation') }}</h3>
      <p v-if="!interactive" class="pre-wrap">{{ entry.explanation }}</p>
      <p v-else class="pre-wrap">
        <ClickableText
          :text="entry.explanation"
          :selected="selectedWord"
          @select="emit('selectWord', $event)"
          @open="emit('openWord', $event)"
        />
      </p>
    </div>

    <div v-if="entry.examples.length" class="detail-block">
      <div class="detail-head">
        <h3>{{ t('learn.examples') }}</h3>
        <slot name="examples-action" />
      </div>
      <ul>
        <li v-for="(example, index) in entry.examples" :key="index">
          <ClickableText
            v-if="interactive"
            :text="example"
            :selected="selectedWord"
            @select="emit('selectWord', $event)"
            @open="emit('openWord', $event)"
          />
          <template v-else>{{ example }}</template>
        </li>
      </ul>
    </div>

    <div v-if="entry.notes" class="detail-block">
      <h3>{{ t('learn.notes') }}</h3>
      <p class="pre-wrap">{{ entry.notes }}</p>
    </div>

    <div v-if="showTags && entry.tags.length" class="entry-tags">
      <span v-for="tag in entry.tags" :key="tag" class="tag">{{ tag }}</span>
    </div>
  </div>
</template>

<style scoped>
.entry-details {
  display: flex;
  flex-direction: column;
  gap: 18px;
  width: 100%;
  text-align: left;
}
.entry-phonetic {
  margin: 0;
  color: var(--muted);
  font-size: 14px;
  letter-spacing: 0.01em;
}
.entry-images {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}
.entry-images img {
  max-width: min(100%, 280px);
  max-height: 220px;
  object-fit: contain;
  border-radius: var(--radius-sm);
  background: var(--bg);
  box-shadow: var(--shadow-raised-sm);
}
.detail-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 6px;
}
.detail-block h3 {
  margin: 0 0 6px;
  font-size: 12px;
  font-weight: 600;
  color: var(--muted);
}
.detail-head h3 {
  margin-bottom: 0;
}
.detail-block p,
.detail-block ul {
  margin: 0;
  font-size: 14.5px;
  line-height: 1.7;
  color: var(--ink-soft);
}
.detail-block ul {
  padding-left: 1.15em;
}
.detail-block li + li {
  margin-top: 4px;
}
.english-def {
  overflow-wrap: anywhere;
}
.pre-wrap {
  white-space: pre-wrap;
}
.entry-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
@media (max-width: 520px) {
  .entry-images img {
    max-width: 100%;
    max-height: 180px;
  }
}
</style>
