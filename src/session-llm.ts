import type { LLMClient } from "./refinement";

export function createSessionLLMClient(client: any, model?: string): LLMClient {
  return {
    chat: async (params) => {
      let childSessionID: string | undefined;
      try {
        const created = await client.session.create({
          body: { title: "memx-refinement" },
        });
        childSessionID = created.data?.id ?? created.id;

        const promptBody: {
          parts: Array<{ type: string; text: string }>;
          system?: string;
          model?: { providerID: string; modelID: string };
        } = {
          parts: [{ type: "text", text: params.messages[0]?.content ?? "" }],
        };
        if (params.system) {
          promptBody.system = params.system;
        }
        if (model) {
          const parts = model.split("/");
          if (parts.length >= 2) {
            promptBody.model = { providerID: parts[0]!, modelID: parts.slice(1).join("/") };
          }
        }

        const res = await client.session.prompt({
          path: { id: childSessionID! },
          body: promptBody,
        });
        const parts = res.data?.parts ?? res.parts ?? [];
        return parts
          .filter((p: any) => p.type === "text")
          .map((p: any) => p.text ?? "")
          .join("");
      } finally {
        if (childSessionID) {
          await client.session
            .delete({ path: { id: childSessionID } })
            .catch(() => {});
        }
      }
    },
  };
}