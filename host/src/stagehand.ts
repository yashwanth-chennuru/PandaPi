export type StagehandHandle = {
  act: (instruction: string) => Promise<unknown>;
  extract: (instruction: string) => Promise<unknown>;
  close: () => Promise<void>;
};

/**
 * Optional local Stagehand. Never launches a browser or talks to Browserbase.
 * Only attaches when PANDAPI_CDP_URL is set (user already exposed DevTools on THIS browser).
 */
export async function tryConnectStagehand(): Promise<StagehandHandle | null> {
  const cdpUrl = process.env.PANDAPI_CDP_URL?.trim();
  if (!cdpUrl) return null;

  try {
    const mod = await import("@browserbasehq/stagehand");
    const localBrowser = (mod as { localBrowser?: { connect: (opts: { cdpUrl: string }) => Promise<unknown> } })
      .localBrowser;
    const Stagehand = (mod as { Stagehand?: { create: (opts: { browser: unknown; model?: unknown }) => Promise<unknown> } })
      .Stagehand;
    if (!localBrowser || !Stagehand) {
      console.error("PandaPi: Stagehand package loaded but v4 API (localBrowser/Stagehand) missing");
      return null;
    }

    const browser = await localBrowser.connect({ cdpUrl });
    const sh = (await Stagehand.create({
      browser,
      model: process.env.PANDAPI_STAGEHAND_MODEL || undefined,
    })) as {
      act: (instruction: string) => Promise<unknown>;
      extract: (instruction: string) => Promise<unknown>;
      close: () => Promise<void>;
    };

    return {
      act: (instruction) => sh.act(instruction),
      extract: (instruction) => sh.extract(instruction),
      close: async () => {
        try {
          await sh.close();
        } catch {
          // Stagehand does not close a browser it did not launch.
        }
      },
    };
  } catch (err) {
    console.error("PandaPi: Stagehand attach skipped:", err);
    return null;
  }
}
