import type { Plugin } from "@opencode-ai/plugin";
import { tool } from "@opencode-ai/plugin";
import { SignalBuffer, captureSignals } from "./signal-capture";
import { refine } from "./refinement";
import type { LLMClient } from "./refinement";
import { createSessionLLMClient } from "./session-llm";
import {
  readUserMd,
  writeUserMd,
  applyProposal,
  isOverLimit,
  parseUserMd,
  serializeUserMd,
  backupUserMd,
} from "./user-md";
import { loadMemxConfig } from "./config";
import { shouldRun, markRun } from "./throttle";

const buffer = new SignalBuffer();

interface LastTurn {
  user: string;
  assistant: string;
}

function extractLastTurn(
  msgs: Array<{ info: { role: string }; parts: Array<{ type: string; text?: string }> }>,
): LastTurn | null {
  let lastUserIdx = -1;
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i]!.info.role === "user") {
      lastUserIdx = i;
      break;
    }
  }
  if (lastUserIdx === -1) return null;

  const userText = msgs[lastUserIdx]!.parts
    .filter((p) => p.type === "text")
    .map((p) => p.text ?? "")
    .join("");

  let assistantText = "";
  for (let i = msgs.length - 1; i > lastUserIdx; i--) {
    if (msgs[i]!.info.role === "assistant") {
      assistantText = msgs[i]!.parts
        .filter((p) => p.type === "text")
        .map((p) => p.text ?? "")
        .join("");
      break;
    }
  }

  return { user: userText, assistant: assistantText };
}

async function runRefinement(client: any, _sessionID: string): Promise<string> {
  if (buffer.length === 0) return "[memx] 无信号，跳过";

  const config = await loadMemxConfig();
  if (!shouldRun(config.throttleMinutes)) return "[memx] 节流中，跳过";

  const signals = buffer.getAll();
  const existingContent = readUserMd();
  const llm: LLMClient = createSessionLLMClient(client, config.refinementModel);
  const proposals = await refine(signals, llm, existingContent, config.refinementModel);

  if (proposals.length === 0) {
    markRun();
    return "[memx] 无可提炼偏好";
  }

  let content = existingContent;
  for (const proposal of proposals) {
    content = applyProposal(proposal, content);
  }

  if (isOverLimit(content)) {
    backupUserMd();
    const sections = parseUserMd(content);
    content = serializeUserMd(sections);
  }

  writeUserMd(content);
  markRun();
  buffer.clear();

  await client.app.log({
    body: {
      service: "memx",
      level: "info",
      message: `Updated USER.md: ${proposals.length} items`,
    },
  });

  return `[memx] 已写入 ${proposals.length} 条`;
}

export const MemxPlugin: Plugin = async ({ client }) => {
  return {
    event: async ({ event }) => {
      if (event.type !== "session.idle") return;
      try {
        const sessionID = (event as any).properties.sessionID as string;
        const res = await client.session.messages({ path: { id: sessionID } });
        const msgs = res.data ?? [];
        const last = extractLastTurn(msgs);
        if (last) {
          const signals = captureSignals(last.user, last.assistant);
          buffer.pushAll(signals);
        }
        await runRefinement(client, sessionID);
      } catch (err) {
        await client.app.log({
          body: {
            service: "memx",
            level: "error",
            message: String(err),
          },
        });
      }
    },

    tool: {
      reflect: tool({
        description: "手动触发 User Style 提炼（当 session.idle 未触发时使用）",
        args: {},
        async execute(_args, ctx) {
          try {
            const res = await client.session.messages({ path: { id: ctx.sessionID } });
            const msgs = res.data ?? [];
            const last = extractLastTurn(msgs);
            if (last) {
              const signals = captureSignals(last.user, last.assistant);
              buffer.pushAll(signals);
            }
            return await runRefinement(client, ctx.sessionID);
          } catch (err) {
            return `[memx] 失败: ${err}`;
          }
        },
      }),
    },

    dispose: async () => {
      buffer.clear();
    },
  };
};