<script setup lang="ts">
import { onMounted, watch } from 'vue'
import { RouterLink, RouterView, useRoute } from 'vue-router'
import Icon from '@/components/Icon.vue'
import { useAppStore } from '@/stores/app'

const store = useAppStore()
const route = useRoute()

const nav = [
  { to: '/today', label: '今日', icon: 'calendar' },
  { to: '/chat', label: '对话', icon: 'chat' },
  { to: '/review', label: '复习', icon: 'review', badge: true },
  { to: '/library', label: '词库', icon: 'book-open' },
  { to: '/settings', label: '设置', icon: 'settings' },
]

function refresh() {
  store.refreshStats().catch(() => {})
}

onMounted(() => {
  refresh()
  store.loadSettings().catch(() => {})
})

watch(
  () => route.fullPath,
  () => refresh(),
)
</script>

<template>
  <div class="app-shell">
    <aside class="sidebar">
      <RouterLink to="/today" class="brand">
        <span class="brand-mark">E</span>
        <span class="brand-text">
          <strong>EasyEnglish</strong>
          <small>把英语学成自己的</small>
        </span>
      </RouterLink>

      <nav class="nav">
        <RouterLink
          v-for="item in nav"
          :key="item.to"
          :to="item.to"
          class="nav-item"
          :class="{ active: route.path.startsWith(item.to) }"
          :title="item.label"
        >
          <Icon :name="item.icon" :size="19" />
          <span class="nav-label">{{ item.label }}</span>
          <span v-if="item.badge && store.dueTotal > 0" class="nav-badge">{{ store.dueTotal }}</span>
        </RouterLink>
      </nav>

      <div class="sidebar-note">
        <Icon name="sparkles" :size="16" />
        <p>
          艾宾浩斯复习
          <span>{{ store.stats?.reviewedToday ?? 0 }} 条今日已复习</span>
        </p>
      </div>
    </aside>

    <main class="main">
      <RouterView />
    </main>
  </div>
</template>
