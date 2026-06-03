export type AppReadyEvent = {
  readonly type: "app:ready";
  readonly packageName: "@kira/agent-runtime";
};

export type AppErrorEvent = {
  readonly type: "app:error";
  readonly message: string;
};

export type RuntimeEvent = AppReadyEvent | AppErrorEvent;
