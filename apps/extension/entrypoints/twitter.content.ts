/**
 * Twitter/X Content Script
 * Adds "Save to Cortex" button to tweets
 */

export default defineContentScript({
  matches: ['*://twitter.com/*', '*://x.com/*'],
  main() {
    console.log('Cortex Twitter integration loaded');

    // Add save button to tweets
    function addSaveButtons() {
      const tweets = document.querySelectorAll('article[data-testid="tweet"]');

      tweets.forEach((tweet) => {
        // Skip if already has button
        if (tweet.querySelector('.cortex-save-btn')) return;

        // Find tweet action bar
        const actionBar = tweet.querySelector('[role="group"]');
        if (!actionBar) return;

        // Extract tweet data
        const tweetText = tweet.querySelector('[data-testid="tweetText"]')?.textContent || '';
        const authorElement = tweet.querySelector('[data-testid="User-Name"]');
        const author = authorElement?.querySelector('a')?.getAttribute('href')?.replace('/', '') || 'unknown';
        const tweetLink = tweet.querySelector('a[href*="/status/"]')?.getAttribute('href');
        const tweetUrl = tweetLink ? `https://twitter.com${tweetLink}` : '';

        // Create save button
        const saveBtn = document.createElement('div');
        saveBtn.className = 'cortex-save-btn';
        saveBtn.innerHTML = `
          <div style="display: flex; align-items: center; gap: 4px; padding: 0 12px; height: 34px; border-radius: 17px; background: rgba(10, 132, 255, 0.1); border: 1px solid rgba(10, 132, 255, 0.3); cursor: pointer; transition: all 0.2s;">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#0A84FF" stroke-width="2">
              <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
            </svg>
            <span style="font-size: 13px; font-weight: 500; color: #0A84FF;">Save</span>
          </div>
        `;

        saveBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          e.preventDefault();

          // Send to background script
          await browser.runtime.sendMessage({
            type: 'SAVE_TWEET',
            data: {
              text: tweetText,
              author,
              url: tweetUrl,
              timestamp: new Date().toISOString(),
            },
          });

          // Visual feedback
          saveBtn.innerHTML = `
            <div style="display: flex; align-items: center; gap: 4px; padding: 0 12px; height: 34px; border-radius: 17px; background: rgba(52, 199, 89, 0.1); border: 1px solid rgba(52, 199, 89, 0.3);">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#34C759" stroke-width="2">
                <path d="M20 6L9 17l-5-5"/>
              </svg>
              <span style="font-size: 13px; font-weight: 500; color: #34C759;">Saved</span>
            </div>
          `;

          setTimeout(() => {
            saveBtn.remove();
          }, 2000);
        });

        // Append to action bar
        actionBar.appendChild(saveBtn);
      });
    }

    // Initial load
    addSaveButtons();

    // Watch for new tweets (infinite scroll)
    const observer = new MutationObserver(() => {
      addSaveButtons();
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true,
    });

    // Listen for save success from background
    browser.runtime.onMessage.addListener((message) => {
      if (message.type === 'SAVE_SUCCESS') {
        console.log('Tweet saved successfully:', message.data);
      }
    });
  },
});
