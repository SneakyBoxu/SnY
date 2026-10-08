export interface BuilderSetRow {
  setNumber: number;
  prevStr: string;
  weightLbs: string;
  repsStr: string;
}

export interface BuilderExercise {
  id: string;
  exerciseId?: number;
  name: string;
  notes: string;
  sets: BuilderSetRow[];
}

interface RoutineDraft {
  name: string;
  exercises: BuilderExercise[];
}

let draft: RoutineDraft = {
  name: '',
  exercises: [],
};

const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

export function getRoutineDraft(): RoutineDraft {
  return draft;
}

export function setRoutineDraftName(name: string) {
  draft = { ...draft, name };
  emit();
}

export function addExerciseToDraft(name: string, exerciseId?: number) {
  const newItem: BuilderExercise = {
    id: `${Date.now()}_${Math.random()}`,
    exerciseId,
    name,
    notes: '',
    sets: [
      { setNumber: 1, prevStr: '-', weightLbs: '', repsStr: '10' },
      { setNumber: 2, prevStr: '-', weightLbs: '', repsStr: '10' },
      { setNumber: 3, prevStr: '-', weightLbs: '', repsStr: '10' },
    ],
  };
  draft = {
    ...draft,
    exercises: [...draft.exercises, newItem],
  };
  emit();
}

export function setDraftExercises(exercises: BuilderExercise[]) {
  draft = { ...draft, exercises };
  emit();
}

export function clearRoutineDraft() {
  draft = {
    name: '',
    exercises: [],
  };
  emit();
}

export function subscribeRoutineDraft(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
