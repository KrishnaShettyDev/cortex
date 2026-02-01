import { useState } from 'react';

interface ChatInputProps {
  onSearch: (query: string) => void;
  isSearching: boolean;
}

export function ChatInput({ onSearch, isSearching }: ChatInputProps) {
  const [input, setInput] = useState('');

  const handleSubmit = () => {
    if (input.trim() && !isSearching) {
      onSearch(input);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6">
      <input
        type="text"
        placeholder="Ask your cortex..."
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        className="w-full bg-transparent text-lg outline-none placeholder:text-zinc-600 mb-4"
      />

      <div className="flex items-center justify-between">
        <ProjectSelector />
        <SendButton onClick={handleSubmit} isLoading={isSearching} disabled={!input.trim()} />
      </div>
    </div>
  );
}

function ProjectSelector() {
  return (
    <button className="flex items-center gap-2 text-sm text-zinc-400 hover:text-white">
      <FolderIcon />
      <span>Default Project</span>
      <ChevronDownIcon />
    </button>
  );
}

interface SendButtonProps {
  onClick: () => void;
  isLoading: boolean;
  disabled: boolean;
}

function SendButton({ onClick, isLoading, disabled }: SendButtonProps) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="p-2 bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
    >
      {isLoading ? (
        <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
      ) : (
        <ArrowUpIcon />
      )}
    </button>
  );
}

// Icons
function FolderIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
    </svg>
  );
}

function ChevronDownIcon() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
    </svg>
  );
}

function ArrowUpIcon() {
  return (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" />
    </svg>
  );
}
