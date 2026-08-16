<script setup lang="ts">
/** 设置页 Tab 的统一空壳：展示标题、说明与本模块计划开放的功能清单。 */
defineProps<{
  title: string
  desc: string
  /** 该 Tab 计划开放的功能（简体中文）。 */
  planned: string[]
}>()
</script>

<template>
  <div>
    <h3 class="text-base font-semibold text-gray-800 dark:text-gray-100">{{ title }}</h3>
    <p class="mt-1 text-xs leading-relaxed text-gray-500 dark:text-gray-400">{{ desc }}</p>

    <div
      class="mt-6 rounded-xl border border-dashed border-gray-300 p-6 text-center dark:border-gray-600"
    >
      <p class="text-sm text-gray-500 dark:text-gray-400">「{{ title }}」将在后续里程碑中开放</p>
      <div class="mx-auto mt-4 max-w-md text-left">
        <ul class="space-y-1.5">
          <li
            v-for="feature in planned"
            :key="feature"
            class="flex items-start gap-2 text-xs text-gray-500 dark:text-gray-400"
          >
            <span class="mt-0.5 text-brand">●</span>
            <span>{{ feature }}</span>
          </li>
        </ul>
      </div>
    </div>
  </div>
</template>
