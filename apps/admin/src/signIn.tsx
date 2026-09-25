import { Banner } from '@astryxdesign/core/Banner';
import { Button } from '@astryxdesign/core/Button';
import { Text } from '@astryxdesign/core/Text';
import { useState } from 'react';
import { signIn } from './api/auth';
import Notice from './notice';

/**
 * What a browser that is not signed in to Foundry at all is shown.
 *
 * Signing in leaves this page for Microsoft's and comes back to this address, so a
 * successful attempt draws nothing here: the page is loaded again with a session
 * on it. Only a failed one has anything to report, which is the one piece of state
 * this screen has.
 */
export default function SignIn() {
  const [failure, setFailure] = useState<string | null>(null);

  return (
    <Notice title="Foundry administration">
      <Text color="secondary">Sign in with your company Microsoft account.</Text>
      <Button
        label="Sign in with Microsoft"
        onClick={() => {
          void signIn().then((attempt) => {
            if (!attempt.ok) setFailure(attempt.message);
          });
        }}
      />
      {failure !== null && (
        <Banner status="error" title="Signing in did not work" description={failure} />
      )}
    </Notice>
  );
}
