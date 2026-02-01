import React from 'react';

export interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  children: React.ReactNode;
  size?: 'sm' | 'md' | 'lg';
}

/**
 * IconButton - Circular button for icons matching mobile TouchableOpacity
 */
export function IconButton({
  children,
  size = 'md',
  className = '',
  ...props
}: IconButtonProps) {
  const sizeStyles = {
    sm: 'w-8 h-8 p-1',
    md: 'w-10 h-10 p-2',
    lg: 'w-12 h-12 p-3',
  };

  return (
    <button
      className={`rounded-full hover:bg-bg-tertiary active-opacity transition-colors flex items-center justify-center ${sizeStyles[size]} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
