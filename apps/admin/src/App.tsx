import { Text } from '@astryxdesign/core/Text';
import { type ReactElement, use } from 'react';
import type { Opening } from './api/opening';
import Console from './console';
import Notice from './notice';
import Refused from './refused';
import SignIn from './signIn';

/**
 * Which of the console's four answers to draw.
 *
 * The return type is named so that adding an outcome without a screen for it stops
 * the build, rather than drawing nothing at all.
 */
export default function App({ opening }: { opening: Promise<Opening> }): ReactElement {
  const found = use(opening);

  switch (found.kind) {
    case 'signed-out':
      return <SignIn />;
    case 'refused':
      return <Refused who={found.who} />;
    case 'admin':
      return <Console who={found.who} users={found.users} readings={found.readings} />;
    case 'failed':
      return (
        <Notice title="Kira administration">
          <Text color="secondary">{found.message}</Text>
        </Notice>
      );
  }
}
