import plexSansLatin from '@fontsource-variable/ibm-plex-sans/files/ibm-plex-sans-latin-wght-normal.woff2?url';
import plexSansLatinExt from '@fontsource-variable/ibm-plex-sans/files/ibm-plex-sans-latin-ext-wght-normal.woff2?url';
import plexMono400 from '@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-400-normal.woff2?url';
import plexMono500 from '@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-500-normal.woff2?url';
import plexMono600 from '@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-600-normal.woff2?url';
import plexMono700 from '@fontsource/ibm-plex-mono/files/ibm-plex-mono-latin-700-normal.woff2?url';
import type { FontSource } from '@ve/render';

const abs = (u: string) => new URL(u, location.href).href;

/** Font files for text clips, passed to the export worker. Same files as the CSS uses. */
export const TEXT_FONT_SOURCES: FontSource[] = [
  { family: 'IBM Plex Sans Variable', url: abs(plexSansLatinExt), weight: '100 700' },
  { family: 'IBM Plex Sans Variable', url: abs(plexSansLatin), weight: '100 700' },
  { family: 'IBM Plex Mono', url: abs(plexMono400), weight: '400' },
  { family: 'IBM Plex Mono', url: abs(plexMono500), weight: '500' },
  { family: 'IBM Plex Mono', url: abs(plexMono600), weight: '600' },
  { family: 'IBM Plex Mono', url: abs(plexMono700), weight: '700' },
];
