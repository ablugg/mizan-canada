import { NextRequest, NextResponse } from "next/server";
import { retrieveContext } from "@/lib/rag";
import { db } from "@/lib/db";
import { chatStream, generateTitle, SYSTEM_PROMPT } from "@/lib/llm";
import { encryptMessage, decryptMessage } from "@/lib/message-crypto";
import { LOCAL_USER_ID } from "@/lib/local-auth";

export async function POST(req: NextRequest) {
  const { messages, conversationId, documentIds, attachedFiles, frenchMode } =
    await req.json();

  const lastUserMessage: string = messages[messages.length - 1]?.content ?? "";

  const hasDocuments = !!documentIds?.length;

  // Search past research sessions for relevant context
  const sessionContext = await (async () => {
    try {
      const sessions = await db.attorneySession.findMany({
        where: { userId: LOCAL_USER_ID, tool: "RESEARCH" },
        orderBy: { updatedAt: "desc" },
        select: { data: true },
        take: 20,
      });
      const keywords = lastUserMessage
        .toLowerCase()
        .split(/\s+/)
        .filter((w) => w.length > 3);
      if (keywords.length === 0) return "";

      const relevant: string[] = [];
      for (const s of sessions) {
        try {
          const parsed = JSON.parse(s.data);
          let data: { messages?: { role: string; content: string }[] };
          if (parsed && typeof parsed === "object" && "__enc" in parsed) {
            data = JSON.parse(decryptMessage(parsed.__enc));
          } else {
            data = parsed;
          }
          if (!data?.messages) continue;
          const text = data.messages.map((m) => m.content).join(" ").toLowerCase();
          const matchCount = keywords.filter((k) => text.includes(k)).length;
          if (matchCount >= Math.max(2, Math.ceil(keywords.length * 0.3))) {
            const pairs = data.messages
              .filter((m) => m.role === "assistant" && m.content.length > 50)
              .map((m) => m.content.slice(0, 400));
            if (pairs.length > 0) relevant.push(pairs[0]);
          }
        } catch {
          continue;
        }
        if (relevant.length >= 3) break;
      }
      if (relevant.length === 0) return "";
      return "Relevant findings from prior research sessions:\n" +
        relevant.map((r, i) => `[Session ${i + 1}] ${r}`).join("\n\n");
    } catch (e) {
      console.error("[chat] Session context retrieval failed:", e);
      return "";
    }
  })();

  const [context, documentContext] = await Promise.all([
    hasDocuments
      ? Promise.resolve("")
      : retrieveContext(lastUserMessage).then((ctx) => {
          console.log(`[chat] RAG context length=${ctx.length} chars`);
          return ctx;
        }).catch((err) => {
          console.error("[chat] RAG retrieval failed, proceeding without context:", err);
          return "";
        }),
    (async () => {
      if (!hasDocuments) return "";
      try {
        const docs = await db.document.findMany({
          where: { id: { in: documentIds }, userId: LOCAL_USER_ID },
          select: { id: true, name: true, content: true, encryptedContent: true },
        });

        const parts = await Promise.all(
          docs.map(async (doc) => {
            let text = doc.content;
            if (
              (text === "[server-encrypted]" || text === "[encrypted]") &&
              doc.encryptedContent
            ) {
              try {
                text = decryptMessage(doc.encryptedContent);
              } catch {
                text = "[document decryption failed]";
              }
            }
            const truncated = text.slice(0, 20_000);
            return `--- Document: ${doc.name} ---\n${truncated}\n---`;
          })
        );

        const result = parts.join("\n\n");
        console.log(`[chat] Loaded ${docs.length} document(s), context=${result.length} chars`);
        return result;
      } catch (e) {
        console.error("[chat] Failed to load documents:", e);
        return "";
      }
    })(),
  ]);

  const systemWithContext = [
    SYSTEM_PROMPT,
    frenchMode
      ? "IMPORTANT: You must respond exclusively in French, regardless of the language used by the user. Do not use any other language in your response."
      : "IMPORTANT: You must respond exclusively in English, regardless of the language used by the user. Do not use French, Chinese, or any other language in your response.",
    context ? `Relevant legal context:\n${context}` : null,
    documentContext ? `Uploaded documents for review:\n${documentContext}` : null,
    sessionContext || null,
  ]
    .filter(Boolean)
    .join("\n\n");

  // Verify conversation ownership and save user message
  let validConversationId: string | null = conversationId ?? null;
  if (validConversationId) {
    const exists = await db.conversation.findUnique({
      where: { id: validConversationId },
      select: { id: true },
    });
    if (!exists) {
      console.warn(`[chat] Conversation ${validConversationId} not found`);
      validConversationId = null;
    } else {
      await db.message.create({
        data: {
          conversationId: validConversationId,
          role: "user",
          content: "[server-encrypted]",
          encryptedContent: encryptMessage(lastUserMessage),
          ...(attachedFiles?.length ? { attachedFiles: JSON.stringify(attachedFiles) } : {}),
        },
      });
    }
  }

  // Keep only last 6 messages (3 exchanges) to limit prompt size and speed up inference
  const trimmedMessages = messages.slice(-6);

  const stream = chatStream(trimmedMessages, context, systemWithContext);

  let fullResponse = "";
  let chunkCount = 0;

  const readableStream = new ReadableStream({
    async start(controller) {
      try {
      for await (const text of stream) {
        fullResponse += text;
        chunkCount++;
        controller.enqueue(new TextEncoder().encode(text));
      }

      console.log(`[chat] Stream complete -- ${chunkCount} chunks, ${fullResponse.length} chars`);

      if (validConversationId) {
        await db.message.create({
          data: {
            conversationId: validConversationId,
            role: "assistant",
            content: "[server-encrypted]",
            encryptedContent: encryptMessage(fullResponse),
          },
        });

        await db.conversation.update({
          where: { id: validConversationId },
          data: { updatedAt: new Date() },
        });

        const messageCount = await db.message.count({
          where: { conversationId: validConversationId },
        });

        const isGreeting =
          /^(hi|hello|hey|good\s+morning|good\s+afternoon|good\s+evening|howdy|greetings|bonjour|salut|allô)[\s!,.?]*$/i.test(
            lastUserMessage.trim()
          );

        const shouldTitle =
          (messageCount === 2 && !isGreeting) ||
          (messageCount === 4 &&
            (
              await db.conversation.findUnique({
                where: { id: validConversationId },
                select: { title: true },
              })
            )?.title === "New Conversation");

        if (shouldTitle) {
          try {
            const newTitle = await generateTitle(lastUserMessage, fullResponse);
            await db.conversation.update({
              where: { id: validConversationId },
              data: { title: "enc:" + encryptMessage(newTitle) },
            });
          } catch (e) {
            console.error("[chat] Failed to generate title", e);
          }
        }
      }

      controller.close();
      } catch (streamErr) {
        console.error("[chat] Stream error:", streamErr);
        const errMsg = streamErr instanceof Error ? streamErr.message : String(streamErr);
        controller.enqueue(new TextEncoder().encode(`\n\n[Error: ${errMsg}]`));
        controller.close();
      }
    },
  });

  return new Response(readableStream, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
