import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

export class ConversionUnavailableError extends Error {}
export class ConversionFailedError extends Error {}

const TIMEOUT_MS = 120_000;

/**
 * PostScript (EPS, old Illustrator files) → PDF, cropped to the artwork's
 * bounding box, with Ghostscript. Browsers can't read PostScript; PDF keeps
 * the artwork as vectors and keeps empty areas transparent.
 *
 * Ghostscript runs with -dSAFER (no file access outside its arguments), in a
 * private temporary folder, with a time limit.
 */
export async function postscriptToPdf(input: Uint8Array, gs: string | null): Promise<Uint8Array> {
  if (!gs) throw new ConversionUnavailableError('EPS-konvertering är inte aktiverad på servern');
  const dir = await mkdtemp(path.join(tmpdir(), 'klipp-eps-'));
  try {
    const src = path.join(dir, 'in.eps');
    const out = path.join(dir, 'out.pdf');
    await writeFile(src, input);
    await new Promise<void>((resolve, reject) => {
      execFile(
        gs,
        ['-q', '-dSAFER', '-dBATCH', '-dNOPAUSE', '-dNOINTERPOLATE', '-dEPSCrop', '-sDEVICE=pdfwrite', '-dCompatibilityLevel=1.7', `-sOutputFile=${out}`, src],
        { timeout: TIMEOUT_MS, killSignal: 'SIGKILL', maxBuffer: 1024 * 1024, cwd: dir },
        (err) => {
          if (!err) return resolve();
          if ((err as NodeJS.ErrnoException).code === 'ENOENT') reject(new ConversionUnavailableError('Ghostscript saknas på servern, så EPS-filer kan inte konverteras'));
          else reject(new ConversionFailedError('EPS-filen kunde inte läsas'));
        },
      );
    });
    const pdf = new Uint8Array(await readFile(out));
    if (pdf.byteLength < 8) throw new ConversionFailedError('EPS-filen innehöll ingen grafik');
    return pdf;
  } catch (e) {
    if (e instanceof ConversionUnavailableError || e instanceof ConversionFailedError) throw e;
    throw new ConversionFailedError('EPS-filen kunde inte konverteras');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
