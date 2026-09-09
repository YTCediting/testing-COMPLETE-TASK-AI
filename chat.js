export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const apiKey = process.env.AI_API_KEY;
    const baseUrl = (process.env.AI_BASE_URL || "https://api.openai.com/v1").replace(/\/+$/, "");
    const defaultModel = process.env.AI_MODEL || "gpt-5.3-codex-spark";

    if (!apiKey) {
      return res.status(500).json({
        error: "AI_API_KEY is missing in the deployment environment."
      });
    }

    const body = req.body || {};
    const model = body.model || defaultModel;
    const message = String(body.message || "").trim();

    if (!message) {
      return res.status(400).json({ error: "Message is required." });
    }

    // OpenAI-compatible Chat Completions endpoint.
    const upstream = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "system",
            content:
              "You are the AI assistant inside a Study/Tickets web app. " +
              "Answer clearly, accurately and helpfully. Use the user's language."
          },
          { role: "user", content: message }
        ]
      })
    });

    const raw = await upstream.text();

    if (!upstream.ok) {
      return res.status(upstream.status).json({
        error: `AI provider error (${upstream.status}).`,
        details: raw.slice(0, 2000)
      });
    }

    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      return res.status(502).json({ error: "AI provider returned invalid JSON." });
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

    return res.status(200).json({ output });
  } catch (error) {
    console.error(error);
    return res.status(500).json({
      error: error?.message || "Server error while contacting the AI provider."
    });
  }
}
