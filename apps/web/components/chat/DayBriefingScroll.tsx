/**
 * DayBriefingScroll Component
 * Horizontal scrollable briefing cards
 */

'use client';

import { DayBriefingCard, BriefingType } from './DayBriefingCard';

export interface BriefingItem {
  id: string;
  type: BriefingType;
  title: string;
  description: string;
  count?: number;
  urgent?: boolean;
}

interface DayBriefingScrollProps {
  items: BriefingItem[];
  onItemClick: (item: BriefingItem) => void;
}

export function DayBriefingScroll({ items, onItemClick }: DayBriefingScrollProps) {
  if (items.length === 0) return null;

  return (
    <div className="mb-xl">
      <h3 className="text-sm font-semibold text-text-primary mb-md px-lg">
        Today&apos;s Briefing
      </h3>
      <div
        className="flex gap-md px-lg overflow-x-auto scrollbar-hide"
        style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
      >
        {items.map((item) => (
          <DayBriefingCard
            key={item.id}
            type={item.type}
            title={item.title}
            description={item.description}
            count={item.count}
            urgent={item.urgent}
            onClick={() => onItemClick(item)}
          />
        ))}
      </div>
    </div>
  );
}
