type Props = {
  src: string | null;
  alt: string;
  className?: string;
};

/**
 * Visar produktbild. Bilden kan vara en vanlig URL (t.ex. Cloudinary, S3,
 * Supabase Storage) eller en data-URL (base64) som ligger i databasen.
 * Saknas bild visas en neutral platshållare.
 */
export function Produktbild({ src, alt, className = "" }: Props) {
  if (!src) {
    return (
      <div
        className={`flex items-center justify-center bg-surface text-sm text-muted ${className}`}
        aria-label="Bild saknas"
      >
        Bild kommer snart
      </div>
    );
  }

  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={alt} className={`object-cover ${className}`} loading="lazy" />;
}
