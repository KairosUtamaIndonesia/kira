import { Button } from '@astryxdesign/core/Button';
import { Text } from '@astryxdesign/core/Text';
import type { Who } from './api/auth';
import Notice from './notice';

/**
 * What someone who signed in, but does not run Kira, is told.
 *
 * It says who to ask, and nothing about how Kira is administered. Naming the
 * command would hand the machine Kira runs on to everyone in the company who
 * can sign in, and the reader cannot run it besides — it needs a shell there,
 * which is not something this screen can give anybody. The internal docs are the
 * command's home, and the person who can use it is already reading them.
 *
 * The role is granted out of band, while this page is open, and the console reads
 * once at load and never polls — so this screen has to offer a way to look again,
 * or asking leads nowhere. Reloading is that way, and it is the same move signing
 * in and out make.
 */
export default function Refused({ who }: { who: Who }) {
  return (
    <Notice title="Kira administration">
      <Text color="secondary">
        You are signed in as {who.email}. Signing in says who you are, not what you may do.
      </Text>
      <Text color="secondary">
        This console is for the people who run Kira. Ask one of them for the administrator role.
      </Text>
      <Button
        label="Check again"
        onClick={() => {
          window.location.reload();
        }}
      />
    </Notice>
  );
}
