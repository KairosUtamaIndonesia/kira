/** A bounded workspace file viewer, with explicit edit and save for text files. */
import { Icon } from '@astryxdesign/core/Icon';
import { IconButton } from '@astryxdesign/core/IconButton';
import { Markdown } from '@astryxdesign/core/Markdown';
import { Text } from '@astryxdesign/core/Text';
import { Tooltip } from '@astryxdesign/core/Tooltip';
import { useClipboard } from '@astryxdesign/core/hooks';
import {
  Check,
  Copy,
  Download,
  Eye,
  EyeOff,
  ListStart,
  Maximize2,
  Minimize2,
  Save,
  Search,
  WrapText,
} from 'lucide-react';
import { useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { EditorView } from '@codemirror/view';
import type { Reading } from './workbenchTabs';
import { delimiterForPath, fileKindOf, parseDelimitedText } from './filePreview';
import {
  CodeMirrorFile,
  openFileSearch,
  openGoToLine,
  setFileLineWrapping,
} from './codeMirrorFile';

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
  const [wrapLines, setWrapLines] = useState(false);
  const editor = useRef<EditorView | null>(null);
  const { copy, isCopied } = useClipboard({ announce: 'Copied to clipboard' });
  const { copy: copyPath, isCopied: isPathCopied } = useClipboard({ announce: 'File path copied' });

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
        return (
          <JsonPreview
            source={draft}
            path={path}
            wrapLines={wrapLines}
            onViewReady={(view) => {
              editor.current = view;
            }}
          />
        );
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
            wrapLines={wrapLines}
            onViewReady={(view) => {
              editor.current = view;
            }}
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
          {mode === 'edit' && dirty && (
            <FileAction
              label={busy ? 'Saving…' : 'Save'}
              icon={<Icon icon={Save} size="sm" />}
              isDisabled={busy}
              onClick={() => void save()}
            />
          )}
          {codeSurface && (
            <>
              <FileAction
                label={wrapLines ? 'Disable line wrapping' : 'Enable line wrapping'}
                icon={<Icon icon={WrapText} size="sm" />}
                isPressed={wrapLines}
                onClick={() => {
                  const next = !wrapLines;
                  setWrapLines(next);
                  setFileLineWrapping(editor.current, next);
                }}
              />
              <FileAction
                label="Find in file"
                icon={<Icon icon={Search} size="sm" />}
                onClick={() => openFileSearch(editor.current)}
              />
              <FileAction
                label="Go to line"
                icon={<Icon icon={ListStart} size="sm" />}
                onClick={() => openGoToLine(editor.current)}
              />
            </>
          )}
          <FileAction
            label={mode === 'preview' ? 'Edit' : 'Preview'}
            icon={<Icon icon={mode === 'preview' ? Eye : EyeOff} size="sm" />}
            isDisabled={busy}
            onClick={() => setMode(mode === 'preview' ? 'edit' : 'preview')}
          />
          <FileAction
            label={isCopied ? 'Copied file contents' : 'Copy file contents'}
            icon={<Icon icon={isCopied ? Check : Copy} size="sm" />}
            onClick={() => void copy(draft)}
          />
          <FileAction
            label={isPathCopied ? 'Copied file path' : 'Copy file path'}
            icon={<Icon icon={isPathCopied ? Check : Copy} size="sm" />}
            onClick={() => void copyPath(path)}
          />
          <FileAction
            label="Download file"
            icon={<Icon icon={Download} size="sm" />}
            onClick={() => downloadText(path, draft)}
          />
          <FileAction
            label={fullscreen ? 'Exit fullscreen' : 'Fullscreen'}
            icon={<Icon icon={fullscreen ? Minimize2 : Maximize2} size="sm" />}
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
            wrapLines={wrapLines}
            onViewReady={(view) => {
              editor.current = view;
            }}
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

function FileAction({
  label,
  icon,
  onClick,
  isDisabled = false,
  isPressed,
}: {
  label: string;
  icon: ReactNode;
  onClick: () => void;
  isDisabled?: boolean;
  isPressed?: boolean;
}) {
  return (
    <Tooltip content={label} placement="below">
      <IconButton
        label={label}
        icon={icon}
        size="sm"
        variant="ghost"
        className="file-viewer-action"
        isDisabled={isDisabled}
        aria-pressed={isPressed}
        onClick={onClick}
      />
    </Tooltip>
  );
}

function downloadText(path: string, content: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/plain;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = path.split('/').pop() || 'file';
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
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

function JsonPreview({
  source,
  path,
  wrapLines,
  onViewReady,
}: {
  source: string;
  path: string;
  wrapLines: boolean;
  onViewReady: (view: EditorView | null) => void;
}) {
  let formatted: string;
  try {
    formatted = JSON.stringify(JSON.parse(source), null, 2);
  } catch {
    formatted = source;
  }

  return (
    <CodeMirrorFile
      path={path}
      value={formatted}
      readOnly
      wrapLines={wrapLines}
      onViewReady={onViewReady}
      onChange={() => {}}
    />
  );
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
