<script setup lang="ts">
import { computed } from 'vue'

const props = withDefaults(
  defineProps<{ name: string; size?: number; strokeWidth?: number }>(),
  { size: 20, strokeWidth: 1.8 },
)

const icons: Record<string, string[]> = {
  home: ['M3 10.5 12 3l9 7.5', 'M5 9.5V21h5v-6h4v6h5V9.5'],
  chat: ['M21 11.5a8.5 8.5 0 0 1-8.5 8.5H8l-4 2.5V16.5A8.5 8.5 0 1 1 21 11.5Z'],
  review: [
    'M4 5.5A2.5 2.5 0 0 1 6.5 3H18a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6.5A2.5 2.5 0 0 1 4 18.5v-13Z',
    'M8 7h8',
    'M8 11h5',
    'M8 15h7',
  ],
  'book-open': [
    'M12 6.5C10.5 5 8.5 4 6 4H3v14h4c2 0 3.5.7 5 2 1.5-1.3 3-2 5-2h4V4h-3c-2.5 0-4.5 1-6 2.5Z',
    'M12 6.5V20',
  ],
  library: ['M4 4h4v16H4z', 'M10 4h4v16h-4z', 'M16.5 5.2l3.6 14.1'],
  settings: ['M4 6h16', 'M4 12h16', 'M4 18h16', 'M9 4v4', 'M15 10v4', 'M7 16v4'],
  plus: ['M12 5v14', 'M5 12h14'],
  search: ['M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z', 'm21 21-4.3-4.3'],
  trash: ['M4 7h16', 'M9 7V4h6v3', 'M6 7l1 14h10l1-14', 'M10 11v6', 'M14 11v6'],
  edit: ['M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17v3Z', 'M14.5 7.5l2 2'],
  volume: [
    'M11 5 6 9H3v6h3l5 4V5Z',
    'M15.5 9a4 4 0 0 1 0 6',
    'M18 6.5a8 8 0 0 1 0 11',
  ],
  send: ['M22 2 11 13', 'M22 2 15 22l-4-9-9-4 20-7Z'],
  sparkles: [
    'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3Z',
    'M19 15l.9 2.6L22 18.5l-2.1.9L19 22l-.9-2.6-2.1-.9 2.1-.9L19 15Z',
  ],
  check: ['m5 13 4 4L19 7'],
  x: ['M6 6l12 12', 'M18 6 6 18'],
  clock: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z', 'M12 7v5l3 2'],
  'chevron-left': ['m15 18-6-6 6-6'],
  'chevron-right': ['m9 18 6-6-6-6'],
  'arrow-right': ['M5 12h14', 'm13 6 6 6-6 6'],
  refresh: [
    'M20 11a8 8 0 0 0-14.9-4M4 4v4h4',
    'M4 13a8 8 0 0 0 14.9 4M20 20v-4h-4',
  ],
  stop: ['M7 7h10v10H7z'],
  menu: ['M4 7h16', 'M4 12h16', 'M4 17h16'],
  tag: [
    'M20 13 13 20a2 2 0 0 1-2.8 0L4 13.8V4h9.8L20 10.2a2 2 0 0 1 0 2.8Z',
    'M8.5 8.5h.01',
  ],
  calendar: [
    'M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z',
    'M8 3v4',
    'M16 3v4',
    'M4 10h16',
  ],
  flame: [
    'M12 22c4 0 7-2.7 7-6.5 0-3-2-5.5-4-7 .2 2.3-1 4-2.5 4.5.4-3.5-1-6.5-3.5-8 .3 3-1.5 5-3 6.5S5 13 5 15.5C5 19.3 8 22 12 22Z',
  ],
  info: ['M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z', 'M12 11v5', 'M12 8h.01'],
  layers: ['m12 3 9 5-9 5-9-5 9-5Z', 'm3 13 9 5 9-5', 'm3 17 9 5 9-5'],
}

const paths = computed(() => icons[props.name] ?? icons.info)
</script>

<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    :stroke-width="strokeWidth"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path v-for="(d, index) in paths" :key="index" :d="d" />
  </svg>
</template>
