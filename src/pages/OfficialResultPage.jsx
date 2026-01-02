// src/pages/OfficialResultPage.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import dayjs from "dayjs";
import "dayjs/locale/ko";
import { supabase } from "../utils/supabaseClient";
import { getSession } from "../utils/session";
import StudentShell from "./StudentShell";

dayjs.locale("ko");

const COLORS = {
  bg: "#fff5f8",
  text: "#1f2a44",
  sub: "#5d6b82",
  border: "#ffd3e3",
  pink: "#ff6fa3",
  pink2: "#ff8fb7",
  gray: "#eef1f6",
  blue: "#4361ee",
  okBg: "#e9fbf1",
  okText: "#167a3a",
  noBg: "#ffecec",
  noText: "#b42318",
};

const FONT_FAMILY = "system-ui, -apple-system, Segoe UI, Roboto, Arial";

// ✅ 캔버스 1장 생성 후 PNG 다운로드
function downloadCanvasPng(canvas, filename) {
  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }, "image/png");
}

// ✅ 표를 이미지로 렌더링 (canvas 반환)
function renderWrongTableToCanvas({ title, metaLines = [], columns, rows, width = 1080 }) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);

  const P = {
    pad: 18,
    gap: 10,
    cardPad: 14,
    rowH: 36,
    headH: 38,
    radius: 14,
    font: FONT_FAMILY,
  };

  const W = width;
  const colW = columns.map((c) => c.w);
  const tableW = colW.reduce((a, b) => a + b, 0);

  const headerH = 46;
  const metaH = metaLines.length ? metaLines.length * 18 + 10 : 0;
  const tableH = P.headH + rows.length * P.rowH;

  const H = P.pad + headerH + metaH + P.gap + (tableH + P.cardPad * 2) + P.pad;

  const canvas = document.createElement("canvas");
  canvas.width = Math.floor(W * dpr);
  canvas.height = Math.floor(H * dpr);
  canvas.style.width = `${W}px`;
  canvas.style.height = `${H}px`;

  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);

  const roundRect = (x, y, w, h, r) => {
    const rr = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.arcTo(x + w, y, x + w, y + h, rr);
    ctx.arcTo(x + w, y + h, x, y + h, rr);
    ctx.arcTo(x, y + h, x, y, rr);
    ctx.arcTo(x, y, x + w, y, rr);
    ctx.closePath();
  };

  const clipText = (text, maxWidth) => {
    const s = (text ?? "").toString();
    if (!s) return "";
    if (ctx.measureText(s).width <= maxWidth) return s;
    let lo = 0;
    let hi = s.length;
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2);
      const t = s.slice(0, mid) + "…";
      if (ctx.measureText(t).width <= maxWidth) lo = mid + 1;
      else hi = mid;
    }
    return s.slice(0, Math.max(0, lo - 2)) + "…";
  };

  // background
  ctx.fillStyle = COLORS.bg;
  ctx.fillRect(0, 0, W, H);

  // header title
  let y = P.pad;
  ctx.fillStyle = COLORS.text;
  ctx.font = `900 22px ${P.font}`;
  ctx.fillText(title || "틀린 문제", P.pad, y + 28);

  y += headerH;

  // meta lines
  if (metaLines.length) {
    ctx.font = `900 13px ${P.font}`;
    ctx.fillStyle = COLORS.sub;
    metaLines.forEach((line, idx) => {
      ctx.fillText(line, P.pad, y + idx * 18 + 14);
    });
    y += metaH;
  }

  y += P.gap;

  // table card
  const cardX = P.pad;
  const cardY = y;
  const cardW = W - P.pad * 2;
  const cardH = tableH + P.cardPad * 2;

  ctx.save();
  roundRect(cardX, cardY, cardW, cardH, P.radius);
  ctx.fillStyle = "rgba(255,255,255,0.88)";
  ctx.fill();
  ctx.restore();

  // inner origin (center table if narrower than card)
  const innerX = cardX + P.cardPad + Math.max(0, (cardW - P.cardPad * 2 - tableW) / 2);
  const innerY = cardY + P.cardPad;

  // header row
  ctx.fillStyle = "rgba(255,255,255,0.98)";
  ctx.fillRect(innerX, innerY, tableW, P.headH);

  ctx.strokeStyle = COLORS.gray;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(innerX, innerY + P.headH);
  ctx.lineTo(innerX + tableW, innerY + P.headH);
  ctx.stroke();

  ctx.font = `900 13px ${P.font}`;
  ctx.fillStyle = COLORS.sub;

  let x = innerX;
  columns.forEach((c, i) => {
    ctx.fillText(c.label, x + 10, innerY + 24);

    if (i > 0) {
      ctx.strokeStyle = "rgba(238,241,246,1)";
      ctx.beginPath();
      ctx.moveTo(x, innerY);
      ctx.lineTo(x, innerY + tableH);
      ctx.stroke();
    }
    x += colW[i];
  });

  // data rows
  const startY = innerY + P.headH;
  rows.forEach((r, idx) => {
    const ry = startY + idx * P.rowH;

    if (idx % 2 === 1) {
      ctx.fillStyle = "rgba(255,255,255,0.68)";
      ctx.fillRect(innerX, ry, tableW, P.rowH);
    }

    ctx.strokeStyle = "rgba(238,241,246,1)";
    ctx.beginPath();
    ctx.moveTo(innerX, ry + P.rowH);
    ctx.lineTo(innerX + tableW, ry + P.rowH);
    ctx.stroke();

    const padX = 10;

    // 1) 문제번호
    let cx = innerX;
    ctx.font = `900 13px ${P.font}`;
    ctx.fillStyle = COLORS.sub;
    ctx.fillText(clipText(r.no, colW[0] - padX * 2), cx + padX, ry + 23);
    cx += colW[0];

    // 2) 영단어
    ctx.font = `900 13px ${P.font}`;
    ctx.fillStyle = COLORS.text;
    ctx.fillText(clipText(r.term, colW[1] - padX * 2), cx + padX, ry + 23);
    cx += colW[1];

    // 3) 정답(파랑)
    ctx.font = `900 13px ${P.font}`;
    ctx.fillStyle = COLORS.blue;
    ctx.fillText(clipText(r.answer, colW[2] - padX * 2), cx + padX, ry + 23);
    cx += colW[2];

    // 4) 내 답(빨강)
    ctx.font = `900 13px ${P.font}`;
    ctx.fillStyle = COLORS.noText;
    ctx.fillText(clipText(r.mine, colW[3] - padX * 2), cx + padX, ry + 23);
  });

  return canvas;
}

