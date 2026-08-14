import { useState, useCallback, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Message } from "@/types";
import {
  loadOrGenerateKeypair,
  exportPublicKeyBase64,
  decryptEnclaveResponse,
} from "@/lib/enclave-activation";

interface UseChatOptions {
  conversationId: string;
}

// Strip (user, assistant) turn pairs where the assistant message is a placeholder
// (undecryptable from a prior session). Sending those to Claude destroys context.
function cleanHistoryForAPI(msgs: Message[]): Array<{ role: "user" | "assistant"; content: string }> {
  const out: Array<{ role: "user" | "assistant"; content: string }> = [];
  for (const msg of msgs) {
    const isPlaceholder =
      msg.role === "assistant" &&
      (msg.content === "[message from a previous session]" || msg.content === "[message unavailable]");
    if (isPlaceholder) {
      // Also remove the orphaned user turn that preceded it
      if (out.length > 0 && out[out.length - 1].role === "user") out.pop();
      continue;
    }
    out.push({ role: msg.role as "user" | "assistant", content: msg.content });
  }
  return out;
}

export function useChat({ conversationId }: UseChatOptions) {
  const router = useRouter();
  const [messages, setMessages] = useState<Message[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const realConversationId = useRef<string | null>(
    conversationId !== "new" ? conversationId : null
  );

  const clientKeypairRef = useRef<CryptoKeyPair | null>(null);
  const enclavePublicKeyRef = useRef<string | null>(null);

  // Holds the in-flight crypto init so the message-loading effect can await it.
  const cryptoInitRef = useRef<Promise<void>>(Promise.resolve());

  // Load keypair (persisted across sessions) + enclave public key on mount.
  useEffect(() => {
    cryptoInitRef.current = (async () => {
      try {
        clientKeypairRef.current = await loadOrGenerateKeypair();
        const res = await fetch("/api/enclave/public-key");
        if (res.ok) {
          const data = await res.json();
          enclavePublicKeyRef.current = data.public_key ?? null;
        }
      } catch {
        // Enclave unavailable (dev mode) — chat will use plaintext path
      }
    })();
  }, []);

  // Load conversation history on mount, but wait for crypto to be ready first
  // so we don't snapshot null refs before the keypair has been imported.
  useEffect(() => {
    if (conversationId === "new") return;
    setIsLoading(true);

    (async () => {
      try {
        // Ensure keypair + enclave key are ready before we try to decrypt
        await cryptoInitRef.current;

        const r = await fetch(`/api/conversations/${conversationId}/messages`, {
          credentials: "include",
        });
        const data = await r.json();

        if (data.notFound) {
          realConversationId.current = null;
          router.replace("/chat/new");
          return;
        }

        if (data.messages) {
          const keypair = clientKeypairRef.current;
          const enclavePublicKey = enclavePublicKeyRef.current;

          const resolved = await Promise.all(
            data.messages.map(
              async (msg: Message & { encryptedContent?: string | null; attachedFiles?: Array<{ name: string; size: number }> | null }) => {
                if (
                  msg.content === "[encrypted]" &&
                  msg.encryptedContent &&
                  keypair &&
                  enclavePublicKey
                ) {
                  try {
                    const parsed = JSON.parse(msg.encryptedContent);
                    // Streaming responses store an array of chunks; legacy stores a single object
                    const chunks: Array<{ ciphertext: string; nonce: string; salt?: string }> =
                      Array.isArray(parsed) ? parsed : [parsed];
                    const parts = await Promise.all(
                      chunks.map((chunk) =>
                        decryptEnclaveResponse(chunk, keypair.privateKey, enclavePublicKey)
                      )
                    );
                    return { ...msg, content: parts.join("") };
                  } catch {
                    return { ...msg, content: "[message from a previous session]" };
                  }
                }
                return msg;
              }
            )
          );

          setMessages(resolved);
        }
      } catch {
        // Network error — leave messages empty
      } finally {
        setIsLoading(false);
      }
    })();
  }, [conversationId, router]);

  const sendMessage = useCallback(
    async (content: string, files?: File[], frenchMode?: boolean) => {
      if (!content.trim() || isStreaming) return;

      if (!realConversationId.current) {
        try {
          const res = await fetch("/api/conversations", {
            method: "POST",
            credentials: "include",
            headers: { "Content-Type": "application/json" },
          });
          if (!res.ok) throw new Error(`Failed: ${res.status}`);
          const data = await res.json();
          if (!data.conversation?.id) throw new Error("No conversation returned");
          realConversationId.current = data.conversation.id;
          window.history.replaceState(null, "", `/chat/${realConversationId.current}`);
        } catch (e) {
          console.error("Failed to create conversation", e);
          return;
        }
      }

      // Show user message immediately so the UI never looks frozen
      const userMsg: Message = {
        id: crypto.randomUUID(),
        role: "user",
        content,
        createdAt: new Date(),
        ...(files?.length ? { attachedFiles: files.map((f) => ({ name: f.name, size: f.size })) } : {}),
      };
      setMessages((prev) => [...prev, userMsg]);
      setIsStreaming(true);

      window.dispatchEvent(
        new CustomEvent("conversations-updated", {
          detail: { id: realConversationId.current, preview: content },
        })
      );

      const aiId = crypto.randomUUID();
      setMessages((prev) => [
        ...prev,
        { id: aiId, role: "assistant", content: "", createdAt: new Date() },
      ]);

      // Upload files (now that the UI has updated) — errors surface inside the AI slot
      const documentIds: string[] = [];
      const documentMeta: Array<{ name: string; size: number }> = [];
      if (files?.length) {
        for (const file of files) {
          const form = new FormData();
          form.append("file", file);
          form.append("conversationId", realConversationId.current!);
          try {
            const res = await fetch("/api/documents", { method: "POST", credentials: "include", body: form });
            if (res.ok) {
              const data = await res.json();
              if (data.document?.id) {
                documentIds.push(data.document.id);
                documentMeta.push({ name: file.name, size: file.size });
              }
            } else {
              const err = await res.json().catch(() => ({}));
              console.error(`[useChat] Document upload failed (${res.status}):`, err);
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === aiId
                    ? { ...m, content: `Failed to attach "${file.name}": ${err.error ?? "upload error"}` }
                    : m
                )
              );
              setIsStreaming(false);
              return;
            }
          } catch (uploadErr) {
            console.error(`[useChat] Document upload threw:`, uploadErr);
            setMessages((prev) =>
              prev.map((m) =>
                m.id === aiId
                  ? { ...m, content: `Failed to attach "${file.name}": network error` }
                  : m
              )
            );
            setIsStreaming(false);
            return;
          }
        }
      }

      try {
        abortRef.current = new AbortController();

        // Export ephemeral public key for this request
        let clientPublicKey: string | undefined;
        if (clientKeypairRef.current) {
          clientPublicKey = await exportPublicKeyBase64(
            clientKeypairRef.current.publicKey
          );
        }

        const response = await fetch("/api/chat", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            conversationId: realConversationId.current,
            messages: [...cleanHistoryForAPI(messages), { role: "user" as const, content: userMsg.content }],
            clientPublicKey,
            ...(documentIds.length ? { documentIds } : {}),
            ...(documentMeta.length ? { attachedFiles: documentMeta } : {}),
            ...(frenchMode ? { frenchMode: true } : {}),
          }),
          signal: abortRef.current.signal,
        });

        if (response.status === 429) {
          const data = await response.json().catch(() => ({}));
          const e = new Error(data.error ?? "Daily message limit reached.");
          (e as Error & { status: number }).status = 429;
          throw e;
        }
        if (!response.ok) throw new Error("Request failed");

        let accumulated = "";
        let displayed = "";
        let animating = false;
        // Enclave delivers all text at once — use a larger step so the animation
        // completes in ~1-2s instead of crawling through thousands of characters.
        let animStep = 3; // overridden below for enclave path

        function animateNext() {
          if (displayed.length >= accumulated.length) {
            animating = false;
            // Set final content only when the animation naturally completes.
            // (Calling setMessages before this causes the full text to flash
            // then rewind, which is what made enclave responses look broken.)
            setMessages((prev) =>
              prev.map((m) => (m.id === aiId ? { ...m, content: accumulated } : m))
            );
            return;
          }
          const step = Math.min(animStep, accumulated.length - displayed.length);
          displayed += accumulated.slice(displayed.length, displayed.length + step);
          const snap = displayed;
          setMessages((prev) =>
            prev.map((m) => (m.id === aiId ? { ...m, content: snap } : m))
          );
          requestAnimationFrame(animateNext);
        }

        const contentType = response.headers.get("Content-Type") ?? "";

        if (contentType.includes("application/x-ndjson")) {
          // Enclave streaming path: each line is a JSON-encoded encrypted chunk
          if (!response.body) throw new Error("No response body");
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let lineBuffer = "";

          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            lineBuffer += decoder.decode(value, { stream: true });

            const lines = lineBuffer.split("\n");
            lineBuffer = lines.pop() ?? "";

            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed) continue;
              try {
                const chunk = JSON.parse(trimmed) as { ciphertext: string; nonce: string; salt?: string };
                if (clientKeypairRef.current && enclavePublicKeyRef.current) {
                  const plainChunk = await decryptEnclaveResponse(
                    chunk,
                    clientKeypairRef.current.privateKey,
                    enclavePublicKeyRef.current
                  );
                  accumulated += plainChunk;
                  if (!animating) {
                    animating = true;
                    requestAnimationFrame(animateNext);
                  }
                }
              } catch {
                // Skip malformed or undecryptable chunk
              }
            }
          }
          // Stream done — jump animation to the end so isStreaming=false doesn't race
          // with a partially-animated message (which would send truncated context on follow-ups)
          displayed = accumulated;
          if (!animating) {
            setMessages((prev) =>
              prev.map((m) => (m.id === aiId ? { ...m, content: accumulated } : m))
            );
          }
        } else if (contentType.includes("application/json")) {
          // Legacy enclave path: full text arrives at once after decryption
          const data = await response.json();
          if (
            data.encrypted &&
            clientKeypairRef.current &&
            enclavePublicKeyRef.current
          ) {
            accumulated = await decryptEnclaveResponse(
              data.encrypted,
              clientKeypairRef.current.privateKey,
              enclavePublicKeyRef.current
            );
          }
          // Step size: aim for ~1.5s animation at 60fps regardless of length
          animStep = Math.max(8, Math.ceil(accumulated.length / 90));
          if (accumulated) {
            animating = true;
            requestAnimationFrame(animateNext);
          }
        } else {
          // Dev/direct path: plaintext stream — animate per chunk
          if (!response.body) throw new Error("No response body");
          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            accumulated += decoder.decode(value, { stream: true });
            if (!animating) {
              animating = true;
              requestAnimationFrame(animateNext);
            }
          }
          // Safety net: if animation is still behind when stream ends, let it
          // finish naturally (animateNext will call setMessages on completion).
          // If it somehow never started, set content directly.
          if (!animating) {
            setMessages((prev) =>
              prev.map((m) => (m.id === aiId ? { ...m, content: accumulated } : m))
            );
          }
        }

        setTimeout(() => {
          window.dispatchEvent(new CustomEvent("conversations-updated"));
        }, 2000);
      } catch (err: unknown) {
        if (err instanceof Error && err.name !== "AbortError") {
          const isRateLimit = (err as Error & { status?: number }).status === 429;
          setMessages((prev) =>
            prev.map((m) =>
              m.id === aiId
                ? {
                    ...m,
                    content: isRateLimit
                      ? err.message
                      : "Something went wrong. Please try again.",
                  }
                : m
            )
          );
        }
      } finally {
        setIsStreaming(false);
        abortRef.current = null;
      }
    },
    [messages, isStreaming]
  );

  const stopStreaming = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  return { messages, isStreaming, isLoading, sendMessage, stopStreaming };
}
