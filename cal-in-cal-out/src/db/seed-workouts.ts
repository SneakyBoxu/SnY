export const WORKOUT_SEED_VERSION = 2;

export interface SeedWorkout {
  date: string;
  focusKey: string;
  exercise: string;
  weightLbs: string | null;
  weightLbsNum: number | null;
  sets: number | null;
  reps: string | null;
  position: number;
}

export const WORKOUT_HISTORY: SeedWorkout[] = [];

export interface SeedWeight {
  date: string;
  kg: number;
  note?: string;
}

export const WEIGHT_HISTORY: SeedWeight[] = [];

export const FOCUS_LABELS: Record<string, string> = {
  push: 'Push',
  pull: 'Pull',
  legs: 'Legs',
  shoulders_chest: 'Shoulders & Chest',
  arm_core: 'Arm & Core',
};

export const FOCUS_CYCLE = ['push', 'pull', 'legs', 'shoulders_chest', 'arm_core'];

export interface SeedTemplate {
  focusKey: string;
  exercise: string;
  position: number;
}

export const WORKOUT_TEMPLATES: SeedTemplate[] = [
  // 1. Push
  { focusKey: 'push', exercise: 'Barbell Bench Press', position: 1 },
  { focusKey: 'push', exercise: 'Dumbbell Incline Press', position: 2 },
  { focusKey: 'push', exercise: 'Seated Dumbbell Tricep Extension', position: 3 },
  { focusKey: 'push', exercise: 'Bench Dips', position: 4 },

  // 2. Pull
  { focusKey: 'pull', exercise: 'Barbell Bent-Over Row', position: 1 },
  { focusKey: 'pull', exercise: 'Dumbbell One-Arm Row', position: 2 },
  { focusKey: 'pull', exercise: 'Pull-up', position: 3 },
  { focusKey: 'pull', exercise: 'Negative Pull-ups', position: 4 },

  // 3. Legs
  { focusKey: 'legs', exercise: 'BW Squat', position: 1 },
  { focusKey: 'legs', exercise: 'Zercher Squat', position: 2 },
  { focusKey: 'legs', exercise: 'Bulgarian Split Squat', position: 3 },
  { focusKey: 'legs', exercise: 'Standing Barbell Calf Raises', position: 4 },

  // 4. Shoulders & Chest
  { focusKey: 'shoulders_chest', exercise: 'Dumbbell Shoulder Press', position: 1 },
  { focusKey: 'shoulders_chest', exercise: 'Dumbbell Bench Flyes', position: 2 },
  { focusKey: 'shoulders_chest', exercise: 'Dumbbell Lateral Raises', position: 3 },
  { focusKey: 'shoulders_chest', exercise: 'Barbell Shrugs', position: 4 },

  // 5. Arm & Core
  { focusKey: 'arm_core', exercise: 'Dumbbell Hammer Curls', position: 1 },
  { focusKey: 'arm_core', exercise: 'Bilateral Dumbbell Curls', position: 2 },
  { focusKey: 'arm_core', exercise: 'Seated Dumbbell Rear Delt Fly', position: 3 },
  { focusKey: 'arm_core', exercise: 'Weighted Reach-Up Crunches', position: 4 },
  { focusKey: 'arm_core', exercise: 'Lying Leg Raises', position: 5 },
];
