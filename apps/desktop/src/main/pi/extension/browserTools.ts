import type { AgentToolResult, ToolDefinition } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import type { BrowserOperation } from '../../browser/controller.ts';

const OPEN = Type.Object({
  url: Type.String({ description: 'HTTP or HTTPS address to open in this chat’s active browser.' }),
});
const SELECTOR = Type.Object({
  selector: Type.String({ description: 'CSS selector for an element in the active browser page.' }),
});
const FILL = Type.Object({
  selector: Type.String({ description: 'CSS selector for a text input or textarea.' }),
  text: Type.String({ description: 'Text to enter into the selected field.' }),
});
const EMPTY = Type.Object({});

type Operate = (chatId: string, operation: BrowserOperation) => Promise<unknown>;

/** Browser tools address only the selected browser tab belonging to this chat. */
export function browserTools(threadId: string, operate: Operate): ToolDefinition[] {
  const open: ToolDefinition<typeof OPEN> = {
    name: 'browser_open',
    label: 'Open browser page',
    description: 'Navigate this chat’s active browser tab to an HTTP or HTTPS address.',
    parameters: OPEN,
    async execute(_id, params) {
      return textResult(await operate(threadId, { action: 'navigate', url: params.url }));
    },
  };
  const snapshot: ToolDefinition<typeof EMPTY> = {
    name: 'browser_snapshot',
    label: 'Read browser page',
    description: 'Read the title, address and visible text of this chat’s active browser page.',
    parameters: EMPTY,
    async execute() {
      return textResult(await operate(threadId, { action: 'snapshot' }));
    },
  };
  const click: ToolDefinition<typeof SELECTOR> = {
    name: 'browser_click',
    label: 'Click browser element',
    description: 'Click one page element selected by a CSS selector.',
    parameters: SELECTOR,
    async execute(_id, params) {
      return textResult(await operate(threadId, { action: 'click', selector: params.selector }));
    },
  };
  const fill: ToolDefinition<typeof FILL> = {
    name: 'browser_fill',
    label: 'Fill browser field',
    description: 'Enter text into a page input or textarea selected by a CSS selector.',
    parameters: FILL,
    async execute(_id, params) {
      return textResult(
        await operate(threadId, {
          action: 'fill',
          selector: params.selector,
          text: params.text,
        }),
      );
    },
  };
  const screenshot: ToolDefinition<typeof EMPTY> = {
    name: 'browser_screenshot',
    label: 'Capture browser page',
    description: 'Capture the active browser tab’s visible viewport as an image.',
    parameters: EMPTY,
    async execute() {
      const image = await operate(threadId, { action: 'screenshot' });
      if (
        typeof image !== 'object' ||
        image === null ||
        !('type' in image) ||
        image.type !== 'image' ||
        !('data' in image) ||
        typeof image.data !== 'string'
      ) {
        throw new Error('The browser did not return a screenshot.');
      }
      return {
        content: [
          {
            type: 'image',
            data: image.data,
            mimeType:
              'mimeType' in image && typeof image.mimeType === 'string'
                ? image.mimeType
                : 'image/png',
          },
        ],
        details: undefined,
      };
    },
  };
  return [open, snapshot, click, fill, screenshot];
}

function textResult(value: unknown): AgentToolResult<undefined> {
  return {
    content: [
      {
        type: 'text',
        text: typeof value === 'string' ? value : (JSON.stringify(value) ?? 'No page content.'),
      },
    ],
    details: undefined,
  };
}
