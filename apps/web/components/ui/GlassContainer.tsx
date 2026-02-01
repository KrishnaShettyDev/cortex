import React from 'react';

export interface GlassContainerProps {
  children: React.ReactNode;
  className?: string;
}

/**
 * GlassContainer - Full-width glassmorphic container
 */
export function GlassContainer({ children, className = '' }: GlassContainerProps) {
  return (
    <div className={`glass-effect ${className}`}>
      {children}
    </div>
  );
}
