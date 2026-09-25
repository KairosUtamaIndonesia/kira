/**
 * One open file, as the workbench's tab for it.
 *
 * Read-only in the plain sense: there is no input, nothing to save, and no way
 * to say a file was changed. What it shows is what the file held when its tab
 * was opened — reading it is the pane's to do, so that an answer always lands
 * under the chat and file that asked for it.
 *
 * A file that could not be read says why where its contents would be — too large
 * to read, or not text at all — rather than drawing an empty tab that reads as a
 * file with nothing in it.
 */
import { Text } from '@astryxdesign/core/Text';
import type { Reading } from './workbenchTabs';

/** Nothing while the file is being read: a file that is not known yet is not an empty one. */
export function FileTab({ reading }: { reading: Reading | undefined }) {
  if (reading === undefined) return null;

  if (reading.kind === 'refused') {
    return (
      <Text type="supporting" color="secondary">
        {reading.reason}
      </Text>
    );
  }

  // The theme's own rule gives a `pre` the code face; what is here is what the
  // pane adds to it, which is not wrapping the file's lines.
  return <pre className="file-tab-text">{reading.text}</pre>;
}
