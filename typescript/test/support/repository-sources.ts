import { readdirSync, readFileSync, type Dirent } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

interface SourceReads {
  entries(directory: string): Dirent[];
  text(file: string): string;
}

/** Snapshot immutable checkout inputs; temporary mutation fixtures remain live. */
export function createRepositorySources(
  root: string,
  reads: SourceReads = {
    entries: (directory) => readdirSync(directory, { withFileTypes: true }),
    text: (file) => readFileSync(file, 'utf8'),
  }
): { entries(directory: string): readonly Dirent[]; text(file: string): string } {
  root = path.resolve(root);
  const directories = new Map<string, readonly Dirent[]>();
  const texts = new Map<string, string>();
  const inside = (file: string): boolean => {
    const relative = path.relative(root, file);
    return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
  };
  return {
    entries(directory) {
      directory = path.resolve(directory);
      if (!inside(directory)) return reads.entries(directory);
      let value = directories.get(directory);
      if (!value) {
        value = Object.freeze(reads.entries(directory));
        directories.set(directory, value);
      }
      return value;
    },
    text(file) {
      file = path.resolve(file);
      if (!inside(file)) return reads.text(file);
      let value = texts.get(file);
      if (value === undefined) {
        value = reads.text(file);
        texts.set(file, value);
      }
      return value;
    },
  };
}

export const repositorySources = createRepositorySources(
  fileURLToPath(new URL('../../../', import.meta.url))
);
