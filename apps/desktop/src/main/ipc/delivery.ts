import {
  DELIVERY_CHANNELS,
  type DeliveryAudit,
  type DeliveryPath,
  type Result,
} from '../../preload/bridge.ts';
import { envelope, isId } from './result.ts';

export { DELIVERY_CHANNELS };

export interface DeliveryDeps {
  deliver(ticketId: string, workspaceId: string, path: DeliveryPath): Promise<DeliveryAudit>;
}

export interface DeliveryHandlers {
  deliver(ticketId: unknown, workspaceId: unknown, path: unknown): Promise<Result<DeliveryAudit>>;
}

export function deliveryHandlers({ deliver }: DeliveryDeps): DeliveryHandlers {
  return {
    deliver: (ticketId, workspaceId, path) => {
      if (!isId(ticketId) || !isId(workspaceId)) {
        return Promise.resolve({
          ok: false,
          error: 'Delivery needs an issue and execution workspace.',
        });
      }
      if (path !== 'local-merge' && path !== 'pull-request') {
        return Promise.resolve({
          ok: false,
          error: 'Delivery uses a local merge or pull request.',
        });
      }
      return envelope(() => deliver(ticketId, workspaceId, path));
    },
  };
}
