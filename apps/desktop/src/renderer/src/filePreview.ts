/** File formats with a renderer beyond the plain source view. */
export type WorkspaceFileKind =
  | 'text'
  | 'markdown'
  | 'html'
  | 'json'
  | 'table'
  | 'svg'
  | 'image'
  | 'pdf'
  | 'audio'
  | 'video'
  | 'font';

const LANGUAGES: Readonly<Record<string, string>> = {
  c: 'c',
  cc: 'cpp',
  cpp: 'cpp',
  cs: 'csharp',
  css: 'css',
  go: 'go',
  h: 'c',
  hpp: 'cpp',
  html: 'html',
  java: 'java',
  js: 'javascript',
  jsx: 'jsx',
  json: 'json',
  jsonc: 'json',
  md: 'markdown',
  mjs: 'javascript',
  mts: 'typescript',
  php: 'php',
  py: 'python',
  rb: 'ruby',
  rs: 'rust',
  sh: 'bash',
  sql: 'sql',
  svelte: 'html',
  ts: 'typescript',
  tsx: 'tsx',
  vue: 'html',
  xml: 'xml',
  yaml: 'yaml',
  yml: 'yaml',
  zsh: 'bash',
};

const IMAGES = new Set(['avif', 'bmp', 'gif', 'jpeg', 'jpg', 'png', 'tif', 'tiff', 'webp']);
const AUDIO = new Set(['aac', 'm4a', 'mp3', 'oga', 'ogg', 'wav']);
const VIDEO = new Set(['m4v', 'mov', 'mp4', 'ogv', 'webm']);
const FONTS = new Set(['otf', 'ttf', 'woff', 'woff2']);
const TABLE_ROW_CAP = 2_000;

export interface DelimitedTable {
  header: string[];
  rows: string[][];
  totalRows: number;
  columnCount: number;
  truncated: boolean;
}

/** File preview behavior follows the file's final extension, case-insensitively. */
export function fileKindOf(path: string): WorkspaceFileKind {
  const extension = extensionOf(path);

  if (['md', 'markdown', 'mdx'].includes(extension)) return 'markdown';
  if (['htm', 'html'].includes(extension)) return 'html';
  if (['json', 'jsonc'].includes(extension)) return 'json';
  if (['csv', 'tsv'].includes(extension)) return 'table';
  if (extension === 'svg') return 'svg';
  if (IMAGES.has(extension)) return 'image';
  if (extension === 'pdf') return 'pdf';
  if (AUDIO.has(extension)) return 'audio';
  if (VIDEO.has(extension)) return 'video';
  if (FONTS.has(extension)) return 'font';
  return 'text';
}

/** The built-in CodeBlock highlighter's language name, if it knows the extension. */
export function languageOf(path: string): string | undefined {
  return LANGUAGES[extensionOf(path)];
}

export function delimiterForPath(path: string): ',' | '\t' {
  return path.toLowerCase().endsWith('.tsv') ? '\t' : ',';
}

/** Parse CSV/TSV while retaining only the rows a preview can show. */
export function parseDelimitedText(
  content: string,
  delimiter: ',' | '\t',
  rowCap = TABLE_ROW_CAP,
): DelimitedTable {
  const records: string[][] = [];
  let totalRecords = 0;
  let field = '';
  let record: string[] = [];
  let quoted = false;
  let recordHasContent = false;

  const pushRecord = (): void => {
    record.push(field);
    field = '';
    const blank = record.length === 1 && record[0] === '' && !recordHasContent;
    if (!blank) {
      if (totalRecords === 0 || records.length <= rowCap) records.push(record);
      totalRecords += 1;
    }
    record = [];
    recordHasContent = false;
  };

  const source = content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]!;
    if (quoted) {
      if (char === '"') {
        if (source[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
      recordHasContent = true;
      continue;
    }
    if (char === delimiter) {
      record.push(field);
      field = '';
      recordHasContent = true;
      continue;
    }
    if (char === '\n' || char === '\r') {
      if (char === '\r' && source[index + 1] === '\n') index += 1;
      pushRecord();
      continue;
    }
    field += char;
  }
  if (field.length > 0 || record.length > 0 || quoted) pushRecord();

  const header = records[0] ?? [];
  const rows = records.slice(1);
  const columnCount = records.reduce((max, entry) => Math.max(max, entry.length), 0);
  const totalRows = Math.max(0, totalRecords - 1);
  return { header, rows, totalRows, columnCount, truncated: rows.length < totalRows };
}

function extensionOf(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  return dot < 0 ? '' : name.slice(dot + 1).toLowerCase();
}
