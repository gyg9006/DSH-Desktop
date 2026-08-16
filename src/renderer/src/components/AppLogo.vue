<script setup lang="ts">
/** 应用 Logo：与 build/icon 一致的「智能体工作台」标记（三节点协作网络 + 终端光标）。 */
withDefaults(defineProps<{ size?: number }>(), { size: 32 })
</script>

<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 48 48"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    aria-label="DSH 桌面"
  >
    <defs>
      <linearGradient id="dshw-logo-bg" x1="0" y1="0" x2="0" y2="48" gradientUnits="userSpaceOnUse">
        <stop stop-color="#2E46C8" />
        <stop offset="1" stop-color="#3B82F6" />
      </linearGradient>
    </defs>
    <rect x="1.5" y="1.5" width="45" height="45" rx="11" fill="url(#dshw-logo-bg)" />
    <!-- 连线 -->
    <path
      d="M13.5 32 L24 20.5 L34.5 32 M13.5 32 L34.5 32"
      stroke="white"
      stroke-opacity="0.55"
      stroke-width="3"
      stroke-linecap="round"
      fill="none"
    />
    <!-- 从节点 -->
    <circle cx="13.5" cy="32" r="4.6" fill="white" />
    <circle cx="13.5" cy="32" r="1.9" fill="#2E46C8" />
    <circle cx="34.5" cy="32" r="4.6" fill="white" />
    <circle cx="34.5" cy="32" r="1.9" fill="#2E46C8" />
    <!-- 主节点 -->
    <circle cx="24" cy="20.5" r="6.2" fill="white" />
    <circle cx="24" cy="20.5" r="2.5" fill="#1E2A78" />
    <!-- 终端光标 -->
    <line x1="18" y1="39.5" x2="30" y2="39.5" stroke="white" stroke-width="2.6" stroke-linecap="round" />
  </svg>
</template>
