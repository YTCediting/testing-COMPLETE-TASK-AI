export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method not allowed"
    });
  }

  try {
    const apiKey = process.env.AI_API_KEY;
    const baseUrl = (
      process.env.AI_BASE_URL || "https://api.xkiro.com/v1"
    ).replace(/\/+$/, "");

    const defaultModel =
      process.env.AI_MODEL || "deepseek/deepseek-v4-pro";

    if (!apiKey) {
      return res.status(500).json({
        error: "AI_API_KEY is missing in the deployment environment."
      });
    }

    const body = req.body || {};
    const model = body.model || defaultModel;
    const message = String(body.message || "").trim();

    if (!message) {
      return res.status(400).json({
        error: "Message is required."
      });
    }

    const requestBody = {
      model,
      messages: [
        {
          role: "system",
          content:
            "You are the AI assistant inside a Study/Tickets web app. " +
            "Answer clearly, accurately and helpfully. Use the user's language."
        },
        {
          role: "user",
          content: message
        }
      ]
    };

    // Try up to 3 times for temporary provider/server errors
    const maxAttempts = 3;
    let lastStatus = 500;
    let lastRaw = "";

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const upstream = await fetch(`${baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${apiKey}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify(requestBody)
        });

        const raw = await upstream.text();

        if (upstream.ok) {
          let data;

          try {
            data = JSON.parse(raw);
          } catch {
            return res.status(502).json({
              error: "AI provider returned invalid JSON."
            });
          }

          const output =
            data?.choices?.[0]?.message?.content ??
            data?.output_text ??
            data?.output?.[0]?.content?.[0]?.text ??
            "";

          if (!output) {
            return res.status(502).json({
              error: "The provider returned no text response.",
              details: JSON.stringify(data).slice(0, 2000)
            });
          }

          return res.status(200).json({
            output
          });
        }

        lastStatus = upstream.status;
        lastRaw = raw;

        // Retry only temporary errors
        const retryable =
          upstream.status === 429 ||
          upstream.status === 500 ||
          upstream.status === 502 ||
          upstream.status === 503 ||
          upstream.status === 529;

        if (!retryable || attempt === maxAttempts) {
          break;
        }

        // Wait 1s, then 2s before retrying
        await new Promise(resolve =>
          setTimeout(resolve, attempt * 1000)
        );

      } catch (error) {
        lastRaw = error?.message || "Network error";

        if (attempt === maxAttempts) {
          break;
        }

        await new Promise(resolve =>
          setTimeout(resolve, attempt * 1000)
        );
      }
    }

    // All attempts failed
    return res.status(lastStatus).json({
      error: `AI provider error (${lastStatus}).`,
      details: lastRaw.slice(0, 2000)
    });

  } catch (error) {
    console.error(error);

    return res.status(500).json({
      error:
        error?.message ||
        "Server error while contacting the AI provider."
    });
  }
}
