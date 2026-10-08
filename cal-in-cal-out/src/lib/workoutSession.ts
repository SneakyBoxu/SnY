import { useSyncExternalStore } from 'react';

/**
 * In-memory store for the workout in progress. The active-workout screen writes to it
 * continuously, so the screen can be minimized (unmounted) and resumed later with
 * all sets, notes and timers intact.
 */
export interface SessionSet {
  setNumber: number;
  setType?: 'NORMAL' | 'WARMUP' | 'FAILURE' | 'DROP';
  prevStr: string;
  weightLbs: string;
  repsStr: string;
  completed: boolean;
}

export interface SessionExercise {
  id: string;
  name: string;
  prevWeight: string | null;
  prevReps: string | null;
  sets: SessionSet[];
  isCollapsed?: boolean;
}

export interface WorkoutSession {
  focusKey: string;
  date: string;
  focusName: string;
  startedAt: number;
  notes: string;
  exercises: SessionExercise[];
  defaultRestSec: number;
  exerciseRestSecMap: Record<string, number>;
  restTotal: number;
  restEndsAt: number | null;
}

let current: WorkoutSession | null = null;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

export function getSession(): WorkoutSession | null {
  return current;
}

export function saveSession(next: WorkoutSession): void {
  current = next;
  emit();
}

export function clearSession(): void {
  current = null;
  emit();
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function useWorkoutSession(): WorkoutSession | null {
  return useSyncExternalStore(subscribe, getSession, getSession);
}
