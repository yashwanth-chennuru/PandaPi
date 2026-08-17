declare module "@browserbasehq/stagehand" {
  export const localBrowser: {
    connect: (opts: { cdpUrl: string }) => Promise<unknown>;
  };
  export const Stagehand: {
    create: (opts: { browser: unknown; model?: unknown }) => Promise<unknown>;
  };
}
