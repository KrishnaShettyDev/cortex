import React from 'react';
import Image from 'next/image';

export interface ProfileHeaderProps {
  name?: string;
  email: string;
}

/**
 * ProfileHeader - User profile section matching mobile settings
 */
export function ProfileHeader({ name, email }: ProfileHeaderProps) {
  // Use name if available, otherwise use email prefix
  const emailPrefix = email.split('@')[0];
  const displayName = name?.toUpperCase() || emailPrefix.toUpperCase() || 'USER';
  const avatarName = name || emailPrefix || 'User';

  return (
    <div className="flex items-center gap-4 px-6 py-6">
      <div className="w-14 h-14 rounded-full overflow-hidden flex-shrink-0">
        <Image
          src={`https://ui-avatars.com/api/?name=${encodeURIComponent(avatarName)}&background=random&size=128`}
          alt={displayName}
          width={56}
          height={56}
          className="w-full h-full"
        />
      </div>
      <div className="flex-1 min-w-0">
        <h2 className="text-lg font-semibold text-text-primary tracking-wide">
          {displayName}
        </h2>
        <p className="text-sm text-text-secondary mt-0.5 truncate">
          {email}
        </p>
      </div>
    </div>
  );
}
