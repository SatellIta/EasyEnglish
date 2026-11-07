import { createRouter, createWebHistory } from 'vue-router'

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/today' },
    { path: '/today', name: 'today', component: () => import('@/pages/TodayPage.vue') },
    { path: '/learn', name: 'learn', component: () => import('@/pages/LearnPage.vue') },
    { path: '/chat/:id?', name: 'chat', component: () => import('@/pages/ChatPage.vue') },
    { path: '/review', name: 'review', component: () => import('@/pages/ReviewPage.vue') },
    { path: '/library', name: 'library', component: () => import('@/pages/LibraryPage.vue') },
    { path: '/import', name: 'import', component: () => import('@/pages/ImportMarkdownPage.vue') },
    { path: '/settings', name: 'settings', component: () => import('@/pages/SettingsPage.vue') },
    { path: '/:pathMatch(.*)*', redirect: '/today' },
  ],
  scrollBehavior() {
    return { top: 0 }
  },
})