// ✅ 표가 길면 여러 장으로 나눠 저장
function downloadWrongTablesAsImages({
  baseFilename,
  title,
  metaLines,
  columns,
  rows,
  maxRowsPerPage = 24,
}) {
  const chunks = [];
  for (let i = 0; i < rows.length; i += maxRowsPerPage) {
    chunks.push(rows.slice(i, i + maxRowsPerPage));
  }

  // 1장일 때는 _p1 같은 접미사 없이 저장
  const multi = chunks.length > 1;

  chunks.forEach((partRows, idx) => {
    const pageNo = idx + 1;
    const canvas = renderWrongTableToCanvas({
      title: multi ? `${title} (p.${pageNo}/${chunks.length})` : title,
      metaLines: multi ? [...metaLines, `페이지: ${pageNo}/${chunks.length}`] : metaLines,
      columns,
      rows: partRows,
    });

    const filename = multi
      ? baseFilename.replace(/\.png$/i, `-p${pageNo}.png`)
      : baseFilename;

    // 브라우저 다운로드 안정성 위해 약간 딜레이
    setTimeout(() => downloadCanvasPng(canvas, filename), idx * 200);
  });
}

export default function OfficialResultPage() {
  const { id } = useParams();
  const me = getSession();
  const nav = useNavigate();

  const [sess, setSess] = useState(null);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  const [profileName, setProfileName] = useState(() => (me?.name || "").trim()); // ✅ 학생 이름 표시용
  const downloadingRef = useRef(false);

  const styles = useMemo(
    () => ({
      // ✅ 화면 전체 사용
      page: {
        minHeight: "100dvh",
        width: "100%",
        background: COLORS.bg,
        paddingTop: "calc(env(safe-area-inset-top, 0px) + 14px)",
        paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 14px)",
        paddingLeft: 16,
        paddingRight: 16,
        color: COLORS.text,
      },
      container: {
        width: "100%",
        maxWidth: 980,
        margin: "0 auto",
      },

      headRow: { display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10 },
      title: { fontSize: 18, fontWeight: 900, margin: 0, color: COLORS.text },
      sub: { fontSize: 12, color: COLORS.sub, marginTop: 3, fontWeight: 900 },

      pill: (ok) => ({
        display: "inline-flex",
        alignItems: "center",
        padding: "6px 10px",
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 900,
        background: ok ? COLORS.okBg : COLORS.noBg,
        color: ok ? COLORS.okText : COLORS.noText,
        border: `1px solid ${ok ? "#c7f0d8" : "#ffd0d0"}`,
        whiteSpace: "nowrap",
      }),

      metaGrid: {
        marginTop: 12,
        border: `1px solid ${COLORS.gray}`,
        borderRadius: 16,
        padding: 12,
        background: "rgba(255,255,255,0.55)",
        backdropFilter: "blur(6px)",
        boxShadow: "0 10px 22px rgba(31,42,68,0.06)",
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: 10,
      },
      metaItem: { display: "flex", flexDirection: "column", gap: 3, minWidth: 0 },
      metaLabel: { fontSize: 12, color: COLORS.sub, fontWeight: 900 },
      metaValue: {
        fontSize: 13,
        color: COLORS.text,
        fontWeight: 900,
        lineHeight: 1.25,
        whiteSpace: "normal",
        wordBreak: "break-word",
      },

      section: { marginTop: 12, borderTop: `1px dashed ${COLORS.border}`, paddingTop: 12 },
      sectionTop: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 },
      sectionTitle: { fontSize: 14, fontWeight: 900, color: COLORS.text, marginBottom: 0 },

      dlBtn: (disabled) => ({
        padding: "10px 12px",
        borderRadius: 12,
        border: `1px solid ${COLORS.border}`,
        background: disabled ? "rgba(255,255,255,0.35)" : "rgba(255,255,255,0.65)",
        color: COLORS.text,
        fontWeight: 900,
        cursor: disabled ? "not-allowed" : "pointer",
        boxShadow: "0 10px 18px rgba(31,42,68,0.05)",
        whiteSpace: "nowrap",
      }),

      empty: {
        marginTop: 10,
        padding: "12px 12px",
        borderRadius: 14,
        border: `1px solid ${COLORS.gray}`,
        background: "rgba(255,255,255,0.55)",
        backdropFilter: "blur(6px)",
        color: COLORS.sub,
        fontWeight: 900,
        boxShadow: "0 10px 22px rgba(31,42,68,0.05)",
      },

      // ✅ 표 UI
      tableWrap: {
        marginTop: 10,
        border: `1px solid ${COLORS.gray}`,
        borderRadius: 16,
        overflow: "hidden",
        background: "rgba(255,255,255,0.65)",
        backdropFilter: "blur(6px)",
        boxShadow: "0 10px 22px rgba(31,42,68,0.06)",
      },
      tableHead: {
        display: "grid",
        gridTemplateColumns: "72px 1.3fr 1fr 1fr",
        padding: "10px 12px",
        background: "rgba(255,255,255,0.9)",
        borderBottom: `1px solid ${COLORS.gray}`,
        fontSize: 12,
        fontWeight: 900,
        color: COLORS.sub,
      },
      row: (odd) => ({
        display: "grid",
        gridTemplateColumns: "72px 1.3fr 1fr 1fr",
        padding: "10px 12px",
        borderBottom: `1px solid ${COLORS.gray}`,
        background: odd ? "rgba(255,255,255,0.55)" : "transparent",
        alignItems: "center",
      }),
      num: { fontSize: 12, fontWeight: 900, color: COLORS.sub, whiteSpace: "nowrap" },
      term: { fontSize: 13, fontWeight: 900, color: COLORS.text, wordBreak: "break-word" },
      ans: { fontSize: 13, fontWeight: 900, color: COLORS.blue, wordBreak: "break-word" },
      mine: { fontSize: 13, fontWeight: 900, color: COLORS.noText, wordBreak: "break-word" },

      bottomLink: {
        marginTop: 14,
        color: COLORS.blue,
        fontWeight: 900,
        display: "inline-block",
        textDecoration: "none",
      },

      loadingText: { color: COLORS.sub, fontWeight: 900 },
    }),
    []
  );

  useEffect(() => {
    (async () => {
      try {
        setLoading(true);

        // ✅ 학생 이름(정확도용): profiles에서 한번 더
        if (me?.id) {
          try {
            const { data: p } = await supabase.from("profiles").select("name").eq("id", me.id).maybeSingle();
            const nm = (p?.name || me?.name || "").trim();
            if (nm) setProfileName(nm);
          } catch {}
        }

        const { data: s, error: e1 } = await supabase
          .from("test_sessions")
          .select(
            "id, student_id, book, chapters_text, chapter_start, chapter_end, num_questions, cutoff_miss, final_score, final_pass, teacher_confirmed_at, status, created_at"
          )
          .eq("id", id)
          .maybeSingle();

        if (e1) throw e1;

        if (!s) {
          alert("세션을 찾을 수 없습니다.");
          nav("/exam/official/results", { replace: true });
          return;
        }

        if (me?.id && s.student_id !== me.id) {
          alert("본인 결과만 볼 수 있습니다.");
          nav("/exam/official/results", { replace: true });
          return;
        }
        if (s.status !== "finalized") {
          alert("아직 검수 중입니다.");
          nav("/exam/official/results", { replace: true });
          return;
        }

        setSess(s);

        const { data: its, error: e2 } = await supabase
          .from("test_items")
          .select("order_index, term_en, meaning_ko, student_answer, final_ok, auto_ok")
          .eq("session_id", id)
          .order("order_index", { ascending: true });

        if (e2) throw e2;
        setItems(its || []);
      } catch (e) {
        console.error(e);
        alert(e?.message || "결과를 불러오는 중 오류가 발생했습니다.");
        nav("/exam/official/results", { replace: true });
      } finally {
        setLoading(false);
      }
    })();
  }, [id, me?.id, me?.name, nav]);

  const confirmedAt = useMemo(() => (sess ? sess.teacher_confirmed_at || sess.created_at : null), [sess]);

  const range = useMemo(() => {
    if (!sess) return "";
    return sess.chapters_text || `${sess.chapter_start ?? "?"}-${sess.chapter_end ?? "?"}`;
  }, [sess]);

  const wrongItems = useMemo(() => {
    return (items || []).filter((it) => it?.final_ok === false || it?.final_ok === null);
  }, [items]);

  const total = useMemo(() => (sess ? sess.num_questions ?? items.length : 0), [sess, items.length]);
  const score = useMemo(() => (sess ? sess.final_score ?? 0 : 0), [sess]);
  const wrong = useMemo(() => Math.max(0, total - score), [total, score]);

  function onDownloadWrongImage() {
    if (downloadingRef.current) return;
    if (!sess) return;
    if (!wrongItems.length) return;

    downloadingRef.current = true;

    try {
      const rows = wrongItems.map((it) => ({
        no: `${it.order_index}번`,
        term: it.term_en || "-",
        answer: it.meaning_ko || "-",
        mine: it.student_answer ? String(it.student_answer) : "(무응답)",
      }));

      const statusText = sess.final_pass ? "통과" : "불통과";
      const dtText = confirmedAt ? dayjs(confirmedAt).format("YYYY.MM.DD HH:mm") : "";

      // ✅ 이미지 상단에 학생이름/통과여부/날짜 포함
      const metaLines = [
        `학생: ${profileName || "-"}`,
        `결과: ${statusText} · 날짜: ${dtText}`,
        `${sess.book || "-"} · 범위: ${range}`,
      ];

      const columns = [
        { label: "문제번호", w: 110 },
        { label: "영단어", w: 360 },
        { label: "정답", w: 300 },
        { label: "내 답", w: 300 },
      ];

      const safeName = (profileName || "student").replace(/[\\/:*?"<>|]/g, "_");
      const baseFilename = `wrong-${safeName}-${dayjs(confirmedAt).format("YYYYMMDD-HHmm")}.png`;

      // ✅ 길면 자동으로 여러 장 저장
      downloadWrongTablesAsImages({
        baseFilename,
        title: "틀린 문제",
        metaLines,
        columns,
        rows,
        maxRowsPerPage: 24, // 원하면 20/30 등으로 조절 가능
      });
    } finally {
      setTimeout(() => {
        downloadingRef.current = false;
      }, 1200);
    }
  }

  if (loading) {
    return (
      <StudentShell>
        <div style={styles.page}>
          <div style={styles.container}>
            <div style={styles.loadingText}>불러오는 중…</div>
          </div>
        </div>
      </StudentShell>
    );
  }
  if (!sess) return null;

  return (
    <StudentShell>
      <div style={styles.page}>
        <div style={styles.container}>
          {/* 헤더 */}
          <div style={styles.headRow}>
            <div>
              <h2 style={styles.title}>공식시험 상세 결과</h2>
              <div style={styles.sub}>{confirmedAt ? dayjs(confirmedAt).format("YYYY.MM.DD HH:mm") : ""}</div>
            </div>
            <span style={styles.pill(!!sess.final_pass)}>{sess.final_pass ? "통과" : "불통과"}</span>
          </div>

          {/* 요약 메타 */}
          <div style={styles.metaGrid}>
            <div style={styles.metaItem}>
              <div style={styles.metaLabel}>학생</div>
              <div style={styles.metaValue}>{profileName || "-"}</div>
            </div>

            <div style={styles.metaItem}>
              <div style={styles.metaLabel}>책</div>
              <div style={styles.metaValue}>{sess.book || "-"}</div>
            </div>

            <div style={styles.metaItem}>
              <div style={styles.metaLabel}>범위</div>
              <div style={styles.metaValue}>{range}</div>
            </div>

            <div style={styles.metaItem}>
              <div style={styles.metaLabel}>문제 수</div>
              <div style={styles.metaValue}>{total}문제</div>
            </div>

            <div style={styles.metaItem}>
              <div style={styles.metaLabel}>틀린 수 / 커트라인</div>
              <div style={styles.metaValue}>
                -{wrong} · -{sess.cutoff_miss ?? 0}컷
              </div>
            </div>
          </div>

          {/* 틀린 문제 표 + 이미지 저장 */}
          <div style={styles.section}>
            <div style={styles.sectionTop}>
              <div style={styles.sectionTitle}>틀린 문제</div>
              <button
                type="button"
                style={styles.dlBtn(!wrongItems.length)}
                onClick={onDownloadWrongImage}
                disabled={!wrongItems.length}
                title={!wrongItems.length ? "틀린 문제가 없어서 저장할 내용이 없어요." : "틀린 문제 표를 이미지로 저장"}
              >
                🖼️ 이미지로 저장
              </button>
            </div>

            {!wrongItems.length ? (
              <div style={styles.empty}>틀린 문제가 없습니다. 🎉</div>
            ) : (
              <div style={styles.tableWrap} role="table" aria-label="틀린 문제 표">
                <div style={styles.tableHead} role="row">
                  <div role="columnheader">문제번호</div>
                  <div role="columnheader">영단어</div>
                  <div role="columnheader">정답</div>
                  <div role="columnheader">내 답</div>
                </div>

                {wrongItems.map((it, idx) => (
                  <div
                    key={it.order_index}
                    style={{
                      ...styles.row(idx % 2 === 1),
                      borderBottom: idx === wrongItems.length - 1 ? "none" : styles.row(idx % 2 === 1).borderBottom,
                    }}
                    role="row"
                  >
                    <div role="cell" style={styles.num}>
                      {it.order_index}번
                    </div>
                    <div role="cell" style={styles.term}>
                      {it.term_en || "-"}
                    </div>
                    <div role="cell" style={styles.ans}>
                      {it.meaning_ko || "-"}
                    </div>
                    <div role="cell" style={styles.mine}>
                      {it.student_answer ? it.student_answer : "(무응답)"}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <Link to="/exam/official/results" style={styles.bottomLink}>
            ← 결과 목록
          </Link>
        </div>
      </div>
    </StudentShell>
  );
}
