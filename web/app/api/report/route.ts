import type { ReportPayload } from "@/lib/types";
import { buildFindingsText, buildHeuristicReport, SYSTEM_PROMPT } from "@/lib/report";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  let payload: ReportPayload;
  try {
    payload = (await req.json()) as ReportPayload;
  } catch {
    return Response.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  if (!payload || typeof payload !== "object") {
    return Response.json({ error: "Missing findings payload." }, { status: 400 });
  }

  const findings = buildFindingsText(payload);
  const apiKey = process.env.OPENAI_API_KEY;

  if (apiKey) {
    const baseUrl = (process.env.OPENAI_BASE_URL || "https://api.openai.com/v1").replace(/\/$/, "");
    const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
    try {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 45000);
      try {
        const res = await fetch(`${baseUrl}/chat/completions`, {
          method: "POST",
          signal: ctl.signal,
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model,
            temperature: 0.4,
            max_tokens: 1400,
            messages: [
              { role: "system", content: SYSTEM_PROMPT },
              { role: "user", content: `FINDINGS:\n${findings}` },
            ],
          }),
        });
        if (res.ok) {
          const data = (await res.json()) as {
            choices?: { message?: { content?: string } }[];
          };
          const text = data.choices?.[0]?.message?.content?.trim();
          if (text) {
            return Response.json(
              { engine: "llm", model, text, findings },
              { headers: { "Cache-Control": "no-store" } },
            );
          }
        }
        // fall through to heuristic on any API problem
        const heuristic = buildHeuristicReport(payload, findings);
        return Response.json(
          {
            engine: "heuristic",
            model: null,
            text: heuristic,
            findings,
            llmNote: `LLM synthesis unavailable (HTTP ${res.status}); generated heuristic report instead.`,
          },
          { headers: { "Cache-Control": "no-store" } },
        );
      } finally {
        clearTimeout(timer);
      }
    } catch {
      /* fall through */
    }
  }

  return Response.json(
    {
      engine: "heuristic",
      model: null,
      text: buildHeuristicReport(payload, findings),
      findings,
      llmNote: apiKey ? undefined : "No OPENAI_API_KEY configured — heuristic synthesis used.",
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
