/**
 * Background Service Worker
 * Handles context menu, keyboard shortcuts, and API calls
 */

export default defineBackground(() => {
  console.log('Cortex background worker started');

  // Create context menu on install
  browser.runtime.onInstalled.addListener(() => {
    browser.contextMenus.create({
      id: 'save-to-cortex',
      title: 'Save to Cortex',
      contexts: ['page', 'selection', 'link'],
    });

    browser.contextMenus.create({
      id: 'save-selection',
      title: 'Save selection to Cortex',
      contexts: ['selection'],
    });
  });

  // Handle context menu clicks
  browser.contextMenus.onClicked.addListener(async (info, tab) => {
    if (!tab?.id) return;

    if (info.menuItemId === 'save-to-cortex') {
      await saveCurrentPage(tab.id, tab);
    } else if (info.menuItemId === 'save-selection' && info.selectionText) {
      await saveSelection(tab.id, info.selectionText, tab);
    }
  });

  // Handle keyboard shortcuts
  browser.commands.onCommand.addListener(async (command) => {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) return;

    if (command === 'quick_save') {
      // Get selected text
      const results = await browser.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => window.getSelection()?.toString() || '',
      });
      const selection = results[0]?.result;
      if (selection) {
        await saveSelection(tab.id, selection, tab);
      } else {
        await saveCurrentPage(tab.id, tab);
      }
    }
  });

  // Listen for messages from popup/content scripts
  browser.runtime.onMessage.addListener(async (message, sender) => {
    if (message.type === 'SAVE_PAGE') {
      const tab = sender.tab || (await browser.tabs.query({ active: true, currentWindow: true }))[0];
      if (tab?.id) {
        await saveCurrentPage(tab.id, tab, message.data);
      }
    } else if (message.type === 'SAVE_TWEET') {
      await saveTweet(message.data);
    }
  });
});

/**
 * Save current page to Cortex
 */
async function saveCurrentPage(tabId: number, tab: chrome.tabs.Tab, customData?: any) {
  try {
    // Get page content
    const results = await browser.scripting.executeScript({
      target: { tabId },
      func: extractPageContent,
    });

    const pageData = results[0]?.result;
    if (!pageData) {
      showNotification('Error', 'Could not extract page content');
      return;
    }

    // Get auth token from storage
    const { apiKey } = await browser.storage.local.get('apiKey');
    if (!apiKey) {
      showNotification('Not logged in', 'Please configure your API key in settings');
      browser.runtime.openOptionsPage();
      return;
    }

    // Detect if Twitter/X page
    const isTwitter = tab.url?.includes('twitter.com') || tab.url?.includes('x.com');

    // Save to Cortex backend
    const response = await fetch('https://askcortex.plutas.in/v3/memories', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        content: pageData.content,
        metadata: {
          source: 'chrome_extension',
          url: tab.url,
          title: tab.title || pageData.title,
          favicon: tab.favIconUrl,
          timestamp: new Date().toISOString(),
          type: isTwitter ? 'tweet' : 'webpage',
          ...customData,
        },
      }),
    });

    if (!response.ok) {
      throw new Error(`API error: ${response.status}`);
    }

    const result = await response.json();
    showNotification('Saved to Cortex', `"${(tab.title || '').substring(0, 50)}..."`);

    // Send success message to content script for UI feedback
    browser.tabs.sendMessage(tabId, {
      type: 'SAVE_SUCCESS',
      data: result,
    });
  } catch (error) {
    console.error('Failed to save page:', error);
    showNotification('Save failed', 'Please try again');
  }
}

/**
 * Save text selection to Cortex
 */
async function saveSelection(tabId: number, text: string, tab: chrome.tabs.Tab) {
  try {
    const { apiKey } = await browser.storage.local.get('apiKey');
    if (!apiKey) {
      showNotification('Not logged in', 'Please configure your API key');
      return;
    }

    await fetch('https://askcortex.plutas.in/v3/memories', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        content: text,
        metadata: {
          source: 'chrome_extension_selection',
          url: tab.url,
          title: tab.title,
          timestamp: new Date().toISOString(),
        },
      }),
    });

    showNotification('Selection saved', text.substring(0, 50) + '...');
  } catch (error) {
    console.error('Failed to save selection:', error);
    showNotification('Save failed', 'Please try again');
  }
}

/**
 * Save tweet with metadata
 */
async function saveTweet(tweetData: any) {
  try {
    const { apiKey } = await browser.storage.local.get('apiKey');
    if (!apiKey) {
      showNotification('Not logged in', 'Please configure your API key');
      return;
    }

    await fetch('https://askcortex.plutas.in/v3/memories', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        content: tweetData.text,
        metadata: {
          source: 'twitter',
          type: 'tweet',
          author: tweetData.author,
          url: tweetData.url,
          timestamp: tweetData.timestamp || new Date().toISOString(),
        },
      }),
    });

    showNotification('Tweet saved', `From @${tweetData.author}`);
  } catch (error) {
    console.error('Failed to save tweet:', error);
    showNotification('Save failed', 'Please try again');
  }
}

/**
 * Show browser notification
 */
function showNotification(title: string, message: string) {
  browser.notifications.create({
    type: 'basic',
    iconUrl: browser.runtime.getURL('/icon/128.png'),
    title,
    message,
  });
}

/**
 * Extract page content (runs in page context)
 */
function extractPageContent() {
  const title = document.title;
  const description = document.querySelector('meta[name="description"]')?.getAttribute('content') || '';
  const ogImage = document.querySelector('meta[property="og:image"]')?.getAttribute('content') || '';

  // Get main content (try article, main, or body)
  const article = document.querySelector('article');
  const main = document.querySelector('main');
  const contentEl = article || main || document.body;

  // Extract text content, clean up whitespace
  const content = contentEl?.innerText
    .replace(/\s+/g, ' ')
    .trim()
    .substring(0, 10000) || ''; // Limit to 10k chars

  return {
    title,
    description,
    ogImage,
    content,
    url: window.location.href,
  };
}
