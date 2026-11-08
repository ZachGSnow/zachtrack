import { mount } from 'svelte'
import './app.css'
import App from './App.svelte'
import { themeStore } from './lib/stores/theme.svelte'

// A fixed light or dark choice applies before the first paint.
themeStore.init()

const app = mount(App, {
  target: document.getElementById('app')!,
})

export default app
