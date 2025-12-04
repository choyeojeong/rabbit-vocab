// @ts-nocheck
// api/csv-prepare.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";

const MAX_INPUT_ROWS = 3; // 아주 작게
const MODEL = "gpt-4o-mini"; // 빠른 쪽으로

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    return res.status(200).end();
  }

  res.setHeader("Access-Control-Allow-Origin", "*");

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
  const rows: any[] = Array.isArray(body?.rows) ? body.rows : [];
  const limited = rows.slice(0, MAX_INPUT_ROWS);

  // 키가 아예 없으면 그냥 원본 돌려주기 (기존 동작 유지)
  if (!apiKey) {
    return res.status(200).json({ rows: limited });
  }

  // rows 형태를 예측해서 프롬프트 만들기
  const promptText = makePrompt(limited);

  try {
    const resp = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          {
            role: "system",
            content:
              "너는 영어단어 CSV를 우리 앱 형식으로 맞춰주는 도우미야. 반드시 JSON 배열만 출력해.",
          },
          {
            role: "user",
            content: promptText,
          },
        ],
        temperature: 0,
      }),
    });

    if (!resp.ok) {
      // OpenAI가 에러면 원본 돌려줌
      return res.status(200).json({ rows: limited });
    }

    const data = await resp.json();
    const content = data.choices?.[0]?.message?.content ?? "[]";

    // 모델이 이상하게 말하면 try/catch로 막기
    let parsed: any[] = [];
    try {
      parsed = JSON.parse(content);
      if (!Array.isArray(parsed)) parsed = [];
    } catch (e) {
      parsed = [];
    }

    // 혹시 비어있으면 원본이라도
    if (!parsed.length) {
      return res.status(200).json({ rows: limited });
    }

    // 여기서는 단순히 AI가 준 걸 그대로 넘겨줌.
    // 실제 "빈값 방지/머지"는 클라이언트(batchAiPrepare)에서 처리.
    return res.status(200).json({ rows: parsed });
  } catch (err) {
    // 최악의 경우에도 응답은 한다
    return res.status(200).json({ rows: limited });
  }
}

function makePrompt(rows: any[]) {
  // rows: [{book, chapter, term_en, meaning_ko, ...}, ...]
  // 이걸 우리가 원하는 컬럼으로 채워달라고 요청
  return `
다음 영어 단어 목록을 우리 앱에서 사용할 수 있는 형식으로 보정해줘.

반드시 지켜야 할 규칙:
1. 입력 배열의 길이와 순서를 절대 바꾸지 마.
   - 입력으로 N개의 행이 들어오면, 출력도 반드시 N개의 객체가 들어있는 JSON 배열이어야 해.
   - 행을 삭제하거나 추가하거나 재정렬하지 마.
2. 각 행은 아래 필드만 가져야 해.
   - "book" (string)
   - "chapter" (number)
   - "term_en" (string)
   - "meaning_ko" (string)
   - "pos" (string)
   - "accepted_ko" (string)
3. meaning_ko, pos, accepted_ko는 절대 빈 문자열("")로 두지 마.
   - 확실하지 않더라도 합리적으로 추측해서 채워.
   - 정말 애매한 경우에는 "의미 미상", "품사 미상"처럼 텍스트를 넣어.
   - 절대로 null 이나 빈 문자열("")을 넣지 마.
4. book, chapter, term_en 은 입력을 최대한 그대로 유지하면서 필요하면 보정해.
5. 출력은 JSON 배열 하나만, 다른 설명 문장 없이 순수 JSON만 반환해.

입력 예시(실제 데이터):
${JSON.stringify(rows, null, 2)}

출력 예시:
[
  {
    "book": "워드마스터 고등베이직 (메인, 2023개정)",
    "chapter": 1,
    "term_en": "apple",
    "meaning_ko": "사과",
    "pos": "명사",
    "accepted_ko": "사과, 사과 열매"
  }
]
  `.trim();
}
