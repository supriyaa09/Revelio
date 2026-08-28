/** View routing types — state-based navigation, no router dependency. */

export type View =
  | { name: 'dashboard' }
  | { name: 'search'; query?: string }
  | { name: 'document'; id: number; from: View }
  | { name: 'categories' }
  | { name: 'folders' }
  | { name: 'settings' };
