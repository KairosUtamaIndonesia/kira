import { Button } from '@astryxdesign/core/Button';
import { Heading } from '@astryxdesign/core/Heading';
import { Text } from '@astryxdesign/core/Text';

/**
 * What the window shows when nobody is signed in.
 *
 * Nothing in the app can reach a model without a key, so this is the whole of
 * what a machine that has not signed in has to do: start the sign-in, which
 * leaves for the system browser and finds its own way back. Nothing is typed
 * and nothing is pasted (docs/adr/0004-sign-in.md).
 *
 * The button waits for the first answer about who is signed in before it can be
 * pressed. Until that answer arrives the app does not know whether it is already
 * signed in, and a sign-in started by mistake is a browser window nobody asked
 * for.
 */
export function SignIn({ known, onSignIn }: { known: boolean; onSignIn: () => void }) {
  return (
    <main className="sign-in">
      <Heading level={1}>Kira</Heading>
      <Text color="secondary">Sign in with your company Microsoft account.</Text>
      <Button label="Sign in with Microsoft" isDisabled={!known} onClick={onSignIn} />
    </main>
  );
}
