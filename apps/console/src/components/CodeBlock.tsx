'use client';

import { useState } from 'react';
import { Copy, Check } from 'lucide-react';

interface CodeBlockProps {
  code: string;
  language?: string;
}

export function CodeBlock({ code, language }: CodeBlockProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="relative bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden">
      {language && (
        <div className="px-4 py-2 border-b border-zinc-800 text-xs text-zinc-500">
          {language}
        </div>
      )}
      <div className="relative">
        <pre className="p-4 overflow-x-auto text-sm font-mono text-zinc-300">
          <code>{code}</code>
        </pre>
        <button
          onClick={handleCopy}
          className="absolute top-3 right-3 p-2 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 rounded-md transition-colors"
          title="Copy to clipboard"
        >
          {copied ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
        </button>
      </div>
    </div>
  );
}
