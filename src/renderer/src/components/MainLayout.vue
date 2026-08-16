<script setup lang="ts">
import Sidebar from './Sidebar.vue'
import ChatView from './ChatView.vue'
</script>

<template>
  <div class="flex h-full w-full overflow-hidden">
    <Sidebar />
    <main class="min-w-0 flex-1">
      <ChatView />
    </main>
  </div>
</template>
