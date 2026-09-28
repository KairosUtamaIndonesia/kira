/** A bounded workspace file viewer, with explicit edit and save for text files. */
import { Button } from '@astryxdesign/core/Button';
import { Markdown } from '@astryxdesign/core/Markdown';
import { Text } from '@astryxdesign/core/Text';
import { useRef, useState } from 'react';
import type { Reading } from './workbenchTabs';
import { delimiterForPath, fileKindOf, parseDelimitedText } from './filePreview';
import { CodeMirrorFile } from './codeMirrorFile';

export function FileTab({
  chatId,
  path,
  reading,
}: {
  chatId: string;
  path: string;
  reading: Reading | undefined;
}) {
  if (reading === undefined) return null;
  return <LoadedFileTab key={`${chatId}:${path}`} chatId={chatId} path={path} reading={reading} />;
}

function LoadedFileTab({
  chatId,
  path,
  reading,
}: {
  chatId: string;
  path: string;
  reading: Reading;
}) {
  const [original, setOriginal] = useState(reading.kind === 'text' ? reading.text : '');
  const [draft, setDraft] = useState(reading.kind === 'text' ? reading.text : '');
  const content = useRef({
    original: reading.kind === 'text' ? reading.text : '',
    draft: reading.kind === 'text' ? reading.text : '',
  });
  const [mode, setMode] = useState<'preview' | 'edit'>('preview');
  const [busy, setBusy] = useState(false);
  const [trouble, setTrouble] = useState<string | null>(null);
  const [fullscreen, setFullscreen] = useState(false);

  if (reading.kind === 'refused') {
    return (
      <Text type="supporting" color="secondary">
        {reading.reason}
      </Text>
    );
  }

  if (reading.kind === 'asset') {
    return <AssetPreview path={path} dataUrl={reading.dataUrl} mimeType={reading.mimeType} />;
  }

  const kind = fileKindOf(path);
  const codeSurface = kind === 'text' || kind === 'json' || mode === 'edit';
  const dirty = draft !== original;

  async function save(): Promise<void> {
    const expected = content.current.original;
    const next = content.current.draft;
    setBusy(true);
    setTrouble(null);
    try {
      const result = await window.kira.writeWorkspaceFile(chatId, path, expected, next);
      if (!result.ok) {
        setTrouble(result.error);
      } else {
        content.current.original = next;
        setOriginal(next);
      }
    } catch (error) {
      setTrouble(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  const rendered = (() => {
    switch (kind) {
      case 'markdown':
        return <Markdown>{draft}</Markdown>;
      case 'html':
        return <iframe className="file-preview-html" sandbox="" srcDoc={draft} title={path} />;
      case 'json':
        return <JsonPreview source={draft} path={path} />;
      case 'table':
        return <TablePreview source={draft} path={path} />;
      case 'image':
      case 'svg':
      case 'pdf':
      case 'audio':
      case 'video':
      case 'font':
        return (
          <Text type="supporting" color="secondary">
            Loading preview…
          </Text>
        );
      case 'text':
        return (
          <CodeMirrorFile
            key={`${path}:${mode}`}
            path={path}
            value={draft}
            readOnly={mode === 'preview'}
            onChange={(next) => {
              content.current.draft = next;
              setDraft(next);
            }}
            onSave={mode === 'edit' ? () => void save() : undefined}
          />
        );
    }
  })();

  return (
    <div
      className={`file-viewer${fullscreen ? ' file-viewer-fullscreen' : ''}${codeSurface ? ' file-viewer-code' : ''}`}
    >
      <header className="file-viewer-toolbar">
        <Text type="supporting" color="secondary">
          {path}
        </Text>
        <div className="file-viewer-actions">
          <Button
            label={mode === 'preview' ? 'Edit' : 'Preview'}
            size="sm"
            variant="secondary"
            isDisabled={busy}
            onClick={() => setMode(mode === 'preview' ? 'edit' : 'preview')}
          />
          {mode === 'edit' && (
            <Button
              label={busy ? 'Saving…' : 'Save'}
              size="sm"
              variant="primary"
              isDisabled={!dirty || busy}
              onClick={() => void save()}
            />
          )}
          <Button
            label={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
            size="sm"
            variant="secondary"
            onClick={() => setFullscreen(!fullscreen)}
          />
        </div>
      </header>
      {trouble !== null && (
        <div className="file-viewer-error" role="alert">
          <Text type="supporting" color="secondary">
            {trouble}
          </Text>
        </div>
      )}
      <div className="file-viewer-content">
        {mode === 'edit' && kind !== 'text' ? (
          <CodeMirrorFile
            key={`${path}:${mode}`}
            path={path}
            value={draft}
            readOnly={false}
            onChange={(next) => {
              content.current.draft = next;
              setDraft(next);
            }}
            onSave={() => void save()}
          />
        ) : (
          rendered
        )}
      </div>
    </div>
  );
}

function AssetPreview({
  path,
  dataUrl,
  mimeType,
}: {
  path: string;
  dataUrl: string;
  mimeType: string;
}) {
  if (mimeType.startsWith('image/')) {
    return <img className="file-preview-image" src={dataUrl} alt={path} />;
  }
  if (mimeType === 'application/pdf') {
    return <iframe className="file-preview-document" src={dataUrl} title={path} />;
  }
  if (mimeType.startsWith('video/')) {
    return (
      <video className="file-preview-media" src={dataUrl} controls aria-label={path}>
        <track kind="captions" srcLang="en" label="Captions" src="data:text/vtt,WEBVTT%0A%0A" />
      </video>
    );
  }
  if (mimeType.startsWith('audio/')) {
    return (
      <audio className="file-preview-media" src={dataUrl} controls aria-label={path}>
        <track kind="captions" srcLang="en" label="Captions" src="data:text/vtt,WEBVTT%0A%0A" />
      </audio>
    );
  }
  return (
    <div className="file-preview-font">
      <style>{`@font-face{font-family:KiraWorkspacePreview;src:url("${dataUrl}")}`}</style>
      <Text type="supporting" color="secondary">
        Font specimen
      </Text>
      <p style={{ fontFamily: 'KiraWorkspacePreview, sans-serif' }}>
        Aa Bb Cc 0123 — The quick brown fox jumps over the lazy dog.
      </p>
    </div>
  );
}

function JsonPreview({ source, path }: { source: string; path: string }) {
  let formatted: string;
  try {
    formatted = JSON.stringify(JSON.parse(source), null, 2);
  } catch {
    return <CodeMirrorFile path={path} value={source} readOnly onChange={() => {}} />;
  }

  return <CodeMirrorFile path={path} value={formatted} readOnly onChange={() => {}} />;
}

function TablePreview({ source, path }: { source: string; path: string }) {
  const table = parseDelimitedText(source, delimiterForPath(path));
  const header = table.header;
  return (
    <div className="file-preview-table-wrap">
      {table.truncated && (
        <output className="file-preview-table-meta">
          Showing the first {table.rows.length} of {table.totalRows} rows.
        </output>
      )}
      <table className="file-preview-table">
        <thead>
          <tr>
            {header.map((cell, index) => (
              <th key={index}>{cell}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {header.map((_, cellIndex) => (
                <td key={cellIndex}>{row[cellIndex] ?? ''}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
