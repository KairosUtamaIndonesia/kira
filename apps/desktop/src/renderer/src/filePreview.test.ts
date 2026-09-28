import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { delimiterForPath, fileKindOf, languageOf, parseDelimitedText } from './filePreview.ts';

interface KindCase {
  name: string;
  path: string;
  want: ReturnType<typeof fileKindOf>;
}

const KIND_CASES: KindCase[] = [
  { name: 'markdown gets a rendered preview', path: 'README.md', want: 'markdown' },
  { name: 'html gets an isolated preview', path: 'demo.html', want: 'html' },
  { name: 'json gets a structured preview', path: 'package.json', want: 'json' },
  { name: 'csv gets a table preview', path: 'data.csv', want: 'table' },
  {
    name: 'Mermaid documents remain source until a renderer is installed',
    path: 'flow.mmd',
    want: 'text',
  },
  {
    name: 'drawio documents remain source until a renderer is installed',
    path: 'system.drawio',
    want: 'text',
  },
  {
    name: 'Excalidraw documents remain source until a renderer is installed',
    path: 'notes.excalidraw',
    want: 'text',
  },
  { name: 'svg stays on a sanitized image surface', path: 'logo.svg', want: 'svg' },
  { name: 'raster images get an image preview', path: 'photo.webp', want: 'image' },
  { name: 'pdfs get a document preview', path: 'guide.pdf', want: 'pdf' },
  { name: 'audio gets a media preview', path: 'sound.wav', want: 'audio' },
  { name: 'video gets a media preview', path: 'clip.mp4', want: 'video' },
  { name: 'fonts get a specimen preview', path: 'type.woff2', want: 'font' },
  { name: 'ordinary sources use highlighted text', path: 'src/app.tsx', want: 'text' },
];

for (const testCase of KIND_CASES) {
  test(testCase.name, () => {
    assert.equal(fileKindOf(testCase.path), testCase.want);
  });
}

test('language names match the code highlighter for common source extensions', () => {
  assert.deepEqual(
    ['ts', 'tsx', 'js', 'jsx', 'py', 'rs', 'yaml'].map((extension) =>
      languageOf(`file.${extension}`),
    ),
    ['typescript', 'tsx', 'javascript', 'jsx', 'python', 'rust', 'yaml'],
  );
});

test('delimited previews keep quoted delimiters, newlines, and escaped quotes intact', () => {
  const table = parseDelimitedText(
    'id,note\r\n1,"a, b"\r\n2,"line one\nline two"\r\n3,"say ""hi"""\r\n',
    ',',
  );

  assert.deepEqual(table.rows, [
    ['1', 'a, b'],
    ['2', 'line one\nline two'],
    ['3', 'say "hi"'],
  ]);
});

test('delimited previews ignore a BOM and cap rendered rows while counting the whole file', () => {
  const source = `\uFEFFname\tvalue\n${Array.from({ length: 6 }, (_, index) => `${index}\t${index}`).join('\n')}`;
  const table = parseDelimitedText(source, delimiterForPath('data.TSV'), 3);

  assert.deepEqual(table.header, ['name', 'value']);
  assert.equal(table.rows.length, 3);
  assert.equal(table.totalRows, 6);
  assert.equal(table.truncated, true);
});
