export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const apiKey = process.env.AI_API_KEY;
    const baseUrl = (
      process.env.AI_BASE_URL || "https://openrouter.ai/api/v1"
    ).replace(/\/+$/, "");
    const defaultModel =
      process.env.AI_MODEL || "google/gemma-4-26b-a4b-it:free";

    if (!apiKey) {
      return res.status(500).json({
        error: "AI_API_KEY is missing in the deployment environment."
      });
    }

    const body = req.body || {};
    const model = String(body.model || defaultModel).trim();
    const message = String(body.message || "").trim();
    const attachments = Array.isArray(body.attachments)
      ? body.attachments.slice(0, 5)
      : [];

    if (!message && attachments.length === 0) {
      return res.status(400).json({
        error: "Message or attachment is required."
      });
    }

    // OpenRouter expects normal text chats as a string. Use a content array
    // only when an image/PDF/text attachment actually needs multimodal input.
    const parts = [];
    const textFileParts = [];
    let hasAttachment = false;

    if (message) {
      parts.push({ type: "text", text: message });
    }

    for (const attachment of attachments) {
      if (!attachment) continue;

      const name = String(attachment.name || "file");
      const type = String(attachment.type || "").toLowerCase();
      const data = attachment.data;

      if (type.startsWith("image/") && typeof data === "string" && data) {
        hasAttachment = true;
        parts.push({
          type: "image_url",
          image_url: { url: data }
        });
        continue;
      }

      if (
        (type === "application/pdf" || name.toLowerCase().endsWith(".pdf")) &&
        typeof data === "string" &&
        data
      ) {
        hasAttachment = true;
        parts.push({
          type: "file",
          file: {
            filename: name,
            file_data: data
          }
        });
        continue;
      }

      if (typeof attachment.text === "string" && attachment.text) {
        hasAttachment = true;
        textFileParts.push(
          `\n--- FILE: ${name} ---\n${attachment.text.slice(0, 200000)}\n--- END FILE: ${name} ---\n`
        );
      }
    }

    if (textFileParts.length) {
      parts.push({
        type: "text",
        text:
          "The following text/code files are attached:\n" +
          textFileParts.join("\n")
      });
    }

    const userContent = hasAttachment
      ? parts.length
        ? parts
        : [
            {
              type: "text",
              text: "Please carefully analyze the attached file(s)."
            }
          ]
      : message || "Please carefully analyze the attached file(s).";

    const requestBody = {
      model,
      messages: [
        {
          role: "system",
          content:
            "You are the AI assistant inside a Study/Tickets web app. " +
            "Answer clearly, accurately and helpfully. Use the user's language. " +
            "When an image is attached, inspect it before answering. " +
            "When a PDF is attached, read and analyze it before answering. " +
            "Do not pretend to see or read information that is not present."
        },
        {
          role: "user",
          content: userContent
        }
      ],
      max_tokens: 1024,
      provider: {
        allow_fallbacks: true
      }
    };

    const headers = {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": process.env.SITE_URL || "https://complete-task-ai.vercel.app",
      "X-Title": process.env.SITE_NAME || "Study Tickets AI"
    };

    const maxAttempts = 4;
    let lastStatus = 500;
    let lastRaw = "";

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const upstream = await fetch(`${baseUrl}/chat/completions`, {
          method: "POST",
          headers,
          body: JSON.stringify(requestBody)
        });

        const raw = await upstream.text();

        if (upstream.ok) {
          let data;
          try {
            data = JSON.parse(raw);
          } catch {
            return res.status(502).json({
              error: "OpenRouter returned invalid JSON.",
              details: raw.slice(0, 2000)
            });
          }

          const output =
            data?.choices?.[0]?.message?.content ??
            data?.output_text ??
            data?.output?.[0]?.content?.[0]?.text ??
            "";

          if (!output) {
            return res.status(502).json({
              error: "OpenRouter returned no text response.",
              details: JSON.stringify(data).slice(0, 3000)
            });
          }

          return res.status(200).json({
            output,
            model: data?.model || model
          });
        }

        lastStatus = upstream.status;
        lastRaw = raw;

        const retryable =
          upstream.status === 408 ||
          upstream.status === 429 ||
          upstream.status === 500 ||
          upstream.status === 502 ||
          upstream.status === 503 ||
          upstream.status === 504 ||
          upstream.status === 529;

        if (!retryable || attempt === maxAttempts) break;

        const retryAfter = Number(upstream.headers.get("retry-after"));
        const delay = Number.isFinite(retryAfter) && retryAfter > 0
          ? Math.min(retryAfter * 1000, 10000)
          : Math.min(attempt * 1500, 6000);

        await new Promise(resolve => setTimeout(resolve, delay));
      } catch (error) {
        lastRaw = error?.message || "Network error while contacting OpenRouter.";

        if (attempt === maxAttempts) break;

        await new Promise(resolve =>
          setTimeout(resolve, Math.min(attempt * 1500, 6000))
        );
      }
    }

    let providerDetails = lastRaw;

    try {
      const parsed = JSON.parse(lastRaw);
      const err = parsed?.error;

      providerDetails =
        err?.message ||
        err?.details ||
        err?.metadata?.raw ||
        parsed?.message ||
        lastRaw;
    } catch {
      // Keep raw response when it is not JSON.
    }

    return res.status(lastStatus).json({
      error: `OpenRouter error (${lastStatus}).`,
      details: String(providerDetails).slice(0, 3000)
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      error: error?.message || "Server error while contacting OpenRouter."
    });
  }
}
