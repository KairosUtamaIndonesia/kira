import { Heading } from '@astryxdesign/core/Heading';
import type { ReactNode } from 'react';

/**
 * The shape the console has before it is a console: one column in the middle of
 * the page, for what it has to say to someone who cannot use it yet.
 *
 * Both of those answers — sign in, or ask for the role — are the same page with
 * different words in it, so they are the same component.
 */
export default function Notice({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="notice">
      <Heading level={1}>{title}</Heading>
      {children}
    </main>
  );
}
