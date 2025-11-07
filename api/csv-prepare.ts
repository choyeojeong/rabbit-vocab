// @ts-nocheck
// api/csv-prepare.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';

const MAX_INPUT_ROWS = 3; // 아주 작게
const MODEL = 'gpt-4o-mini'; // 빠른 쪽으로

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    return res.status(200).end();
  }

  res.setHeader('Access-Control-Allow-Origin', '*');

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    // 키 없으면 그냥 원본 돌려주기
    const fallbackRows = Array.isArray(req.body?.rows) ? req.body.rows : [];
    return res.status(200).json({ rows: fallbackRows });
  }

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  const rows: any[] = Array.isArray(body?.rows) ? body.rows : [];

  // 혹시라도 너무 많이 들어오면 자르기
  const limited = rows.slice(0, MAX_INPUT_ROWS);

  // rows 형태를 예측해서 프롬프트 만들기
  const promptText = makePrompt(limited);

  try {
    const resp = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [
          {
            role: 'system',
            content:
              '너는 영어단어 CSV를 우리 앱 형식으로 맞춰주는 도우미야. 반드시 JSON 배열만 출력해.',
          },
          {
            role: 'user',
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
    const content = data.choices?.[0]?.message?.content ?? '[]';

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
다음 단어들을 우리 앱용 포맷으로 보정해줘.
반드시 아래 필드만 있는 JSON 배열로만 답해.

필드:
- book (string)
- chapter (number)
- term_en (string)
- meaning_ko (string)
- pos (string)  // 모르면 빈 문자열
- accepted_ko (string) // 비슷한 한국어 뜻, 여러 개면 콤마로

입력:
${JSON.stringify(rows, null, 2)}

출력 예시:
[
  {
    "book": "Rabbit 기본어휘",
    "chapter": 1,
    "term_en": "apple",
    "meaning_ko": "사과",
    "pos": "명사",
    "accepted_ko": "사과 열매"
  }
]
  `.trim();
}
