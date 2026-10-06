import { createRootRoute, createRoute, createRouter, RouterProvider } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import type { Readings } from './api/allowances';
import type { Who } from './api/auth';
import type { ListedUser } from './api/users';
import Audit from './audit';
import { ConsoleDataProvider } from './consoleData';
import People from './people';
import Pool from './pool';
import Shell from './shell';
import User from './user';

const rootRoute = createRootRoute({ component: Shell });

const peopleRoute = createRoute({ getParentRoute: () => rootRoute, path: '/', component: People });
const poolRoute = createRoute({ getParentRoute: () => rootRoute, path: '/pool', component: Pool });
const auditRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/audit',
  component: Audit,
});
const userRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/users/$id',
  component: function UserRoute() {
    const { id } = userRoute.useParams();
    return <User userId={id} />;
  },
});

const routeTree = rootRoute.addChildren([peopleRoute, poolRoute, auditRoute, userRoute]);

/**
 * The console itself: the router, and the opening data every screen reads.
 *
 * The routes are code rather than files, because there are four of them and a
 * generated tree would be more machinery than the thing it generates. The data
 * is React context rather than router context, so a screen can be drawn on its own
 * in a test without standing up a router.
 */
export default function Console({
  who,
  users: initial,
  readings,
}: {
  who: Who;
  users: ListedUser[];
  readings: Readings;
}) {
  const [users, setUsers] = useState(initial);
  const router = useMemo(() => createRouter({ routeTree, basepath: '/admin' }), []);

  const value = useMemo(
    () => ({
      who,
      users,
      readings,
      updateUser: (changed: Partial<ListedUser> & { id: string }) =>
        setUsers((current) =>
          current.map((person) => (person.id === changed.id ? { ...person, ...changed } : person)),
        ),
    }),
    [who, users, readings],
  );

  return (
    <ConsoleDataProvider value={value}>
      <RouterProvider router={router} />
    </ConsoleDataProvider>
  );
}
