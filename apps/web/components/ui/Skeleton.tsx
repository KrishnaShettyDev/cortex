import React from 'react';

export interface SkeletonProps {
  className?: string;
  width?: string;
  height?: string;
}

/**
 * Skeleton - Loading placeholder with shimmer effect
 */
export function Skeleton({
  className = '',
  width,
  height
}: SkeletonProps) {
  const style = {
    width: width || '100%',
    height: height || '1rem',
  };

  return (
    <div
      className={`bg-bg-tertiary rounded animate-pulse ${className}`}
      style={style}
    />
  );
}

/**
 * SkeletonText - Multiple skeleton lines
 */
export function SkeletonText({ lines = 3 }: { lines?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          width={i === lines - 1 ? '60%' : '100%'}
          height="0.875rem"
        />
      ))}
    </div>
  );
}
