/**
 * 음식 칼로리 추정 (Vercel 함수 + Vercel AI Gateway)
 *
 * POST /api/kcal   { "food": "김치찌개 1인분" }
 *  →  { "ok": true, "kcal": 450, "note": "1인분 기준" }
 *
 * 인증: Vercel 에 배포되면 OIDC 토큰으로 자동 인증돼요 (API 키 불필요).
 *       다른 곳에서 돌릴 땐 AI_GATEWAY_API_KEY 환경 변수를 쓰세요.
 * 모델: AI_GATEWAY_MODEL 환경 변수가 있으면 그 모델, 없으면 실행 시
 *       /v1/models 목록에서 가볍고 빠른 모델을 골라요.
 */
const GATEWAY = "https://ai-gateway.vercel.sh/v1";
// 선호 순서: 가볍고 빠른 모델 (목록에 실제로 있는 것만 사용)
const PREFER = [/^anthropic\/claude-haiku/, /^google\/gemini-[\d.]+-flash(?!-lite|-image)/, /^openai\/gpt-[\d.]+-mini$/];

let cachedModel = null;
async function pickModel(auth) {
  if (process.env.AI_GATEWAY_MODEL) return process.env.AI_GATEWAY_MODEL;
  if (cachedModel) return cachedModel;
  const r = await fetch(`${GATEWAY}/models`, { headers: auth ? { Authorization: `Bearer ${auth}` } : {} });
  if (!r.ok) throw new Error(`모델 목록을 못 불러왔어요 (${r.status})`);
  const ids = ((await r.json()).data || []).map((m) => m.id);
  for (const re of PREFER) {
    // 같은 계열이면 버전이 가장 높은(문자열상 뒤쪽) 모델
    const hit = ids.filter((id) => re.test(id)).sort().reverse()[0];
    if (hit) return (cachedModel = hit);
  }
  throw new Error("쓸 수 있는 모델을 찾지 못했어요");
}

// 아주 간단한 요청 제한 (같은 인스턴스에서 IP 당 1분 30회)
const hits = new Map();
function limited(ip) {
  const now = Date.now();
  const list = (hits.get(ip) || []).filter((t) => now - t < 60000);
  list.push(now);
  hits.set(ip, list);
  return list.length > 30;
}

module.exports = async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "POST only" });

  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
  const food = String((body && body.food) || "").trim().slice(0, 80);
  if (!food) return res.status(400).json({ ok: false, error: "음식 이름이 필요해요" });

  const ip = String(req.headers["x-forwarded-for"] || "").split(",")[0] || "?";
  if (limited(ip)) return res.status(429).json({ ok: false, error: "잠시 후 다시 시도해 주세요" });

  const auth = process.env.AI_GATEWAY_API_KEY || req.headers["x-vercel-oidc-token"] || process.env.VERCEL_OIDC_TOKEN;
  if (!auth) return res.status(500).json({ ok: false, error: "AI Gateway 인증 정보가 없어요" });

  try {
    const model = await pickModel(auth);
    const r = await fetch(`${GATEWAY}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${auth}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        temperature: 0,
        max_tokens: 120,
        messages: [
          {
            role: "system",
            content:
              "너는 한국 식품 영양 전문가야. 사용자가 적은 음식의 총 칼로리(kcal)를 추정해. " +
              "양이 없으면 한국에서 흔한 1인분/1개 기준으로 계산해. 여러 음식이면 합계를 내. " +
              '반드시 JSON 한 줄로만 답해: {"kcal": 정수, "note": "기준 양 (10자 이내)"}',
          },
          { role: "user", content: food },
        ],
      }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      const msg = (j.error && (j.error.message || j.error)) || `HTTP ${r.status}`;
      return res.status(502).json({ ok: false, error: String(msg).slice(0, 200) });
    }
    const text = String(j.choices?.[0]?.message?.content || "");
    let kcal = null, note = "";
    try {
      const m = text.match(/\{[\s\S]*\}/);
      const parsed = JSON.parse(m ? m[0] : text);
      kcal = Math.round(Number(parsed.kcal));
      note = String(parsed.note || "").slice(0, 20);
    } catch {
      const n = text.match(/\d{1,5}/);
      kcal = n ? Number(n[0]) : null;
    }
    if (!Number.isFinite(kcal) || kcal < 0 || kcal > 20000) return res.status(502).json({ ok: false, error: "칼로리를 읽지 못했어요" });
    return res.status(200).json({ ok: true, kcal, note, model });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e.message || e).slice(0, 200) });
  }
};
