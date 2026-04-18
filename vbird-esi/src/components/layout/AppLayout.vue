<script setup lang="ts">
/**
 * AppLayout — 主布局组件 (v2.0)
 * 紧凑侧边栏 + 面包屑内容区
 */
import { ref, computed } from 'vue'
import { useRouter, useRoute } from 'vue-router'

const router = useRouter()
const route = useRoute()

const isCollapsed = ref(false)

const menuItems = [
  { path: '/templates', title: '模板管理', icon: 'grid' },
  { path: '/projects', title: '项目管理', icon: 'folder' },
]

const activeMenu = computed(() => route.path)

function handleMenuSelect(path: string) {
  router.push(path)
}

function toggleCollapse() {
  isCollapsed.value = !isCollapsed.value
}
</script>

<template>
  <div class="app-layout">
    <!-- 侧边栏 -->
    <aside class="app-sidebar" :class="{ collapsed: isCollapsed }">
      <!-- 品牌区 — 纯文字 -->
      <div class="sidebar-header" @click="toggleCollapse">
        <span class="logo-text" v-if="!isCollapsed">ESI</span>
        <span class="logo-text mini" v-else>E</span>
      </div>

      <!-- 导航 -->
      <nav class="sidebar-nav">
        <div
          v-for="item in menuItems"
          :key="item.path"
          class="nav-item"
          :class="{ active: activeMenu.startsWith(item.path) }"
          @click="handleMenuSelect(item.path)"
        >
          <!-- SVG icons inline, no emoji -->
          <svg v-if="item.icon === 'grid'" class="nav-icon" viewBox="0 0 20 20" fill="none">
            <rect x="2" y="2" width="7" height="7" rx="1.5" stroke="currentColor" stroke-width="1.5"/>
            <rect x="11" y="2" width="7" height="7" rx="1.5" stroke="currentColor" stroke-width="1.5"/>
            <rect x="2" y="11" width="7" height="7" rx="1.5" stroke="currentColor" stroke-width="1.5"/>
            <rect x="11" y="11" width="7" height="7" rx="1.5" stroke="currentColor" stroke-width="1.5"/>
          </svg>
          <svg v-else-if="item.icon === 'folder'" class="nav-icon" viewBox="0 0 20 20" fill="none">
            <path d="M2 5a1.5 1.5 0 011.5-1.5H8l1.5 2h7A1.5 1.5 0 0118 7v8.5A1.5 1.5 0 0116.5 17h-13A1.5 1.5 0 012 15.5V5z" stroke="currentColor" stroke-width="1.5"/>
          </svg>
          <transition name="fade">
            <span v-if="!isCollapsed" class="nav-label">{{ item.title }}</span>
          </transition>
        </div>
      </nav>

      <!-- 底部折叠 -->
      <div class="sidebar-footer">
        <div class="nav-item collapse-btn" @click="toggleCollapse">
          <svg class="nav-icon" viewBox="0 0 20 20" fill="none">
            <path v-if="!isCollapsed" d="M12 4l-6 6 6 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            <path v-else d="M8 4l6 6-6 6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
          <transition name="fade">
            <span v-if="!isCollapsed" class="nav-label">收起</span>
          </transition>
        </div>
      </div>
    </aside>

    <!-- 主内容区 -->
    <main class="app-main">
      <router-view v-slot="{ Component }">
        <transition name="fade" mode="out-in">
          <component :is="Component" />
        </transition>
      </router-view>
    </main>
  </div>
</template>

<style scoped>
.app-layout {
  display: flex;
  width: 100%;
  height: 100vh;
  background: var(--bg-app);
}

/* ---- 侧边栏 ---- */
.app-sidebar {
  width: var(--sidebar-width);
  height: 100%;
  background: var(--bg-sidebar);
  border-right: 1px solid var(--border-color);
  display: flex;
  flex-direction: column;
  transition: width var(--transition-normal);
  overflow: hidden;
  flex-shrink: 0;
}

.app-sidebar.collapsed { width: var(--sidebar-collapsed-width); }

/* 品牌区 — 纯文字 ESI */
.sidebar-header {
  height: var(--header-height);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  border-bottom: 1px solid var(--border-color);
  flex-shrink: 0;
}

.logo-text {
  font-size: 20px;
  font-weight: 800;
  letter-spacing: 0.08em;
  color: var(--text-primary);
}

.logo-text.mini {
  font-size: 18px;
}

/* 导航 */
.sidebar-nav {
  flex: 1;
  padding: var(--space-sm);
  display: flex;
  flex-direction: column;
  gap: 2px;
  overflow-y: auto;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  padding: 8px 10px;
  border-radius: var(--radius-md);
  cursor: pointer;
  color: var(--text-secondary);
  transition: all var(--transition-fast);
  white-space: nowrap;
  position: relative;
}

.nav-item:hover { background: var(--bg-card-hover); color: var(--text-primary); }

.nav-item.active {
  background: var(--color-primary-bg);
  color: var(--color-primary);
}

.nav-item.active::before {
  content: '';
  position: absolute;
  left: 0;
  top: 50%;
  transform: translateY(-50%);
  width: 3px;
  height: 55%;
  background: var(--color-primary);
  border-radius: 0 2px 2px 0;
}

.nav-icon { width: 18px; height: 18px; flex-shrink: 0; }
.nav-label { font-size: 13px; font-weight: 500; }

/* 底部 */
.sidebar-footer {
  padding: var(--space-sm);
  border-top: 1px solid var(--border-color);
  flex-shrink: 0;
}

.collapse-btn { color: var(--text-tertiary) !important; }

/* ---- 主内容区 ---- */
.app-main {
  flex: 1;
  overflow: auto;
  padding: var(--space-lg);
  background: var(--bg-app);
}
</style>
