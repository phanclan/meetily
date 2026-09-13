import type { LibrarySourceScope } from '@/lib/libraryAnswerContext';

export interface LibraryRecipe {
  label: string;
  prompt: string;
  sourceScope: LibrarySourceScope;
}

export const LIBRARY_RECIPES: LibraryRecipe[] = [
  {
    label: 'Recent follow-ups',
    prompt: 'What follow-ups were agreed in these recent meetings?',
    sourceScope: 'recent',
  },
  {
    label: 'Decisions',
    prompt: 'What decisions were made in these recent meetings?',
    sourceScope: 'recent',
  },
  {
    label: 'Open questions',
    prompt: 'What open questions or unresolved items remain across these recent meetings?',
    sourceScope: 'recent',
  },
];
