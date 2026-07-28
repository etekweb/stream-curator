import { createRouter, createWebHistory } from 'vue-router';
import DashboardView from '../views/DashboardView.vue';
import StreamerView from '../views/StreamerView.vue';

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/',
      name: 'dashboard',
      component: DashboardView,
    },
    {
      path: '/streamer/:id',
      name: 'streamer',
      component: StreamerView,
      props: true,
    },
  ],
});
