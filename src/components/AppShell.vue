<script setup lang="ts">
import { onMounted, watch } from 'vue'
import { RouterLink, RouterView, useRoute } from 'vue-router'
import Icon from '@/components/Icon.vue'
import SummaryJobHost from '@/components/SummaryJobHost.vue'
import { useAppStore } from '@/stores/app'
import { useThemeStore } from '@/stores/theme'

const store = useAppStore()
const themeStore = useThemeStore()
const route = useRoute()

const nav = [
  { to: '/today', label: '今日', icon: 'calendar' },
  { to: '/chat', label: '对话', icon: 'chat' },
  { to: '/review', label: '复习', icon: 'review', badge: true },
  { to: '/library', label: '词库', icon: 'book-open' },
]

function refresh() {
  store.refreshStats().catch(() => {})
}

onMounted(() => {
  themeStore.initTheme()
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
          :aria-label="item.label"
          :aria-current="route.path.startsWith(item.to) ? 'page' : undefined"
        >
          <Icon :name="item.icon" :size="19" />
          <span class="nav-label">{{ item.label }}</span>
          <span v-if="item.badge && store.dueTotal > 0" class="nav-badge">{{ store.dueTotal }}</span>
        </RouterLink>
      </nav>

      <div class="sidebar-bottom">
        <div class="sidebar-note">
          <Icon name="sparkles" :size="16" />
          <p>
            艾宾浩斯复习
            <span>{{ store.stats?.reviewedToday ?? 0 }} 条今日已复习</span>
          </p>
        </div>

        <div class="sidebar-actions">
          <RouterLink
            to="/settings"
            class="nav-item settings-link"
            :class="{ active: route.path.startsWith('/settings') }"
            title="设置"
            aria-label="设置"
            :aria-current="route.path.startsWith('/settings') ? 'page' : undefined"
          >
            <Icon name="settings" :size="19" />
            <span class="nav-label">设置</span>
          </RouterLink>
          <button
            class="icon-btn theme-toggle"
            type="button"
            :title="themeStore.isSwiss ? '切换到新拟物派' : '切换到瑞士国际风格'"
            :aria-label="themeStore.isSwiss ? '切换到新拟物派' : '切换到瑞士国际风格'"
            @click="themeStore.toggleTheme()"
          >
            <Icon name="theme" :size="18" />
          </button>
        </div>
      </div>
    </aside>

    <main class="main">
      <RouterView />
    </main>

    <SummaryJobHost />
  </div>
</template>

<style scoped>
.sidebar-bottom {
  margin-top: auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.sidebar-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
.settings-link {
  flex: 1;
}
@media (max-width: 900px) {
  .sidebar-bottom {
    margin-top: 0;
    flex-direction: row;
    align-items: center;
  }
  .settings-link {
    flex: 0 0 auto;
  }
}
</style>
