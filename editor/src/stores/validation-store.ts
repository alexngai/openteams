import { create } from 'zustand';

export interface ValidationIssue {
  path: string;
  message: string;
  severity: 'error' | 'warning';
  nodeId?: string;
}

interface ValidationStore {
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
  isValidating: boolean;
  setResults: (errors: ValidationIssue[], warnings: ValidationIssue[]) => void;
  setValidating: (v: boolean) => void;
  clear: () => void;
}

export const useValidationStore = create<ValidationStore>((set) => ({
  errors: [],
  warnings: [],
  isValidating: false,

  setResults: (errors, warnings) => set({ errors, warnings, isValidating: false }),
  setValidating: (v) => set({ isValidating: v }),
  clear: () => set({ errors: [], warnings: [], isValidating: false }),
}));
