/**
 * Vbird ESI — 路由配置
 */

import { createRouter, createWebHashHistory } from 'vue-router'

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    {
      path: '/',
      redirect: '/templates',
    },
    {
      path: '/templates',
      name: 'TemplateManager',
      component: () => import('@/views/TemplateManager/TemplateManager.vue'),
      meta: { title: '模板管理', icon: 'Grid' },
    },
    {
      path: '/projects',
      name: 'ProjectManager',
      component: () => import('@/views/ProjectManager/ProjectManager.vue'),
      meta: { title: '项目管理', icon: 'FolderOpened' },
    },
    {
      path: '/project/:id',
      name: 'ProjectEditor',
      component: () => import('@/views/ProjectEditor/ProjectEditor.vue'),
      meta: { title: '数据录入', icon: 'Edit' },
    },
  ],
})

export default router
