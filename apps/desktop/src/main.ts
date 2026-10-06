import { flushSync, mount } from 'svelte';

async function start() {
  try {
    const [{ default: App }] = await Promise.all([
      import('./App.svelte'),
      import('./styles.css'),
    ]);
    flushSync(() => mount(App, { target: document.getElementById('app')! }));
    window.dispatchEvent(new Event('xtools:mounted'));
  } catch (error) {
    console.error('Failed to start XTools', error);
    window.dispatchEvent(new Event('xtools:startup-error'));
  }
}

void start();
