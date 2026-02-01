import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'Cortex',
    description: 'Save anything to your AI memory. Never forget what matters.',
    permissions: [
      'storage',
      'activeTab',
      'scripting',
      'contextMenus',
    ],
    host_permissions: [
      'https://*/*',
      'http://*/*',
    ],
    action: {
      default_title: 'Save to Cortex',
    },
    commands: {
      '_execute_action': {
        suggested_key: {
          default: 'Ctrl+Shift+S',
          mac: 'Command+Shift+S',
        },
        description: 'Save current page to Cortex',
      },
      'quick_save': {
        suggested_key: {
          default: 'Ctrl+Shift+C',
          mac: 'Command+Shift+C',
        },
        description: 'Quick save selection to Cortex',
      },
    },
  },
});
