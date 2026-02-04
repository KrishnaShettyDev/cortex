import { useState } from 'react';
import { apiClient } from '@/lib/api/client';

type ModalTab = 'note' | 'link' | 'file' | 'connect';

interface AddMemoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (content: string) => Promise<void>;
}

export function AddMemoryModal({ isOpen, onClose, onSave }: AddMemoryModalProps) {
  const [activeTab, setActiveTab] = useState<ModalTab>('note');
  const [content, setContent] = useState('');
  const [linkUrl, setLinkUrl] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  if (!isOpen) return null;

  const handleSave = async () => {
    if (!content.trim()) return;

    setIsSaving(true);
    try {
      await onSave(content);
      setContent('');
      onClose();
    } catch (error) {
      console.error('Failed to save memory:', error);
      alert('Failed to save memory. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleClose = () => {
    if (!isSaving) {
      setContent('');
      setLinkUrl('');
      setActiveTab('note');
      onClose();
    }
  };

  const handleSaveLink = async () => {
    if (!linkUrl.trim()) return;

    setIsSaving(true);
    try {
      await onSave(`Saved link: ${linkUrl}`);
      setLinkUrl('');
      onClose();
    } catch (error) {
      console.error('Failed to save link:', error);
    } finally {
      setIsSaving(false);
    }
  };

  const handleConnect = async () => {
    try {
      const response = await apiClient.connectGmail();
      if (response.redirectUrl) {
        // Open OAuth popup
        const popup = window.open(response.redirectUrl, '_blank', 'width=600,height=700');

        // Poll for connection status
        const checkInterval = setInterval(async () => {
          try {
            const status = await apiClient.getIntegrationStatus() as any;
            if (status.gmail?.connected) {
              clearInterval(checkInterval);
              popup?.close();
              onClose();
              alert('Gmail connected successfully! Your emails are being synced.');
            }
          } catch (err) {
            console.error('Failed to check status:', err);
          }
        }, 2000); // Check every 2 seconds

        // Stop polling after 2 minutes
        setTimeout(() => clearInterval(checkInterval), 120000);
      }
    } catch (error) {
      console.error('Failed to connect Gmail:', error);
      alert('Failed to connect Gmail. Please try again.');
    }
  };

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
      <div className="bg-zinc-900 border border-zinc-800 rounded-2xl w-full max-w-5xl h-[600px] flex overflow-hidden">
        {/* Left Sidebar */}
        <aside className="w-80 border-r border-zinc-800 p-6 space-y-2">
          <SidebarOption
            icon="📝"
            title="Note"
            description="Write down your thoughts"
            isActive={activeTab === 'note'}
            onClick={() => setActiveTab('note')}
          />
          <SidebarOption
            icon="🔗"
            title="Link"
            description="Save any webpage"
            isActive={activeTab === 'link'}
            onClick={() => setActiveTab('link')}
          />
          <SidebarOption
            icon="📄"
            title="File"
            description="Upload any file"
            isActive={activeTab === 'file'}
            onClick={() => setActiveTab('file')}
          />
          <SidebarOption
            icon="🔌"
            title="Connect"
            description="Connect Gmail via Composio"
            isActive={activeTab === 'connect'}
            onClick={handleConnect}
          />
        </aside>

        {/* Right Content Area */}
        <div className="flex-1 flex flex-col">
          <div className="flex-1 p-8">
            {activeTab === 'note' && (
              <textarea
                placeholder="Write your note here..."
                className="w-full h-full bg-transparent outline-none resize-none text-lg placeholder:text-zinc-600"
                autoFocus
                value={content}
                onChange={(e) => setContent(e.target.value)}
              />
            )}
            {activeTab === 'link' && (
              <div className="space-y-4">
                <input
                  type="url"
                  value={linkUrl}
                  onChange={(e) => setLinkUrl(e.target.value)}
                  placeholder="https://..."
                  className="w-full bg-transparent border-b border-zinc-700 outline-none text-lg pb-2 placeholder:text-zinc-600"
                />
                <p className="text-sm text-zinc-500">
                  Paste a URL to save it to your memories
                </p>
              </div>
            )}
            {activeTab === 'file' && (
              <div className="flex items-center justify-center h-full">
                <div className="text-center">
                  <p className="text-zinc-400">File upload coming soon</p>
                </div>
              </div>
            )}
            {activeTab === 'connect' && (
              <div className="flex items-center justify-center h-full">
                <div className="text-center">
                  <p className="text-zinc-400">Opening Gmail connection...</p>
                </div>
              </div>
            )}
          </div>

          {/* Bottom Actions */}
          {(activeTab === 'note' || activeTab === 'link') && (
            <footer className="p-6 border-t border-zinc-800 flex items-center justify-between">
              <button
                onClick={handleClose}
                disabled={isSaving}
                className="px-6 py-2 text-zinc-400 hover:text-white disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={activeTab === 'note' ? handleSave : handleSaveLink}
                disabled={isSaving || (activeTab === 'note' ? !content.trim() : !linkUrl.trim())}
                className="px-6 py-2 bg-blue-600 hover:bg-blue-700 rounded-lg font-medium disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {isSaving ? 'Saving...' : activeTab === 'note' ? 'Save Memory' : 'Save Link'}
              </button>
            </footer>
          )}
        </div>
      </div>
    </div>
  );
}

interface SidebarOptionProps {
  icon: string;
  title: string;
  description: string;
  isActive: boolean;
  onClick: () => void;
}

function SidebarOption({ icon, title, description, isActive, onClick }: SidebarOptionProps) {
  return (
    <button
      onClick={onClick}
      className={`w-full text-left p-4 rounded-lg space-y-1 transition-colors ${
        isActive ? 'bg-zinc-800' : 'hover:bg-zinc-800'
      }`}
    >
      <div className="flex items-center gap-2">
        <span>{icon}</span>
        <span className="font-medium">{title}</span>
      </div>
      <div className="text-sm text-zinc-400">{description}</div>
    </button>
  );
}
