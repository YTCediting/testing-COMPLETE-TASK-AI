export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  try {
    // =========================================================
    // OPENROUTER CONFIG
    // =========================================================

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

    // =========================================================
    // READ REQUEST
    // =========================================================

    const body = req.body || {};

    const model = String(body.model || defaultModel).trim();

    const message = String(body.message || "").trim();

    const attachments = Array.isArray(body.attachments)
      ? body.attachments.slice(0, 5)
      : [];

    // Message OR attachment is required
    if (!message && attachments.length === 0) {
      return res.status(400).json({
        error: "Message or attachment is required."
      });
    }

    // =========================================================
    // BUILD MULTIMODAL CONTENT
    // =========================================================

    const content = [];

    // User text
    content.push({
      type: "text",
      text:
        message ||
        "Please carefully analyze the attached file(s) and explain what they contain."
    });

    // Extra text extracted from text/code files
    const textFileParts = [];

    for (const attachment of attachments) {
      if (!attachment) continue;

      const name = String(
        attachment.name || "file"
      );

      const type = String(
        attachment.type || ""
      ).toLowerCase();

      const data = attachment.data;

      // ---------------------------------------------------------
      // IMAGE
      // ---------------------------------------------------------

      if (type.startsWith("image/")) {
        if (!data || typeof data !== "string") {
          continue;
        }

        content.push({
          type: "image_url",
          image_url: {
            url: data
          }
        });

        continue;
      }

      // ---------------------------------------------------------
      // PDF
      // ---------------------------------------------------------

      if (
        type === "application/pdf" ||
        name.toLowerCase().endsWith(".pdf")
      ) {
        if (!data || typeof data !== "string") {
          continue;
        }

        content.push({
          type: "file",
          file: {
            filename: name,
            file_data: data
          }
        });

        continue;
      }

      // ---------------------------------------------------------
      // TEXT / CODE FILE
      // ---------------------------------------------------------

      if (typeof attachment.text === "string") {
        textFileParts.push(
          `\n--- FILE: ${name} ---\n` +
          attachment.text.slice(0, 200000) +
          `\n--- END FILE: ${name} ---\n`
        );

        continue;
      }
    }

    // Add readable text/code files into the prompt
    if (textFileParts.length > 0) {
      content.push({
        type: "text",
        text:
          "\nThe following text/code files are also attached:\n" +
          textFileParts.join("\n")
      });
    }

    // =========================================================
    // OPENROUTER REQUEST
    // =========================================================

    const requestBody = {
      model,

      messages: [
        {
          role: "system",
          content:
            "You are the AI assistant inside a Study/Tickets web app. " +
            "Answer clearly, accurately and helpfully. " +
            "Use the user's language. " +
            "When an image is attached, actually inspect the image before answering. " +
            "When a PDF is attached, actually read and analyze its contents before answering. " +
            "Do not pretend to see or read information that is not present in the attachments."
        },

        {
          role: "user",
          content
        }
      ]
    };

    // Optional OpenRouter metadata headers
    const headers = {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",

      "HTTP-Referer":
        process.env.SITE_URL ||
        "https://complete-task-ai.vercel.app",

      "X-Title":
        process.env.SITE_NAME ||
        "Study Tickets AI"
    };

    // =========================================================
    // RETRY SYSTEM
    // =========================================================

    const maxAttempts = 3;

    let lastStatus = 500;
    let lastRaw = "";

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const upstream = await fetch(
          `${baseUrl}/chat/completions`,
          {
            method: "POST",
            headers,
            body: JSON.stringify(requestBody)
          }
        );

        const raw = await upstream.text();

        // =====================================================
        // SUCCESS
        // =====================================================

        if (upstream.ok) {
          let data;

          try {
            data = JSON.parse(raw);
          } catch {
            return res.status(502).json({
              error: "OpenRouter returned invalid JSON."
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
              details: JSON.stringify(data).slice(0, 2000)
            });
          }

          return res.status(200).json({
            output,
            model:
              data?.model ||
              model
          });
        }

        // =====================================================
        // ERROR
        // =====================================================

        lastStatus = upstream.status;
        lastRaw = raw;

        // Retry temporary errors
        const retryable =
          upstream.status === 408 ||
          upstream.status === 429 ||
          upstream.status === 500 ||
          upstream.status === 502 ||
          upstream.status === 503 ||
          upstream.status === 504 ||
          upstream.status === 529;

        if (!retryable || attempt === maxAttempts) {
          break;
        }

        // 1s → 2s
        await new Promise(resolve =>
          setTimeout(resolve, attempt * 1000)
        );

      } catch (error) {
        lastRaw =
          error?.message ||
          "Network error while contacting OpenRouter.";

        if (attempt === maxAttempts) {
          break;
        }

        await new Promise(resolve =>
          setTimeout(resolve, attempt * 1000)
        );
      }
    }

    // =========================================================
    // ALL ATTEMPTS FAILED
    // =========================================================

    let providerDetails = lastRaw;

    try {
      const parsed = JSON.parse(lastRaw);

      providerDetails =
        parsed?.error?.message ||
        parsed?.error?.details ||
        parsed?.message ||
        lastRaw;
    } catch {
      // Keep raw response
    }

    return res.status(lastStatus).json({
      error: `OpenRouter error (${lastStatus}).`,
      details: String(providerDetails).slice(0, 3000)
    });

  } catch (error) {
    console.error(error);

    return res.status(500).json({
      error:
        error?.message ||
        "Server error while contacting OpenRouter."
    });
  }
}
