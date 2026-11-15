import { Logo } from './Icons';
import { useEditor } from '../state/store';

/**
 * Top-left mark: the customer's logo on their pages when the admin has
 * uploaded one, otherwise Klipp's.
 */
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
