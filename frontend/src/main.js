import { createApp } from 'vue'
import 'uplot/dist/uPlot.min.css'
import './styles/theme.css'
import './theme.js' // applies the saved/preferred theme on load
import App from './App.vue'

createApp(App).mount('#app')
