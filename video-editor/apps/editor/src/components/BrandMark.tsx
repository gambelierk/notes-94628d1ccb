import { useMemo, type CSSProperties } from 'react';
import { Logo } from './Icons';
import { topbarVariables } from '../services/branding';
import { useEditor } from '../state/store';

/**
 * Top-left mark: the customer's logo on their pages when the admin has
 * uploaded one, otherwise Klipp's.
 */
/** Inline style for the top section: the customer's colours for the bar, its text and its buttons. */
export function useTopbarStyle(): CSSProperties | undefined {
  const library = useEditor((s) => s.library);
  return useMemo(() => (library.kind === 'share' ? (topbarVariables(library.branding) as CSSProperties) : undefined), [library]);
}

export function BrandMark() {
  const library = useEditor((s) => s.library);
  const logo = library.kind === 'share' ? library.branding.logo : null;
  const plate = library.kind === 'share' ? library.branding.logoPlate : 'none';
  if (logo)
    return (
      <div className={`brand brand-custom plate-${plate}`} data-testid="brand-mark">
        <img className="brand-logo" src={logo.url} alt={library.kind === 'share' ? library.name : ''} data-testid="brand-logo" />
      </div>
    );
  return (
    <div className="brand">
      <span className="brand-mark">
        <Logo width={16} height={16} />
      </span>
      Klipp
    </div>
  );
}
