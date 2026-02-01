import React from 'react';

export interface GlassCardProps {
  children: React.ReactNode;
  className?: string;
  onClick?: () => void;
}

/**
 * GlassCard - Glassmorphic card component matching mobile BlurView
 * Uses backdrop-blur and glass effect tokens
 */
export function GlassCard({ children, className = '', onClick }: GlassCardProps) {
  return (
    <div
      className={`glass-effect rounded-lg ${onClick ? 'cursor-pointer hover:bg-opacity-80' : ''} ${className}`}
      onClick={onClick}
    >
      {children}
    </div>
  );
}
