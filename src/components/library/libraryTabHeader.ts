export type LibraryTabHeaderActionVariant = 'primary' | 'secondary';

export interface LibraryTabHeaderAction {
  key: string;
  label: string;
  icon?: string;
  ariaLabel?: string;
  title?: string;
  disabled?: boolean;
  variant?: LibraryTabHeaderActionVariant;
}
