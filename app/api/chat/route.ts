import { NextRequest, NextResponse } from "next/server";
import { retrieveContext, verifyCitations } from "@/lib/rag";
import { db } from "@/lib/db";
import { chatStream, generateTitle, SYSTEM_PROMPT } from "@/lib/llm";
import { encryptMessage, decryptMessage } from "@/lib/message-crypto";
import { LOCAL_USER_ID } from "@/lib/local-auth";

export async function POST(req: NextRequest) {
  const { messages, conversationId, documentIds, attachedFiles, frenchMode } =
    await req.json();

  const lastUserMessage: string = messages[messages.length - 1]?.content ?? "";

  const hasDocuments = !!documentIds?.length;

  // Run session context, RAG retrieval, and document loading all in parallel
  const [sessionContext, context, documentContext] = await Promise.all([
    // Session memory
    (async () => {
      try {
        const sessions = await db.attorneySession.findMany({
          where: { userId: LOCAL_USER_ID, tool: "RESEARCH" },
          orderBy: { updatedAt: "desc" },
          select: { data: true },
          take: 15,
        });
        if (sessions.length === 0) return "";

        const keywords = lastUserMessage
          .toLowerCase()
          .split(/\s+/)
          .filter((w) => w.length > 3);

        const summaries: string[] = [];
        for (let i = 0; i < sessions.length; i++) {
          try {
            const parsed = JSON.parse(sessions[i].data);
            let data: { messages?: { role: string; content: string }[] };
            if (parsed && typeof parsed === "object" && "__enc" in parsed) {
              data = JSON.parse(decryptMessage(parsed.__enc));
            } else {
              data = parsed;
            }
            if (!data?.messages || data.messages.length === 0) continue;

            if (i < 5) {
              const pairs = data.messages
                .map((m) => `${m.role === "user" ? "User" : "Assistant"}: ${m.content.slice(0, 200)}`)
                .slice(0, 4);
              summaries.push(pairs.join("\n"));
              continue;
            }

            if (keywords.length > 0) {
              const text = data.messages.map((m) => m.content).join(" ").toLowerCase();
              const matchCount = keywords.filter((k) => text.includes(k)).length;
              if (matchCount >= 1) {
                const pairs = data.messages
                  .filter((m) => m.role === "assistant" && m.content.length > 30)
                  .map((m) => m.content.slice(0, 300));
                if (pairs.length > 0) summaries.push(pairs[0]);
              }
            }
          } catch {
            continue;
          }
          if (summaries.length >= 8) break;
        }
        if (summaries.length === 0) return "";
        return "The user's prior research sessions (use these for continuity and memory):\n\n" +
          summaries.map((s, i) => `--- Session ${i + 1} ---\n${s}`).join("\n\n");
      } catch (e) {
        console.error("[chat] Session context retrieval failed:", e);
        return "";
      }
    })(),
    // RAG retrieval
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
  let inThinkBlock = false;

  const readableStream = new ReadableStream({
    async start(controller) {
      try {
      for await (const text of stream) {
        fullResponse += text;
        chunkCount++;

        // Strip <think>...</think> blocks from Qwen3 responses
        let filtered = text;
        if (inThinkBlock) {
          const closeIdx = filtered.indexOf("</think>");
          if (closeIdx === -1) {
            continue; // still inside think block, skip entire chunk
          }
          filtered = filtered.slice(closeIdx + 8);
          inThinkBlock = false;
        }
        // Handle opening <think> tags (possibly multiple in one chunk)
        while (filtered.includes("<think>")) {
          const openIdx = filtered.indexOf("<think>");
          const closeIdx = filtered.indexOf("</think>", openIdx);
          if (closeIdx !== -1) {
            filtered = filtered.slice(0, openIdx) + filtered.slice(closeIdx + 8);
          } else {
            filtered = filtered.slice(0, openIdx);
            inThinkBlock = true;
            break;
          }
        }

        if (filtered) {
          controller.enqueue(new TextEncoder().encode(filtered));
        }
      }

      // Strip think blocks from fullResponse for storage
      fullResponse = fullResponse.replace(/<think>[\s\S]*?<\/think>/g, "").trim();

      console.log(`[chat] Stream complete -- ${chunkCount} chunks, ${fullResponse.length} chars`);

      // Citation verification — append footer for unverified citations
      if (context && fullResponse.length > 100) {
        try {
          const citations = await verifyCitations(fullResponse, context);
          const unverified = citations.filter((c) => !c.verified);
          if (unverified.length > 0) {
            const footer = "\n\n---\n*Note: The following citations could not be verified against Mizan's legal database and may be inaccurate:* " +
              unverified.map((c) => `**${c.citation}**`).join(", ");
            controller.enqueue(new TextEncoder().encode(footer));
            fullResponse += footer;
            console.log(`[chat] ${unverified.length}/${citations.length} citations unverified`);
          } else if (citations.length > 0) {
            console.log(`[chat] All ${citations.length} citations verified`);
          }
        } catch (e) {
          console.error("[chat] Citation verification failed:", e);
        }
      }

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
