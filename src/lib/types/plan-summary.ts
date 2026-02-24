export type WeekDay = {
  day: 'Mon' | 'Tue' | 'Wed' | 'Thu' | 'Fri' | 'Sat' | 'Sun';
  label: string;
  tag?: string;
  intensity?: 'easy' | 'quality' | 'rest' | 'long' | 'recovery' | 'cross';
};

export type PlanSummary = {
  title: string;
  weeksTotal: number;
  categories?: string[];
  phases: Array<{
    name: string;
    weeks: [number, number];
    focus: string;
  }>;
  loadCurve?: {
    points: number[];  // 0..1 normalized, one per week
    peakWeek?: number;
    raceWeek?: number;
  };
  typicalWeek: WeekDay[];
  principle?: string;
  footerNote?: string;
};
