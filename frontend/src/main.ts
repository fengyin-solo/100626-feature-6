import { createApp } from 'vue'
import { createPinia } from 'pinia'

import App from './App.vue'
import router from './router'
import { runMigrations } from './data/migrations'
import './styles/global.css'

// 存量迁移必须在首屏取数之前按版本顺序跑完：流域改名归一、历史投运回填、状态列对齐。
runMigrations()

const app = createApp(App)
app.use(createPinia())
app.use(router)
app.mount('#app')
