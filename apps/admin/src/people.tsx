import { Badge } from '@astryxdesign/core/Badge';
import { EmptyState } from '@astryxdesign/core/EmptyState';
import { Heading } from '@astryxdesign/core/Heading';
import { proportional, Table, type TableColumn } from '@astryxdesign/core/Table';
import { Text } from '@astryxdesign/core/Text';
import { spacingVars } from '@astryxdesign/core/theme/tokens.stylex';
import { Link } from '@tanstack/react-router';
import * as stylex from '@stylexjs/stylex';
import { useState } from 'react';
import { isAdminRole } from './adminRole';
import type { Readings } from './api/allowances';
import type { ListedUser } from './api/users';
import AllowanceCell from './allowanceCell';
import { useConsoleData } from './consoleData';
import DefaultAllowance from './defaultAllowance';

const styles = stylex.create({
  page: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacingVars['--spacing-5'],
    padding: spacingVars['--spacing-8'],
    '@media (max-width: 48rem)': {
      gap: spacingVars['--spacing-4'],
      padding: spacingVars['--spacing-5'],
    },
    '@media (max-width: 32rem)': {
      padding: spacingVars['--spacing-4'],
    },
  },
  pageHeader: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacingVars['--spacing-2'],
    maxWidth: '72ch',
  },
  peopleTable: {
    minWidth: 0,
  },
});

/** The role, badged as the one that runs Kira or the ordinary one. */
function Role({ role }: { role: string }) {
  return <Badge label={role} variant={isAdminRole(role) ? 'info' : 'neutral'} />;
}

function columnsFor(readings: Readings): TableColumn<ListedUser>[] {
  return [
    {
      key: 'name',
      header: 'Name',
      width: proportional(1, { minWidth: 140 }),
      renderCell: (user) => (
        <Link to="/users/$id" params={{ id: user.id }}>
          {user.name}
        </Link>
      ),
    },
    {
      key: 'email',
      header: 'Email',
      width: proportional(1, { minWidth: 140 }),
      renderCell: (user) => user.email,
    },
    {
      key: 'role',
      header: 'Role',
      width: proportional(1, { minWidth: 140 }),
      renderCell: (user) => <Role role={user.role} />,
    },
    {
      key: 'allowance',
      header: 'Allowance',
      width: proportional(1.25, { minWidth: 160 }),
      renderCell: (user) => <AllowanceCell reading={readings[user.id]} />,
    },
    {
      key: 'standing',
      header: 'Standing',
      width: proportional(1, { minWidth: 140 }),
      renderCell: (user) => (user.banned ? 'Suspended' : 'Active'),
    },
  ];
}

/**
 * The console: everyone who has signed in, what they may do, and what they have
 * spent of the pool.
 *
 * A row opens that person's own page, where every lever lives. The default
 * allowance sits above the list it governs, and changing it moves every row that
 * has no override of its own — which is what the screen must show, not just what
 * the server did.
 */
export default function People() {
  const { users, readings: opened } = useConsoleData();
  const [readings, setReadings] = useState(opened);

  /** A new default moves every reading that has no number of its own. */
  function applyDefault(tokens: number) {
    setReadings((current) =>
      Object.fromEntries(
        Object.entries(current).map(([id, reading]) => [
          id,
          reading.ok && reading.value.override === null
            ? { ok: true, value: { ...reading.value, allowance: tokens } }
            : reading,
        ]),
      ),
    );
  }

  return (
    <div {...stylex.props(styles.page)}>
      <header {...stylex.props(styles.pageHeader)}>
        <Heading level={1}>People</Heading>
        <Text color="secondary">
          Everyone who has signed in to Kira. Signing in says who someone is, never what they may
          do, so this list is the whole company until a role says otherwise. Open a person to change
          what they may do, or what they may spend of the shared pool.
        </Text>
      </header>
      <DefaultAllowance onChanged={applyDefault} />
      <div {...stylex.props(styles.peopleTable)}>
        <Table
          data={users}
          idKey="id"
          columns={columnsFor(readings)}
          emptyState={
            <EmptyState
              title="Nobody has signed in yet"
              description="A person appears here once they have signed in from the desktop."
            />
          }
        />
      </div>
    </div>
  );
}
