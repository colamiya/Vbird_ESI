<script setup lang="ts">
/**
 * App.vue — 根组件，使用 AppLayout 作为主布局
 */
import AppLayout from './components/layout/AppLayout.vue'
import { onMounted } from 'vue'

onMounted(() => {
  // 禁用浏览器默认右键菜单（Tauri WebView 内不需要）
  document.addEventListener('contextmenu', (e) => e.preventDefault())
})
</script>

<template>
  <div class="app-root">
    <AppLayout />
  </div>
</template>

<style scoped>
.app-root {
  width: 100%;
  height: 100%;
}
</style>