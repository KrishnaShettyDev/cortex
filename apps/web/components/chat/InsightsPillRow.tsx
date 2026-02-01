/**
 * InsightsPillRow Component
 * Row of insight badges
 */

'use client';

import { InsightsPill, InsightType } from './InsightsPill';

export interface InsightData {
  type: InsightType;
  count: number;
  label: string;
}

interface InsightsPillRowProps {
  insights: InsightData[];
  onInsightClick: (insight: InsightData) => void;
}

export function InsightsPillRow({ insights, onInsightClick }: InsightsPillRowProps) {
  const visibleInsights = insights.filter((insight) => insight.count > 0);

  if (visibleInsights.length === 0) return null;

  return (
    <div className="mb-lg px-lg">
      <div className="flex flex-wrap gap-sm">
        {visibleInsights.map((insight) => (
          <InsightsPill
            key={insight.type}
            type={insight.type}
            count={insight.count}
            label={insight.label}
            onClick={() => onInsightClick(insight)}
          />
        ))}
      </div>
    </div>
  );
}
