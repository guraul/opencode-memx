import { SignalBuffer, captureSignals } from "./signal-capture";
import { refine } from "./refinement";
import type { LLMClient } from "./refinement";
import { readUserMd, writeUserMd, applyProposal, backupUserMd, isOverLimit, parseUserMd, serializeUserMd } from "./user-md";
import { CATEGORIES, CATEGORY_HEADERS } from "./types";
import type { Category, StyleProposal } from "./types";

interface OpenCodeV2Message {
  role: string;
  content: string;
}

interface OpenCodeV2SessionContext {
  llm: {
    chat: (params: {
      system: string;
      messages: Array<{ role: string; content: string }>;
      temperature?: number;
      maxTokens?: number;
      model?: string;
    }) => Promise<{ choices?: Array<{ message?: { content?: string } }> }>;
  };
  ui: {
    confirm: (message: string, options?: { default?: boolean }) => Promise<boolean>;
  };
  messages?: OpenCodeV2Message[];
  pluginConfig?: Record<string, Record<string, unknown>>;
}

interface OpenCodeV2MessageContext extends OpenCodeV2SessionContext {
  message: OpenCodeV2Message;
}

const buffer = new SignalBuffer();

function createLLMClient(ctx: OpenCodeV2SessionContext): LLMClient {
  return {
    chat: async (params) => {
      const res = await ctx.llm.chat({
        system: params.system,
        messages: params.messages,
        temperature: params.temperature ?? 0.2,
        maxTokens: params.maxTokens ?? 1024,
      });
      return res.choices?.[0]?.message?.content ?? "";
    },
  };
}

async function runRefinement(ctx: OpenCodeV2SessionContext): Promise<void> {
  if (buffer.length === 0) return;

  const signals = buffer.getAll();
  const existingContent = readUserMd();
  const llm = createLLMClient(ctx);
  const pluginCfg = ctx.pluginConfig?.["opencode-memx"] as { refinementModel?: string } | undefined;
  const model = pluginCfg?.refinementModel;
  const proposals = await refine(signals, llm, existingContent, model);

  if (proposals.length === 0) return;

  const proposalLines = proposals
    .map((p, i) => {
      const actionLabel =
        p.action === "append" ? "➕" : p.action === "update" ? "✏️" : "🗑️";
      const catLabel = CATEGORY_HEADERS[p.category as Category] ?? p.category;
      return `[${i + 1}] ${actionLabel} ${catLabel}: ${p.content}\n   理由: ${p.reason}`;
    })
    .join("\n\n");

  const confirmed = await ctx.ui.confirm(
    `💡 [memx] 检测到 ${proposals.length} 条风格更新:\n\n${proposalLines}\n\n确认写入?`,
    { default: true },
  );

  if (!confirmed) return;

  let content = existingContent;
  for (const proposal of proposals) {
    content = applyProposal(proposal, content);
  }
  writeUserMd(content);
  buffer.clear();
}

export default {
  hooks: {
    "session.start": async (_ctx: OpenCodeV2SessionContext): Promise<void> => {
      try {
        const content = readUserMd();
        if (isOverLimit(content)) {
          backupUserMd();
          const sections = parseUserMd(content);
          const compressed = serializeUserMd(sections);
          writeUserMd(compressed);
        }
      } catch (err) {
        console.error("[memx] session.start error:", err);
      }
    },

    "message.complete": async (ctx: OpenCodeV2MessageContext): Promise<void> => {
      try {
        const userMessages = (ctx.messages ?? [])
          .filter((m) => m.role === "user")
          .map((m) => m.content);
        const lastUserMsg = userMessages[userMessages.length - 1] ?? "";
        const lastAiMsg = ctx.message?.content ?? "";

        const signals = captureSignals(lastUserMsg, lastAiMsg);
        buffer.pushAll(signals);
      } catch (err) {
        console.error("[memx] message.complete error:", err);
      }
    },

    "session.idle": async (ctx: OpenCodeV2SessionContext): Promise<void> => {
      try {
        await runRefinement(ctx);
      } catch (err) {
        console.error("[memx] session.idle error:", err);
      }
    },
  },

  tools: {
    reflect: {
      description: "手动触发 User Style 提炼（当 session.idle 未自动触发时使用）",
      parameters: {},
      execute: async (_params: unknown, ctx: OpenCodeV2SessionContext): Promise<string> => {
        try {
          await runRefinement(ctx);
          return `[memx] 提炼完成，已处理 ${buffer.length} 条信号。`;
        } catch (err) {
          return `[memx] 提炼失败: ${err}`;
        }
      },
    },

    edit_user_style: {
      description: "手动添加/修改一条 User Style 条目",
      parameters: {
        category: {
          type: "string",
          enum: ["communication", "toolchain", "architecture", "pitfall"],
          description: "条目分类",
        },
        content: {
          type: "string",
          maxLength: 100,
          description: "条目内容",
        },
        action: {
          type: "string",
          enum: ["append", "deprecate"],
          default: "append",
          description: "操作类型",
        },
      },
      execute: async (params: {
        category: string;
        content: string;
        action?: string;
      }): Promise<string> => {
        try {
          const cat = params.category as Category;
          if (!CATEGORIES.includes(cat)) {
            return `[memx] 无效分类。可选: ${CATEGORIES.join(", ")}`;
          }

          const existingContent = readUserMd();
          const proposal: StyleProposal = {
            action: (params.action as "append" | "deprecate") ?? "append",
            category: cat,
            content: params.content,
            reason: "用户手动添加",
          };
          const newContent = applyProposal(proposal, existingContent);
          writeUserMd(newContent);
          return `[memx] 已${params.action === "deprecate" ? "废弃" : "添加"}条目: ${params.content}`;
        } catch (err) {
          return `[memx] 操作失败: ${err}`;
        }
      },
    },
  },

  destroy: async (): Promise<void> => {
    buffer.clear();
  },
};
