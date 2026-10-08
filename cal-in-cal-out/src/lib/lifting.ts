import { round } from '@/lib/num';
import type { WorkoutEntry } from '@/lib/types';

export function parseRepsAverage(reps: string | null): number | null {
  if (!reps) return null;
  const segments = reps.split(',');
  const nums: number[] = [];
  for (const seg of segments) {
    const m = seg.trim().match(/\d+(\.\d+)?/);
    if (m) nums.push(parseFloat(m[0]));
  }
  if (nums.length === 0) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

export function parseRepsTotal(reps: string | null, sets: number | null): number {
  if (!reps) return (sets ?? 3) * 10;
  const segments = reps.split(',');
  const nums: number[] = [];
  for (const seg of segments) {
    const m = seg.trim().match(/\d+(\.\d+)?/);
    if (m) nums.push(parseFloat(m[0]));
  }
  if (nums.length === 0) return (sets ?? 3) * 10;
  if (nums.length === 1 && (sets ?? 1) > 1) {
    return nums[0] * (sets ?? 1);
  }
  return nums.reduce((a, b) => a + b, 0);
}

export function epley1rm(weightLbs: number, reps: number): number {
  if (weightLbs <= 0 || reps <= 0) return weightLbs;
  if (reps === 1) return weightLbs;
  return weightLbs * (1 + reps / 30);
}

export function computeSessionVolume(entry: WorkoutEntry | null): number | null {
  if (!entry || entry.weight_lbs_num === null || entry.weight_lbs_num <= 0) return null;
  const totalReps = parseRepsTotal(entry.reps, entry.sets);
  return Math.round(entry.weight_lbs_num * totalReps);
}

export interface NextTargetInfo {
  targetLabel: string;
  advice: string;
  isLoadUnlocked: boolean;
}

export function computeNextProgressionTarget(
  lastEntry: WorkoutEntry | null,
): NextTargetInfo {
  if (!lastEntry || lastEntry.weight_lbs_num === null) {
    return {
      targetLabel: '3 sets × 8–12',
      advice: 'Establish working baseline',
      isLoadUnlocked: false,
    };
  }

  const w = lastEntry.weight_lbs_num;
  const avgReps = parseRepsAverage(lastEntry.reps) ?? 10;
  const isCompound = w >= 70;
  const increment = isCompound ? 5 : 2.5;

  if (avgReps >= 12) {
    // Double progression: Top of rep range reached -> add weight
    const nextWeight = w + increment;
    return {
      targetLabel: `${round(nextWeight, 1)} lbs × 8–10`,
      advice: `+${increment} lbs load unlocked`,
      isLoadUnlocked: true,
    };
  } else if (avgReps >= 10) {
    return {
      targetLabel: `${round(w, 1)} lbs × 12,12`,
      advice: 'Aim for 12 reps to unlock next load',
      isLoadUnlocked: false,
    };
  } else {
    return {
      targetLabel: `${round(w, 1)} lbs × +1 rep`,
      advice: 'Build rep volume at current load',
      isLoadUnlocked: false,
    };
  }
}

export interface HistoryProgressGain {
  percentGain: number;
  firstDateFormatted: string;
  firstWeightLbs: number;
}

export function computeProgressGain(
  history: WorkoutEntry[],
): HistoryProgressGain | null {
  const weighted = history.filter((e) => e.weight_lbs_num !== null && e.weight_lbs_num > 0);
  if (weighted.length < 2) return null;

  const first = weighted[0];
  const last = weighted[weighted.length - 1];

  const firstAvgReps = parseRepsAverage(first.reps) ?? 10;
  const lastAvgReps = parseRepsAverage(last.reps) ?? 10;

  const first1Rm = epley1rm(first.weight_lbs_num as number, firstAvgReps);
  const last1Rm = epley1rm(last.weight_lbs_num as number, lastAvgReps);

  if (first1Rm <= 0) return null;

  const pct = Math.round(((last1Rm - first1Rm) / first1Rm) * 100);

  const d = new Date(first.date + 'T00:00:00');
  const monthStr = d.toLocaleString('en-US', { month: 'short' });
  const dayNum = d.getDate();

  return {
    percentGain: pct,
    firstDateFormatted: `${monthStr} ${dayNum}`,
    firstWeightLbs: first.weight_lbs_num as number,
  };
}
