// src/pages/admin/AdminPaperExamPage.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import dayjs from "dayjs";
import "dayjs/locale/ko";
import html2canvas from "html2canvas";
import { supabase } from "../../utils/supabaseClient";
import {
  fetchWordsByChapters,
  fetchChapters,
  parseChapterInput,
  sampleN,
} from "../../utils/vocab";

dayjs.locale("ko");

const DEFAULT_EXAM_SECONDS = 6;

const THEME = {
  bg: "#f7f9fc",
  card: "#ffffff",
  text: "#1f2a44",
  sub: "#5d6b82",
  border: "#e9eef5",
  borderPink: "#ffd3e3",
  pink: "#ff6fa3",
  pinkSoft: "#fff0f5",
  pinkSoft2: "#fff7fa",
  blueSoft: "#eef4ff",
  blueBd: "#cfe0ff",
  okSoft: "#ecfdf5",
  okBd: "#bbf7d0",
  okText: "#166534",
  dangerSoft: "#fff1f2",
  dangerBd: "#fecdd3",
  dangerText: "#9f1239",
  yellowSoft: "#fff9e8",
  yellowBd: "#fde68a",
};

function normalizePhone(v) {
  return String(v || "").replace(/\D/g, "");
}

function chunkArray(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function buildChaptersTextFromSelections(selections) {
  return (selections || [])
    .map((s) => `${s.book}:${s.chaptersText}`)
    .join(" | ");
}

function buildPrettySourceBook(selections) {
  const books = (selections || [])
    .map((s) => String(s?.book || "").trim())
    .filter(Boolean);

  if (!books.length) return "종이시험";
  if (books.length === 1) return books[0];
  if (books.length === 2) return `${books[0]} + ${books[1]}`;
  if (books.length === 3) return `${books[0]} + ${books[1]} + ${books[2]}`;
  return `${books[0]} 외 ${books.length - 1}권`;
}

function clampSeconds(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return DEFAULT_EXAM_SECONDS;
  return Math.max(1, Math.min(60, Math.floor(n)));
}

function splitIntoColumns(items, columnCount = 3) {
  const total = items.length;
  const perCol = Math.ceil(total / columnCount);
  const cols = [];
  for (let c = 0; c < columnCount; c += 1) {
    const start = c * perCol;
    const end = start + perCol;
    cols.push(items.slice(start, end));
  }
  return cols;
}

export default function AdminPaperExamPage() {
  const [phase, setPhase] = useState("config"); // config | exam | answer
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const [studentQuery, setStudentQuery] = useState("");
  const [studentResults, setStudentResults] = useState([]);
  const [studentBusy, setStudentBusy] = useState(false);
  const [studentPicked, setStudentPicked] = useState(null);

  const studentTimerRef = useRef(null);

  const [bookMeta, setBookMeta] = useState([]);
  const [catNodes, setCatNodes] = useState([]);
  const [booksLoading, setBooksLoading] = useState(true);
  const [err, setErr] = useState("");

  const [expanded, setExpanded] = useState(() => new Set());
  const [selectedCategoryId, setSelectedCategoryId] = useState("");
  const [bookSearch, setBookSearch] = useState("");
  const [selectedBooks, setSelectedBooks] = useState(() => new Set());
  const [chaptersByBook, setChaptersByBook] = useState({});

  const [numQ, setNumQ] = useState(30);
  const [cutMiss, setCutMiss] = useState(3);
  const [examSeconds, setExamSeconds] = useState(DEFAULT_EXAM_SECONDS);

  const [words, setWords] = useState([]);
  const [seq, setSeq] = useState([]);
  const [idx, setIdx] = useState(0);
  const [remaining, setRemaining] = useState(clampSeconds(DEFAULT_EXAM_SECONDS));

  const timerRef = useRef(null);

  const [paperSession, setPaperSession] = useState(null);
  const [checkedWrongIds, setCheckedWrongIds] = useState(() => new Set());
  const answerSheetRef = useRef(null);

  useEffect(() => {
    loadBooksAndCategories();
  }, []);

  async function loadBooksAndCategories() {
    try {
      setBooksLoading(true);
      setErr("");

      const [{ data: cats, error: e1 }, { data: books, error: e2 }] = await Promise.all([
        supabase
          .from("book_category_nodes")
          .select("id, parent_id, name, sort_order, created_at")
          .order("parent_id", { ascending: true, nullsFirst: true })
          .order("sort_order", { ascending: true }),
        supabase.from("v_books_with_category").select("book, category_id, category_path"),
      ]);

      if (e1) throw e1;
      if (e2) throw e2;

      setCatNodes(cats || []);
      setBookMeta(books || []);
    } catch (e) {
      console.error(e);
      setErr("단어책/분류 데이터를 불러오지 못했습니다.");
    } finally {
      setBooksLoading(false);
    }
  }

  useEffect(() => {
    const q = studentQuery.trim();
    if (studentTimerRef.current) clearTimeout(studentTimerRef.current);

    if (!q) {
      setStudentResults([]);
      setStudentBusy(false);
      return;
    }

    studentTimerRef.current = setTimeout(() => {
      searchStudents(q);
    }, 220);

    return () => {
      if (studentTimerRef.current) clearTimeout(studentTimerRef.current);
    };
  }, [studentQuery]);

  async function searchStudents(q) {
    try {
      setStudentBusy(true);

      const digits = normalizePhone(q);
      const queries = [
        supabase
          .from("profiles")
          .select("id, name, school, grade, phone, teacher_name")
          .ilike("name", `%${q}%`)
          .order("name", { ascending: true })
          .limit(12),
        supabase
          .from("profiles")
          .select("id, name, school, grade, phone, teacher_name")
          .ilike("school", `%${q}%`)
          .order("name", { ascending: true })
          .limit(12),
      ];

      if (digits) {
        queries.push(
          supabase
            .from("profiles")
            .select("id, name, school, grade, phone, teacher_name")
            .ilike("phone", `%${digits}%`)
            .order("name", { ascending: true })
            .limit(12)
        );
      }

      const results = await Promise.all(queries);

      const merged = [];
      const seen = new Set();

      for (const r of results) {
        if (r.error) {
          console.warn("[student search error]", r.error);
          continue;
        }
        for (const row of r.data || []) {
          if (!row?.id || seen.has(row.id)) continue;
          seen.add(row.id);
          merged.push(row);
        }
      }

      merged.sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
      setStudentResults(merged.slice(0, 20));
    } catch (e) {
      console.error(e);
      setStudentResults([]);
    } finally {
      setStudentBusy(false);
    }
  }

  const tree = useMemo(() => {
    const byId = new Map(catNodes.map((n) => [n.id, n]));
    const childrenBy = new Map();

    for (const n of catNodes) {
      const k = n.parent_id || "__root__";
      if (!childrenBy.has(k)) childrenBy.set(k, []);
      childrenBy.get(k).push(n);
    }

    const getChildren = (pid) =>
      (childrenBy.get(pid || "__root__") || []).sort(
        (a, b) =>
          (a.sort_order ?? 0) - (b.sort_order ?? 0) ||
          String(a.name || "").localeCompare(String(b.name || ""))
      );

    const hasChild = new Set(catNodes.filter((x) => x.parent_id).map((x) => x.parent_id));
    const isLeaf = (id) => !hasChild.has(id);

    const buildPath = (id) => {
      const parts = [];
      let cur = byId.get(id);
      while (cur) {
        parts.push(cur.name);
        cur = cur.parent_id ? byId.get(cur.parent_id) : null;
      }
      return parts.reverse().join(" > ");
    };

    return { getChildren, isLeaf, buildPath };
  }, [catNodes]);

  function toggleExpand(id) {
    setExpanded((prev) => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  }

  function onPickCategory(id) {
    if (!tree.isLeaf(id)) {
      toggleExpand(id);
      return;
    }
    setSelectedCategoryId((p) => (p === id ? "" : id));
  }

  const booksInCategory = useMemo(() => {
    if (!selectedCategoryId) return [];
    return bookMeta.filter((b) => b.category_id === selectedCategoryId);
  }, [bookMeta, selectedCategoryId]);

  const searchedBooks = useMemo(() => {
    const q = (bookSearch || "").trim().toLowerCase();
    if (!q) return [];
    const uniq = new Set();
    const out = [];
    for (const b of bookMeta) {
      const name = String(b?.book || "");
      if (!name) continue;
      if (name.toLowerCase().includes(q)) {
        if (!uniq.has(name)) {
          uniq.add(name);
          out.push(name);
        }
      }
    }
    out.sort((a, b) => String(a).localeCompare(String(b)));
    return out.slice(0, 40);
  }, [bookSearch, bookMeta]);

  const selectedBookList = useMemo(() => {
    const arr = Array.from(selectedBooks);
    arr.sort((a, b) => String(a).localeCompare(String(b)));
    return arr;
  }, [selectedBooks]);

  const answerColumns = useMemo(() => {
    return splitIntoColumns(seq, 3);
  }, [seq]);

  async function toggleBook(book) {
    setSelectedBooks((prev) => {
      const next = new Set(prev);
      if (next.has(book)) next.delete(book);
      else next.add(book);
      return next;
    });

    if (!chaptersByBook[book]) {
      try {
        const cs = await fetchChapters(book);
        if (cs?.length) {
          setChaptersByBook((m) => ({
            ...m,
            [book]: `${cs[0]}-${cs[cs.length - 1]}`,
          }));
        }
      } catch (e) {
        console.warn("[fetchChapters fail]", e);
      }
    }
  }

  function unselectBook(book) {
    if (selectedBooks.has(book)) toggleBook(book);
  }

  function renderTree(parentId = null) {
    const nodes = tree.getChildren(parentId);
    if (!nodes.length) return null;

    return (
      <div style={{ marginLeft: parentId ? 16 : 0 }}>
        {nodes.map((n) => {
          const open = expanded.has(n.id);
          const leaf = tree.isLeaf(n.id);
          const on = selectedCategoryId === n.id;

          return (
            <div key={n.id} style={{ marginTop: 6 }}>
              <div
                onClick={() => onPickCategory(n.id)}
                style={{
                  padding: "8px 10px",
                  borderRadius: 12,
                  border: `1px solid ${THEME.borderPink}`,
                  background: on ? THEME.pink : "#fff",
                  color: on ? "#fff" : THEME.text,
                  cursor: "pointer",
                  fontWeight: 900,
                }}
                title={tree.buildPath(n.id)}
              >
                {leaf ? "📘 " : "📂 "} {n.name}
              </div>
              {!leaf && open && renderTree(n.id)}
            </div>
          );
        })}
      </div>
    );
  }

  function buildSelections() {
    const selections = [];

    for (const book of selectedBooks) {
      const text = (chaptersByBook[book] || "").trim();
      if (!text) {
        alert(`${book}의 챕터 범위를 입력해 주세요.`);
        return null;
      }
      const parsed = parseChapterInput(text);
      if (!parsed.length) {
        alert(`${book}의 챕터 형식이 올바르지 않습니다.`);
        return null;
      }
      selections.push({ book, chaptersText: text, chapters: parsed });
    }

    if (!selections.length) {
      alert("최소 한 권 이상의 책을 선택해 주세요.");
      return null;
    }

    return selections;
  }

  async function buildWordsFromSelections(selections) {
    const chunks = [];
    for (const sel of selections) {
      const list = await fetchWordsByChapters(sel.book, sel.chapters);
      chunks.push(...(list || []).map((w) => ({ ...w, book: w.book || sel.book })));
    }
    return chunks;
  }

  async function startExam() {
    try {
      setErr("");

      if (!studentPicked?.id) {
        alert("학생을 먼저 선택해 주세요.");
        return;
      }

      const selections = buildSelections();
      if (!selections) return;

      const count = Math.max(1, Math.min(Number(numQ) || 0, 999));
      const cut = Math.max(0, Math.min(Number(cutMiss) || 0, 999));
      const sec = clampSeconds(examSeconds);

      setLoading(true);

      const loadedWords = await buildWordsFromSelections(selections);
      if (!loadedWords.length) {
        alert("선택한 범위에 단어가 없습니다.");
        return;
      }

      const finalCount = Math.min(count, loadedWords.length);
      if (finalCount !== Number(numQ)) setNumQ(finalCount);
      if (sec !== Number(examSeconds)) setExamSeconds(sec);

      const chosen = sampleN(loadedWords, finalCount);

      const chaptersText = buildChaptersTextFromSelections(selections);
      const sessionFront = {
        student_id: studentPicked.id,
        student_name: studentPicked.name || "",
        teacher_name: studentPicked.teacher_name || null,
        book: buildPrettySourceBook(selections),
        chapters_text: chaptersText,
        cutoff_miss: cut,
        num_questions: finalCount,
        exam_seconds: sec,
        started_at: new Date().toISOString(),
      };

      setWords(loadedWords);
      setPaperSession(sessionFront);
      setSeq(chosen);
      setIdx(0);
      setRemaining(sec);
      setCheckedWrongIds(new Set());
      setPhase("exam");
    } catch (e) {
      console.error(e);
      setErr("시험 시작 중 오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (phase !== "exam") return;

    const seconds = clampSeconds(paperSession?.exam_seconds ?? examSeconds);
    setRemaining(seconds);

    if (timerRef.current) clearInterval(timerRef.current);

    timerRef.current = setInterval(() => {
      setRemaining((r) => {
        if (r <= 1) {
          if (idx + 1 >= seq.length) {
            finishExam();
          } else {
            setIdx((prev) => prev + 1);
          }
          return seconds;
        }
        return r - 1;
      });
    }, 1000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [phase, idx, seq.length, paperSession?.exam_seconds, examSeconds]);

  function finishExam() {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    setPhase("answer");
  }

  function toggleWrongWord(wordId) {
    setCheckedWrongIds((prev) => {
      const next = new Set(prev);
      if (next.has(wordId)) next.delete(wordId);
      else next.add(wordId);
      return next;
    });
  }

  function setAllWrong(on) {
    if (!seq.length) return;
    if (on) {
      setCheckedWrongIds(new Set(seq.map((w) => w.id || w.word_id).filter(Boolean)));
    } else {
      setCheckedWrongIds(new Set());
    }
  }

  const wrongCount = checkedWrongIds.size;
  const correctCount = Math.max(0, seq.length - wrongCount);
  const willPass = wrongCount <= Math.max(0, Number(cutMiss) || 0);

  async function sendWrongBook() {
    try {
      if (!studentPicked?.id) {
        alert("학생 정보가 없습니다.");
        return;
      }
      if (!seq.length) {
        alert("시험 문항이 없습니다.");
        return;
      }
      if (checkedWrongIds.size === 0) {
        alert("체크된 오답 문항이 없습니다.");
        return;
      }

      setSaving(true);
      setErr("");

      const selectedWrongWords = seq.filter((w) => checkedWrongIds.has(w.id || w.word_id));
      if (!selectedWrongWords.length) {
        alert("체크된 오답 문항이 없습니다.");
        return;
      }

      const chs = seq.map((w) => Number(w.chapter)).filter((n) => Number.isFinite(n));
      const chapterStart = chs.length ? Math.min(...chs) : 0;
      const chapterEnd = chs.length ? Math.max(...chs) : 0;

      const { data: sessionRow, error: sessErr } = await supabase
        .from("test_sessions")
        .insert({
          mode: "official",
          status: "finalized",
          student_id: studentPicked.id,
          student_name: studentPicked.name || "",
          teacher_name: studentPicked.teacher_name || null,
          book: paperSession?.book || "종이시험",
          chapters_text: paperSession?.chapters_text || "",
          chapter_start: chapterStart,
          chapter_end: chapterEnd,
          num_questions: seq.length,
          cutoff_miss: Math.max(0, Number(cutMiss) || 0),
          duration_sec: clampSeconds(paperSession?.exam_seconds ?? examSeconds),
          auto_score: correctCount,
          auto_pass: willPass,
          final_score: correctCount,
          final_pass: willPass,
        })
        .select("id")
        .single();

      if (sessErr) throw sessErr;
      if (!sessionRow?.id) throw new Error("세션 생성 후 ID를 받지 못했습니다.");

      const sessionId = sessionRow.id;

      const testItems = seq.map((w, index) => {
        const isWrong = checkedWrongIds.has(w.id || w.word_id);
        return {
          session_id: sessionId,
          order_index: index + 1,
          question_type: "subjective",
          word_id: w.id || w.word_id || null,
          term_en: w.term_en || null,
          meaning_ko: w.meaning_ko || null,
          student_answer: null,
          auto_ok: !isWrong,
          final_ok: !isWrong,
        };
      });

      const itemChunks = chunkArray(testItems, 200);
      for (const ch of itemChunks) {
        const { error } = await supabase.from("test_items").insert(ch);
        if (error) throw error;
      }

      const { data: wrongBookId, error: wrongErr } = await supabase.rpc(
        "create_wrong_book_from_session",
        { p_session_id: sessionId }
      );

      if (wrongErr) throw wrongErr;

      alert(
        `오답목록 전송 완료!\n\n학생: ${studentPicked.name}\n오답 ${selectedWrongWords.length}개\nwrong_book_id: ${
          wrongBookId || "(생성됨)"
        }`
      );
    } catch (e) {
      console.error(e);
      setErr(e?.message || "오답목록 전송 중 오류가 발생했습니다.");
    } finally {
      setSaving(false);
    }
  }

  async function downloadAnswerSheetImage() {
    try {
      if (!answerSheetRef.current) return;
      const canvas = await html2canvas(answerSheetRef.current, {
        backgroundColor: "#ffffff",
        scale: 2,
        useCORS: true,
        scrollY: -window.scrollY,
      });
      const url = canvas.toDataURL("image/png");
      const a = document.createElement("a");
      const who = (studentPicked?.name || "학생").trim() || "학생";
      const date = dayjs().format("YYYYMMDD_HHmm");
      a.href = url;
      a.download = `${who}_단어시험답지_${date}.png`;
      a.click();
    } catch (e) {
      console.error(e);
      alert("이미지 다운로드 중 오류가 발생했습니다.");
    }
  }

  function resetAll() {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    setPhase("config");
    setWords([]);
    setSeq([]);
    setIdx(0);
    setRemaining(clampSeconds(examSeconds));
    setCheckedWrongIds(new Set());
    setPaperSession(null);
  }

  return (
    <div style={styles.page}>
      <div style={styles.headerWrap}>
        <div style={styles.headerInner}>
          <div style={styles.titleRow}>
            <div>
              <div style={styles.title}>단어시험(종이시험)</div>
              <div style={styles.sub}>
                관리자 화면으로 단어를 보여주고, 채점 후 체크한 오답만 학생 계정으로 전송합니다.
              </div>
            </div>

            <div style={styles.rightTopBtns}>
              <button
                type="button"
                style={styles.ghostBtnPill}
                onClick={() => {
                  loadBooksAndCategories();
                  if (studentQuery.trim()) searchStudents(studentQuery.trim());
                }}
                disabled={loading || saving || booksLoading}
              >
                새로고침
              </button>
            </div>
          </div>

          {err ? <div style={styles.errBox}>{err}</div> : null}
        </div>
      </div>

      <div style={styles.content}>
        {phase === "config" && (
          <>
            <div style={styles.card}>
              <div style={styles.cardTitle}>1. 학생 선택</div>

              <div style={styles.label}>학생 이름 / 학교 / 전화번호 검색</div>
              <input
                value={studentQuery}
                onChange={(e) => setStudentQuery(e.target.value)}
                placeholder="예: 김민지 / 산본고 / 0101234"
                style={styles.input}
              />

              {studentQuery.trim() ? (
                <div style={{ marginTop: 10 }}>
                  {studentBusy ? (
                    <div style={styles.muted}>검색 중…</div>
                  ) : studentResults.length === 0 ? (
                    <div style={styles.muted}>검색 결과가 없습니다.</div>
                  ) : (
                    <div style={styles.searchList}>
                      {studentResults.map((st) => {
                        const selected = studentPicked?.id === st.id;
                        return (
                          <button
                            key={st.id}
                            type="button"
                            onClick={() => setStudentPicked(st)}
                            style={{
                              ...styles.searchItem,
                              background: selected ? THEME.pinkSoft : "#fff",
                              borderColor: selected ? THEME.borderPink : THEME.border,
                            }}
                          >
                            <div style={{ fontWeight: 900, color: THEME.text }}>
                              {st.name || "-"}
                            </div>
                            <div style={styles.searchMeta}>
                              {[st.school, st.grade, st.teacher_name].filter(Boolean).join(" · ") ||
                                "—"}
                            </div>
                            <div style={styles.searchMeta}>{st.phone || "—"}</div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              ) : null}

              {studentPicked ? (
                <div style={styles.pickedStudentBox}>
                  <div style={{ fontWeight: 900 }}>{studentPicked.name}</div>
                  <div style={styles.pickedSub}>
                    {[studentPicked.school, studentPicked.grade, studentPicked.teacher_name]
                      .filter(Boolean)
                      .join(" · ") || "—"}
                  </div>
                  <div style={styles.pickedSub}>{studentPicked.phone || "—"}</div>
                </div>
              ) : null}
            </div>

            <div style={{ height: 12 }} />

            <div style={styles.card}>
              <div style={styles.cardTitle}>2. 단어 범위 선택</div>

              <div className="_paper_exam_grid" style={styles.grid2}>
                <div>
                  <div style={styles.label}>책 검색</div>
                  <input
                    value={bookSearch}
                    onChange={(e) => setBookSearch(e.target.value)}
                    placeholder="책 이름 검색"
                    style={styles.input}
                  />

                  {bookSearch.trim() ? (
                    <div style={{ ...styles.box, marginTop: 10 }}>
                      {booksLoading ? (
                        <div style={styles.muted}>불러오는 중…</div>
                      ) : searchedBooks.length === 0 ? (
                        <div style={styles.muted}>검색 결과가 없어요.</div>
                      ) : (
                        <div style={{ display: "grid", gap: 8 }}>
                          {searchedBooks.map((book) => {
                            const checked = selectedBooks.has(book);
                            return (
                              <div key={book} style={styles.bookPickRow}>
                                <label style={styles.checkboxLabel}>
                                  <input
                                    type="checkbox"
                                    checked={checked}
                                    onChange={() => toggleBook(book)}
                                  />{" "}
                                  {book}
                                </label>
                                {checked ? (
                                  <input
                                    value={chaptersByBook[book] || ""}
                                    onChange={(e) =>
                                      setChaptersByBook((m) => ({
                                        ...m,
                                        [book]: e.target.value,
                                      }))
                                    }
                                    placeholder="예: 1-5, 7"
                                    style={{ ...styles.input, marginTop: 8 }}
                                  />
                                ) : null}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  ) : null}

                  <div style={{ marginTop: 16 }}>
                    <div style={styles.label}>분류 선택</div>
                    <div style={{ ...styles.box, maxHeight: 280, overflow: "auto" }}>
                      {booksLoading ? (
                        <div style={styles.muted}>불러오는 중…</div>
                      ) : (
                        renderTree(null)
                      )}
                    </div>
                  </div>

                  {selectedCategoryId ? (
                    <div style={{ marginTop: 12 }}>
                      <div style={styles.label}>선택한 분류의 책</div>
                      <div style={styles.box}>
                        {booksInCategory.length === 0 ? (
                          <div style={styles.muted}>이 분류에 책이 없어요.</div>
                        ) : (
                          <div style={{ display: "grid", gap: 8 }}>
                            {booksInCategory.map((b) => {
                              const checked = selectedBooks.has(b.book);
                              return (
                                <div key={b.book} style={styles.bookPickRow}>
                                  <label style={styles.checkboxLabel}>
                                    <input
                                      type="checkbox"
                                      checked={checked}
                                      onChange={() => toggleBook(b.book)}
                                    />{" "}
                                    {b.book}
                                  </label>
                                  {checked ? (
                                    <input
                                      value={chaptersByBook[b.book] || ""}
                                      onChange={(e) =>
                                        setChaptersByBook((m) => ({
                                          ...m,
                                          [b.book]: e.target.value,
                                        }))
                                      }
                                      placeholder="예: 4-8, 10"
                                      style={{ ...styles.input, marginTop: 8 }}
                                    />
                                  ) : null}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </div>
                  ) : null}
                </div>

                <div>
                  <div style={styles.label}>선택한 책 목록</div>
                  <div style={{ ...styles.box, borderStyle: "dashed" }}>
                    {selectedBookList.length === 0 ? (
                      <div style={styles.muted}>아직 선택된 책이 없습니다.</div>
                    ) : (
                      <div style={{ display: "grid", gap: 10 }}>
                        {selectedBookList.map((book) => (
                          <div key={book} style={styles.selectedBookCard}>
                            <div style={styles.selectedBookTop}>
                              <div style={{ fontWeight: 900 }}>{book}</div>
                              <button
                                type="button"
                                style={styles.smallDangerBtn}
                                onClick={() => unselectBook(book)}
                              >
                                선택 해제
                              </button>
                            </div>

                            <input
                              value={chaptersByBook[book] || ""}
                              onChange={(e) =>
                                setChaptersByBook((m) => ({
                                  ...m,
                                  [book]: e.target.value,
                                }))
                              }
                              placeholder="예: 1-3, 5"
                              style={{ ...styles.input, marginTop: 8 }}
                            />
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  <div style={{ marginTop: 16 }}>
                    <div style={styles.label}>시험 설정</div>
                    <div style={styles.box}>
                      <div style={styles.kvGrid3}>
                        <div>
                          <div style={styles.label}>문제 수</div>
                          <input
                            type="number"
                            min={1}
                            max={999}
                            value={numQ}
                            onChange={(e) => setNumQ(e.target.value)}
                            style={styles.input}
                          />
                        </div>

                        <div>
                          <div style={styles.label}>커트라인(-X컷)</div>
                          <input
                            type="number"
                            min={0}
                            max={999}
                            value={cutMiss}
                            onChange={(e) => setCutMiss(e.target.value)}
                            style={styles.input}
                          />
                        </div>

                        <div>
                          <div style={styles.label}>문항당 초</div>
                          <input
                            type="number"
                            min={1}
                            max={60}
                            value={examSeconds}
                            onChange={(e) => setExamSeconds(e.target.value)}
                            style={styles.input}
                          />
                        </div>
                      </div>

                      <div style={styles.infoLine}>
                        선생님이 직접 문항당 시간을 설정할 수 있어요. 권장값은 <b>6초</b>입니다.
                      </div>

                      <div style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
                        <button
                          type="button"
                          style={styles.pinkBtn}
                          onClick={startExam}
                          disabled={loading || booksLoading}
                        >
                          {loading ? "준비 중…" : "3. 시험 시작"}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <style>{`
              @media (max-width: 860px) {
                ._paper_exam_grid { grid-template-columns: 1fr !important; }
              }
            `}</style>
          </>
        )}

        {phase === "exam" && (
          <div style={styles.examWrap}>
            <div style={styles.examTopBar}>
              <div style={styles.examMeta}>
                <div style={styles.examMetaLine}>
                  학생: <b>{paperSession?.student_name || "-"}</b>
                </div>
                <div style={styles.examMetaSub}>{paperSession?.book || "-"}</div>
                <div style={styles.examMetaSub}>{paperSession?.chapters_text || "-"}</div>
              </div>

              <div style={styles.examRight}>
                <div style={styles.bigTimer}>{remaining}초</div>
                <div style={styles.examCounter}>
                  {idx + 1} / {seq.length}
                </div>
              </div>
            </div>

            <div style={styles.examCard}>
              <div style={styles.examWord}>{seq[idx]?.term_en || ""}</div>
              <div style={styles.examHint}>학생들은 종이에 뜻을 적으세요</div>
            </div>

            <div style={styles.examBottomBtns}>
              <button type="button" style={styles.ghostBtnPill} onClick={finishExam}>
                채점 화면으로 이동
              </button>
            </div>
          </div>
        )}

        {phase === "answer" && (
          <div style={styles.card}>
            <div style={styles.answerHeader}>
              <div>
                <div style={styles.cardTitle}>답지 / 채점</div>
                <div style={styles.sub}>
                  틀린 문제만 체크한 뒤 오답목록 전송을 누르세요.
                </div>
              </div>

              <div style={styles.answerActions}>
                <button
                  type="button"
                  style={styles.ghostBtnPill}
                  onClick={() => setAllWrong(true)}
                >
                  모두 오답 체크
                </button>
                <button
                  type="button"
                  style={styles.ghostBtnPill}
                  onClick={() => setAllWrong(false)}
                >
                  체크 전체 해제
                </button>
                <button
                  type="button"
                  style={styles.ghostBtnPill}
                  onClick={downloadAnswerSheetImage}
                >
                  답지 이미지 다운로드
                </button>
                <button
                  type="button"
                  style={styles.pinkBtn}
                  onClick={sendWrongBook}
                  disabled={saving}
                >
                  {saving ? "전송 중…" : "오답목록 전송"}
                </button>
                <button
                  type="button"
                  style={styles.smallDangerBtn2}
                  onClick={resetAll}
                  disabled={saving}
                >
                  새 시험
                </button>
              </div>
            </div>

            <div style={styles.summaryBox}>
              <div>
                학생: <b>{paperSession?.student_name || "-"}</b>
              </div>
              <div>
                시험 범위: <b>{paperSession?.book || "-"}</b>
              </div>
              <div>{paperSession?.chapters_text || "-"}</div>
              <div>
                총 {seq.length}문항 · 체크된 오답 {wrongCount}개 · 예상 결과{" "}
                <b style={{ color: willPass ? THEME.okText : THEME.dangerText }}>
                  {willPass ? "PASS" : "FAIL"}
                </b>
              </div>
            </div>

            <div ref={answerSheetRef} style={styles.answerSheet}>
              <div style={styles.answerSheetHead}>
                <div style={styles.sheetTitle}>단어시험 답지</div>
                <div style={styles.sheetSub}>
                  {paperSession?.student_name || "-"} · {dayjs().format("YYYY.MM.DD HH:mm")}
                </div>
                <div style={styles.sheetSub}>
                  {paperSession?.book || "-"}
                  {paperSession?.chapters_text ? ` · ${paperSession.chapters_text}` : ""}
                </div>
              </div>

              <div style={styles.answerColumnsWrap}>
                {answerColumns.map((colItems, colIdx) => (
                  <div key={colIdx} style={styles.answerColumn}>
                    <div style={styles.columnHead}>
                      <div style={{ ...styles.colHeadCheck, justifyContent: "center" }}>오답</div>
                      <div style={styles.colHeadNo}>번호</div>
                      <div style={styles.colHeadWord}>영단어</div>
                      <div style={styles.colHeadMeaning}>해석</div>
                    </div>

                    <div style={styles.columnRows}>
                      {colItems.map((w, rowIdx) => {
                        const globalIndex = colIdx * Math.ceil(seq.length / 3) + rowIdx;
                        const wordId = w.id || w.word_id;
                        const checked = checkedWrongIds.has(wordId);

                        return (
                          <label
                            key={`${wordId || globalIndex}-${globalIndex}`}
                            style={{
                              ...styles.columnRow,
                              background: checked ? THEME.dangerSoft : "#fff",
                              borderColor: checked ? THEME.dangerBd : THEME.border,
                            }}
                          >
                            <div style={styles.colCellCheck}>
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => toggleWrongWord(wordId)}
                              />
                            </div>
                            <div style={styles.colCellNo}>{globalIndex + 1}</div>
                            <div style={styles.colCellWord}>{w.term_en || "-"}</div>
                            <div style={styles.colCellMeaning}>{w.meaning_ko || "-"}</div>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

const styles = {
  page: {
    minHeight: "100vh",
    height: "100dvh",
    background: THEME.bg,
    color: THEME.text,
  },

  headerWrap: {
    position: "sticky",
    top: 0,
    zIndex: 10,
    background: THEME.bg,
    paddingTop: "env(safe-area-inset-top, 0px)",
    borderBottom: `1px solid ${THEME.border}`,
  },
  headerInner: {
    maxWidth: 1400,
    margin: "0 auto",
    padding: 14,
    paddingLeft: "max(14px, env(safe-area-inset-left, 0px))",
    paddingRight: "max(14px, env(safe-area-inset-right, 0px))",
  },

  titleRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 12,
    flexWrap: "wrap",
  },
  title: {
    fontSize: 20,
    fontWeight: 900,
    color: THEME.text,
    letterSpacing: "-0.2px",
  },
  sub: {
    fontSize: 12,
    color: THEME.sub,
    fontWeight: 800,
    marginTop: 4,
    lineHeight: 1.5,
  },

  rightTopBtns: {
    display: "flex",
    gap: 8,
    flexWrap: "wrap",
    alignItems: "center",
  },

  errBox: {
    marginTop: 10,
    background: THEME.dangerSoft,
    border: `1px solid ${THEME.dangerBd}`,
    borderRadius: 12,
    padding: 12,
    color: THEME.dangerText,
    fontWeight: 900,
    whiteSpace: "pre-wrap",
  },

  content: {
    maxWidth: 1400,
    margin: "0 auto",
    padding: 14,
    paddingLeft: "max(14px, env(safe-area-inset-left, 0px))",
    paddingRight: "max(14px, env(safe-area-inset-right, 0px))",
    paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 16px)",
  },

  card: {
    background: THEME.card,
    border: `1px solid ${THEME.border}`,
    borderRadius: 16,
    padding: 14,
    boxShadow: "0 10px 30px rgba(31,42,68,0.06)",
  },
  cardTitle: {
    fontSize: 15,
    fontWeight: 900,
    color: THEME.text,
    marginBottom: 10,
  },

  label: {
    fontSize: 12,
    color: THEME.sub,
    fontWeight: 900,
    marginBottom: 6,
  },

  input: {
    width: "100%",
    height: 44,
    padding: "0 12px",
    borderRadius: 12,
    border: `1px solid ${THEME.borderPink}`,
    outline: "none",
    fontSize: 14,
    fontWeight: 800,
    color: THEME.text,
    background: "#fff",
  },

  box: {
    border: `1px solid ${THEME.borderPink}`,
    borderRadius: 14,
    padding: 12,
    background: THEME.pinkSoft2,
  },

  muted: {
    fontSize: 13,
    color: THEME.sub,
    fontWeight: 800,
    lineHeight: 1.45,
  },

  searchList: {
    display: "grid",
    gap: 8,
  },
  searchItem: {
    textAlign: "left",
    padding: 12,
    borderRadius: 12,
    border: `1px solid ${THEME.border}`,
    background: "#fff",
    cursor: "pointer",
  },
  searchMeta: {
    fontSize: 12,
    color: THEME.sub,
    fontWeight: 800,
    marginTop: 3,
    lineHeight: 1.45,
  },

  pickedStudentBox: {
    marginTop: 12,
    padding: 12,
    borderRadius: 14,
    background: THEME.blueSoft,
    border: `1px solid ${THEME.blueBd}`,
  },
  pickedSub: {
    marginTop: 4,
    fontSize: 12,
    color: THEME.sub,
    fontWeight: 800,
  },

  grid2: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 12,
    alignItems: "start",
  },

  bookPickRow: {
    border: `1px solid ${THEME.border}`,
    borderRadius: 12,
    padding: 10,
    background: "#fff",
  },
  checkboxLabel: {
    fontWeight: 900,
    color: THEME.text,
    cursor: "pointer",
  },

  selectedBookCard: {
    border: `1px solid ${THEME.borderPink}`,
    borderRadius: 12,
    padding: 10,
    background: "#fff",
  },
  selectedBookTop: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  },

  kvGrid3: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr 1fr",
    gap: 10,
  },

  infoLine: {
    marginTop: 10,
    fontSize: 13,
    color: THEME.sub,
    fontWeight: 800,
  },

  pinkBtn: {
    height: 44,
    padding: "0 16px",
    borderRadius: 12,
    border: "none",
    background: THEME.pink,
    color: "#fff",
    fontWeight: 900,
    cursor: "pointer",
    boxShadow: "0 10px 22px rgba(255,111,163,.18)",
    whiteSpace: "nowrap",
  },

  ghostBtnPill: {
    height: 44,
    padding: "0 14px",
    borderRadius: 12,
    border: `1px solid ${THEME.border}`,
    background: "#fff",
    color: THEME.text,
    fontWeight: 900,
    cursor: "pointer",
    whiteSpace: "nowrap",
  },

  smallDangerBtn: {
    height: 34,
    padding: "0 10px",
    borderRadius: 10,
    border: `1px solid ${THEME.dangerBd}`,
    background: THEME.dangerSoft,
    color: THEME.dangerText,
    fontWeight: 900,
    cursor: "pointer",
    whiteSpace: "nowrap",
  },

  smallDangerBtn2: {
    height: 44,
    padding: "0 14px",
    borderRadius: 12,
    border: `1px solid ${THEME.dangerBd}`,
    background: THEME.dangerSoft,
    color: THEME.dangerText,
    fontWeight: 900,
    cursor: "pointer",
    whiteSpace: "nowrap",
  },

  examWrap: {
    minHeight: "calc(100dvh - 140px)",
    display: "grid",
    alignContent: "space-between",
    gap: 18,
  },

  examTopBar: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "stretch",
    gap: 12,
    flexWrap: "wrap",
  },
  examMeta: {
    flex: 1,
    minWidth: 280,
    background: "#fff",
    border: `1px solid ${THEME.border}`,
    borderRadius: 16,
    padding: 14,
    boxShadow: "0 10px 30px rgba(31,42,68,0.06)",
  },
  examMetaLine: {
    fontSize: 18,
    color: THEME.text,
    fontWeight: 900,
  },
  examMetaSub: {
    marginTop: 6,
    fontSize: 13,
    color: THEME.sub,
    fontWeight: 800,
    lineHeight: 1.45,
    wordBreak: "break-word",
  },

  examRight: {
    minWidth: 170,
    background: THEME.pinkSoft,
    border: `1px solid ${THEME.borderPink}`,
    borderRadius: 16,
    padding: 14,
    display: "grid",
    alignContent: "center",
    justifyItems: "center",
  },
  bigTimer: {
    fontSize: 40,
    fontWeight: 900,
    color: THEME.pink,
    lineHeight: 1,
  },
  examCounter: {
    marginTop: 8,
    fontSize: 16,
    color: THEME.text,
    fontWeight: 900,
  },

  examCard: {
    minHeight: "44vh",
    display: "grid",
    placeItems: "center",
    textAlign: "center",
    background: "#fff",
    border: `1px solid ${THEME.borderPink}`,
    borderRadius: 28,
    padding: 24,
    boxShadow: "0 18px 40px rgba(255,111,163,.10)",
  },
  examWord: {
    fontSize: "clamp(42px, 8vw, 96px)",
    fontWeight: 900,
    color: THEME.text,
    lineHeight: 1.15,
    wordBreak: "break-word",
  },
  examHint: {
    marginTop: 14,
    fontSize: 18,
    color: THEME.sub,
    fontWeight: 800,
  },

  examBottomBtns: {
    display: "flex",
    justifyContent: "center",
    gap: 10,
    flexWrap: "wrap",
  },

  answerHeader: {
    display: "flex",
    justifyContent: "space-between",
    gap: 12,
    alignItems: "flex-start",
    flexWrap: "wrap",
  },
  answerActions: {
    display: "flex",
    gap: 8,
    flexWrap: "wrap",
    alignItems: "center",
  },

  summaryBox: {
    marginTop: 12,
    padding: 12,
    borderRadius: 12,
    background: THEME.yellowSoft,
    border: `1px solid ${THEME.yellowBd}`,
    fontSize: 13,
    color: THEME.text,
    fontWeight: 800,
    lineHeight: 1.6,
  },

  answerSheet: {
    marginTop: 14,
    border: `1px solid ${THEME.border}`,
    borderRadius: 16,
    padding: 12,
    background: "#fff",
  },
  answerSheetHead: {
    borderBottom: `1px solid ${THEME.border}`,
    paddingBottom: 8,
    marginBottom: 10,
  },
  sheetTitle: {
    fontSize: 20,
    fontWeight: 900,
    color: THEME.text,
    lineHeight: 1.1,
  },
  sheetSub: {
    marginTop: 3,
    fontSize: 12,
    color: THEME.sub,
    fontWeight: 800,
    lineHeight: 1.35,
  },

  answerColumnsWrap: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr 1fr",
    gap: 8,
    alignItems: "start",
  },
  answerColumn: {
    minWidth: 0,
  },
  columnHead: {
    display: "grid",
    gridTemplateColumns: "44px 42px minmax(70px, 0.8fr) minmax(90px, 1fr)",
    gap: 4,
    alignItems: "center",
    padding: "6px 8px",
    borderRadius: 10,
    border: `1px solid ${THEME.borderPink}`,
    background: THEME.pinkSoft,
    fontWeight: 900,
    color: THEME.text,
    fontSize: 11,
  },
  columnRows: {
    display: "grid",
    gap: 4,
    marginTop: 4,
  },
  columnRow: {
    display: "grid",
    gridTemplateColumns: "44px 42px minmax(70px, 0.8fr) minmax(90px, 1fr)",
    gap: 4,
    alignItems: "center",
    padding: "5px 8px",
    borderRadius: 10,
    border: `1px solid ${THEME.border}`,
    minHeight: 38,
  },

  colHeadCheck: {
    display: "flex",
    alignItems: "center",
  },
  colHeadNo: {
    textAlign: "center",
  },
  colHeadWord: {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  colHeadMeaning: {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },

  colCellCheck: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  colCellNo: {
    textAlign: "center",
    fontWeight: 900,
    color: THEME.text,
    fontSize: 12,
  },
  colCellWord: {
    fontWeight: 900,
    color: THEME.text,
    fontSize: 11,
    lineHeight: 1.15,
    wordBreak: "break-word",
  },
  colCellMeaning: {
    color: THEME.text,
    fontWeight: 800,
    fontSize: 11,
    lineHeight: 1.15,
    wordBreak: "break-word",
  },
};