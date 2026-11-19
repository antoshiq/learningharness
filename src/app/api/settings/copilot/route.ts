import { getConfig, writeSecrets } from "@/server/config";
import { handle, json } from "@/server/http";
import { copilotToken, pollDeviceLogin, startDeviceLogin, type DeviceCode } from "@/server/llm/copilot";

// The sign-in in progress. One owner, one browser: a single slot is enough,
// and the device code never leaves the server.
let pending: DeviceCode | null = null;

/** Sign in to GitHub for Copilot: `start` shows a code to type on github.com, `poll` checks whether it was entered. */
export const POST = (req: Request) =>
  handle(async () => {
    const { action } = (await req.json()) as { action: "start" | "poll" };
    if (action === "start") {
      pending = await startDeviceLogin();
      return json({ userCode: pending.userCode, verificationUri: pending.verificationUri, interval: pending.interval, expiresAt: pending.expiresAt });
    }
    if (action !== "poll") throw new Error("Неизвестное действие");
    if (!pending || pending.expiresAt < Date.now()) {
      pending = null;
      throw new Error("Код входа истёк. Начни вход заново.");
    }
    const r = await pollDeviceLogin(pending.deviceCode);
    if (r.status !== "done") return json({ status: r.status });
    pending = null;
    // Check that the account has Copilot before keeping the sign-in.
    await copilotToken(r.token);
    writeSecrets({ copilot: r.token });
    return json({ status: "done", config: getConfig() });
  });

/** Sign out: forget the GitHub token. */
export const DELETE = () =>
  handle(() => {
    pending = null;
    writeSecrets({ copilot: "" });
    return json(getConfig());
  });
