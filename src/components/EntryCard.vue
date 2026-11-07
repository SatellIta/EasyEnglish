<script setup lang="ts">
import { computed } from 'vue'
import type { Entry } from '@shared/types'
import Icon from '@/components/Icon.vue'
import SpeakButton from '@/components/SpeakButton.vue'
import TypeBadge from '@/components/TypeBadge.vue'
import { t } from '@/i18n'
import { definitionPreview, formatDue, stageLabel, truncate } from '@/lib/format'

const props = defineProps<{
  entry: Entry
  sceneId?: number | null
  section?: string | null
  subsection?: string | null
  showSceneRefs?: boolean
  compact?: boolean
}>()

const emit = defineEmits<{
  open: [entry: Entry]
  edit: [entry: Entry]
  remove: [entry: Entry]
  removeScene: [entry: Entry]
}>()

/** 缩略释义：英文界面优先英英释义，中文界面优先中文释义。 */
const preview = computed(() =>
  definitionPreview(props.entry),
)
</script>

<template>
  <article class="lib-row entry-card card" :class="{ compact }">
    <div class="lib-main">
      <p v-if="props.section || props.subsection" class="entry-section">
        <Icon name="layers" :size="13" />
        <span v-if="props.section">{{ props.section }}</span>
        <span v-if="props.section && props.subsection" class="sep">/</span>
        <span v-if="props.subsection">{{ props.subsection }}</span>
      </p>

      <div class="row wrap lib-title">
        <TypeBadge :type="entry.type" />
        <h3>
          <button
            class="lib-title-btn"
            type="button"
            :title="t('library.detail.open')"
            @click="emit('open', entry)"
          >
            {{ entry.text }}
          </button>
        </h3>
        <SpeakButton :text="entry.text" />
      </div>

      <p v-if="entry.phonetic" class="lib-phonetic">{{ entry.phonetic }}</p>
      <p
        v-if="preview"
        class="lib-meaning"
        :class="{ english: preview.kind !== 'meaning', explanation: preview.kind === 'explanation' }"
      >
        {{ preview.text }}
      </p>
      <div v-if="entry.images.length" class="lib-images">
        <img
          v-for="src in entry.images.slice(0, compact ? 1 : 3)"
          :key="src"
          :src="src"
          :alt="t('learn.imageAlt')"
          loading="lazy"
        />
        <span v-if="entry.images.length > 1" class="tag">
          {{ t('entryCard.images', { count: entry.images.length }) }}
        </span>
      </div>
      <p v-if="entry.explanation && !compact" class="lib-explain">
        {{ truncate(entry.explanation, 180) }}
      </p>

      <div class="row wrap lib-meta">
        <span v-if="!entry.reviewEnabled" class="tag review-flag off">{{ t('entryCard.notReview') }}</span>
        <template v-if="showSceneRefs !== false">
          <span
            v-for="ref in entry.sceneRefs"
            :key="`${ref.sceneId}-${ref.section ?? ''}-${ref.subsection ?? ''}`"
            class="tag scene-tag"
          >
            # {{ ref.sceneName }}
          </span>
        </template>
        <template v-if="!compact">
          <span v-for="tag in entry.tags" :key="tag" class="tag">{{ tag }}</span>
        </template>
        <span v-if="entry.reviewEnabled && entry.review" class="muted small review-info">
          <Icon name="clock" :size="13" />
          {{ t('entryCard.nextReview', { due: formatDue(entry.review.nextReviewAt), stage: stageLabel(entry.review.stage) }) }}
        </span>
      </div>
    </div>

    <div class="lib-actions">
      <button
        v-if="props.sceneId"
        class="icon-btn"
        :title="t('entryCard.removeFromScene')"
        :aria-label="t('entryCard.removeFromScene')"
        @click="emit('removeScene', entry)"
      >
        <Icon name="x" :size="17" />
      </button>
      <button class="icon-btn" :title="t('entryCard.edit')" :aria-label="t('entryCard.edit')" @click="emit('edit', entry)">
        <Icon name="edit" :size="17" />
      </button>
      <button
        class="icon-btn danger"
        :title="t('entryCard.delete')"
        :aria-label="t('entryCard.delete')"
        @click="emit('remove', entry)"
      >
        <Icon name="trash" :size="17" />
      </button>
    </div>
  </article>
</template>

<style scoped>
.entry-card {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 20px 22px;
}
.entry-card.compact {
  padding: 13px 16px;
}
.entry-card.compact .lib-title h3 {
  font-size: 16px;
}
.entry-card.compact .lib-meaning {
  margin-top: 4px;
  font-size: 13px;
}
.entry-card.compact .lib-meta {
  margin-top: 7px;
}
.lib-main {
  min-width: 0;
  flex: 1;
}
.entry-section {
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0 0 7px;
  font-size: 11.5px;
  font-weight: 600;
  letter-spacing: 0.02em;
  color: var(--muted);
  text-transform: uppercase;
}
.entry-section .sep {
  opacity: 0.6;
}
.lib-title {
  gap: 9px;
}
.lib-title-btn {
  padding: 0;
  border: 0;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
  overflow-wrap: anywhere;
  transition: color var(--transition);
}
.lib-title-btn:hover {
  color: var(--accent-strong);
}
.lib-title h3 {
  margin: 0;
  flex: 1 1 0;
  min-width: 0;
  font-size: 19px;
  font-weight: 600;
  line-height: 1.35;
  color: var(--ink);
  overflow-wrap: anywhere;
}
.lib-meaning {
  margin: 8px 0 0;
  font-size: 14px;
  color: var(--ink-soft);
}
.lib-meaning.english {
  font-size: 13.5px;
  line-height: 1.65;
  overflow-wrap: anywhere;
}
.lib-meaning.explanation {
  color: var(--muted);
}
.lib-phonetic {
  margin: 5px 0 0;
  font-size: 12.5px;
  color: var(--muted);
}
.lib-images {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 10px;
}
.lib-images img {
  width: 54px;
  height: 54px;
  object-fit: cover;
  border-radius: var(--radius-sm);
  background: var(--bg);
  box-shadow: var(--shadow-raised-sm);
}
.entry-card.compact .lib-images img {
  width: 42px;
  height: 42px;
}
.lib-explain {
  margin: 6px 0 0;
  font-size: 13px;
  color: var(--muted);
  line-height: 1.65;
  overflow-wrap: anywhere;
}
.lib-meta {
  margin-top: 12px;
  gap: 8px;
}
.review-info {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.review-flag.off {
  color: var(--warning);
}
.scene-tag {
  color: var(--accent-strong);
}
.lib-actions {
  display: flex;
  gap: 6px;
  flex: 0 0 auto;
}
.icon-btn.danger:hover {
  color: var(--danger);
}
@media (max-width: 560px) {
  .entry-card {
    flex-direction: column;
  }
  .lib-actions {
    align-self: flex-end;
  }
}
</style>
