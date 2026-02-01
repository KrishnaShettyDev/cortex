import { useState, useEffect } from 'react';
import { Save, Check, Settings, X, Loader2 } from 'lucide-react';

export default function Popup() {
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pageData, setPageData] = useState<any>(null);
  const [apiKey, setApiKey] = useState('');
  const [showSettings, setShowSettings] = useState(false);

  useEffect(() => {
    // Get current tab info
    browser.tabs.query({ active: true, currentWindow: true }).then(([tab]) => {
      setPageData({
        title: tab.title,
        url: tab.url,
        favIconUrl: tab.favIconUrl,
      });
    });

    // Get stored API key
    browser.storage.local.get('apiKey').then(({ apiKey: storedKey }) => {
      if (storedKey) {
        setApiKey(storedKey);
      } else {
        setShowSettings(true);
      }
    });
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setError(null);

    try {
      // Send message to background script to handle save
      await browser.runtime.sendMessage({
        type: 'SAVE_PAGE',
        data: {},
      });

      setSaved(true);
      setTimeout(() => {
        window.close();
      }, 1000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
      setSaving(false);
    }
  };

  const handleSaveApiKey = async () => {
    if (!apiKey.trim()) {
      setError('Please enter an API key');
      return;
    }

    await browser.storage.local.set({ apiKey: apiKey.trim() });
    setShowSettings(false);
    setError(null);
  };

  if (showSettings) {
    return (
      <div className="w-[400px] h-auto bg-bg-primary text-text-primary p-6">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-semibold">Settings</h2>
          {apiKey && (
            <button
              onClick={() => setShowSettings(false)}
              className="p-1.5 hover:bg-bg-tertiary rounded-lg transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-text-secondary mb-2">
              Cortex API Key
            </label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="Enter your API key"
              className="w-full px-3 py-2 bg-bg-secondary border border-bg-tertiary rounded-lg text-text-primary placeholder:text-text-tertiary focus:outline-none focus:ring-2 focus:ring-accent"
            />
            <p className="mt-2 text-xs text-text-tertiary">
              Get your API key from{' '}
              <a
                href="https://app.askcortex.plutas.in/settings"
                target="_blank"
                rel="noopener noreferrer"
                className="text-accent hover:underline"
              >
                Cortex Settings
              </a>
            </p>
          </div>

          <button
            onClick={handleSaveApiKey}
            className="w-full px-4 py-2 bg-accent text-white rounded-lg font-medium hover:bg-accent-pressed transition-colors"
          >
            Save API Key
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="w-[400px] h-auto bg-bg-primary text-text-primary">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-bg-tertiary">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-accent rounded-lg flex items-center justify-center">
            <span className="text-white font-bold text-sm">C</span>
          </div>
          <div>
            <h1 className="text-sm font-semibold">Cortex</h1>
            <p className="text-xs text-text-tertiary">Save to memory</p>
          </div>
        </div>
        <button
          onClick={() => setShowSettings(true)}
          className="p-1.5 hover:bg-bg-tertiary rounded-lg transition-colors"
        >
          <Settings className="w-5 h-5 text-text-secondary" />
        </button>
      </div>

      {/* Page Preview */}
      {pageData && (
        <div className="p-4 border-b border-bg-tertiary">
          <div className="flex items-start gap-3">
            {pageData.favIconUrl && (
              <img src={pageData.favIconUrl} alt="" className="w-5 h-5 mt-0.5" />
            )}
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-text-primary truncate">
                {pageData.title || 'Untitled'}
              </p>
              <p className="text-xs text-text-tertiary truncate mt-0.5">
                {pageData.url}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="p-4">
        {error && (
          <div className="mb-4 p-3 bg-error/10 border border-error/30 rounded-lg">
            <p className="text-sm text-error">{error}</p>
          </div>
        )}

        {saved ? (
          <div className="flex items-center justify-center gap-2 py-3 bg-success/10 border border-success/30 rounded-lg">
            <Check className="w-5 h-5 text-success" />
            <span className="text-sm font-medium text-success">Saved to Cortex</span>
          </div>
        ) : (
          <button
            onClick={handleSave}
            disabled={saving}
            className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-accent text-white rounded-lg font-medium hover:bg-accent-pressed disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {saving ? (
              <>
                <Loader2 className="w-5 h-5 animate-spin" />
                <span>Saving...</span>
              </>
            ) : (
              <>
                <Save className="w-5 h-5" />
                <span>Save to Cortex</span>
              </>
            )}
          </button>
        )}

        <div className="mt-3 text-center">
          <p className="text-xs text-text-tertiary">
            Or use <kbd className="px-1.5 py-0.5 bg-bg-secondary border border-bg-tertiary rounded text-xs">⌘ Shift S</kbd> to quick save
          </p>
        </div>
      </div>

      {/* Footer */}
      <div className="px-4 py-3 bg-bg-secondary border-t border-bg-tertiary">
        <p className="text-xs text-text-tertiary text-center">
          Powered by{' '}
          <a
            href="https://askcortex.plutas.in"
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent hover:underline"
          >
            Cortex AI
          </a>
        </p>
      </div>
    </div>
  );
}
