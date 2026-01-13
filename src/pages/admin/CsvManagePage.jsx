// src/pages/admin/CsvManagePage.jsx
import { useEffect, useMemo, useRef, useState } from "react";
import Papa from "papaparse";
import { supabase } from "../../utils/supabaseClient";

/**
 * CSV Manage Page (통합)
 * - 파일 업로드 → 파싱 → /api/csv-prepare 소배치 호출 → (선택)AI 보정 → Supabase 등록
 * - 미리보기 테이블 제거
 * - 같은 페이지에서:
 *   1) 분류 트리 관리(추가/수정/삭제)
 *   2) 현재 book(책이름)에 분류 지정/저장
 *
 * ✅ 추가 요구사항 반영
 * - 같은 book 이름으로 여러 번 업로드 가능:
 *   - 이미 들어간 (book+chapter+term_en)은 중복 스킵되어 "책이 점점 완성"됨
 * - book 이름 입력에 자동완성(이전 등록된 book명 추천)
 *
 * ✅ DB 스키마(사용자 제공):
 * - public.book_category_nodes
 * - public.book_category_map
 * - tg_set_updated_at()
 */
export default function CsvManagePage() {
  const fileRef = useRef(null);

  // 옵션
  const [bookOverride, setBookOverride] = useState("");
  const [fillMissing, setFillMissing] = useState(true);

  // 업로드 기록에서 넘어온 정보(?batchId=..&book=..&chapter=..)
  const [linkedBatchInfo, setLinkedBatchInfo] = useState(null);
  const [linkedChapter, setLinkedChapter] = useState("");

  // 상태
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [resultCsv, setResultCsv] = useState("");
  const [stats, setStats] = useState(null);
  const [rows, setRows] = useState([]);
  const [errorMsg, setErrorMsg] = useState("");

  // ✅ 등록 결과(중복 스킵 등) 표시
  const [registerReport, setRegisterReport] = useState(null);

  // =========================
  // ✅ book 자동완성(추천) 상태
  // =========================
  const [bookSuggest, setBookSuggest] = useState([]); // string[]
  const [bookSuggestOpen, setBookSuggestOpen] = useState(false);
  const [bookSuggestLoading, setBookSuggestLoading] = useState(false);
  const bookSuggestTimer = useRef(null);

  // =========================
  // ✅ 분류(트리) 관련 상태
  // =========================
  const [catBusy, setCatBusy] = useState(false);
  const [catError, setCatError] = useState("");
  const [flatCats, setFlatCats] = useState([]); // book_category_nodes 원본
  const [expandedIds, setExpandedIds] = useState(() => new Set());
  const [selectedCatId, setSelectedCatId] = useState(null);

  // 현재 book에 매핑된 category_id
  const [mappedCategoryId, setMappedCategoryId] = useState(null);

  // 입력
  const [newRootName, setNewRootName] = useState("");
  const [newChildName, setNewChildName] = useState("");
  const [renameName, setRenameName] = useState("");

  // 쿼리스트링 읽어서 기본값 세팅
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search);
    const batchId = sp.get("batchId");
    const book = sp.get("book");
    const chapter = sp.get("chapter");
    if (batchId || book || chapter) {
      setLinkedBatchInfo({
        batchId: batchId || null,
        book: book || "",
      });
      if (book) setBookOverride(book);
      if (chapter) setLinkedChapter(chapter);
    }
  }, []);

  // 현재 book 이름(= 매핑 단위)
  const currentBookName = useMemo(() => {
    return (bookOverride || stats?.book || "").toString().trim();
  }, [bookOverride, stats?.book]);

  // ✅ 분류 로드
  useEffect(() => {
    loadCategories();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ✅ book이 바뀌면 매핑 로드
  useEffect(() => {
    if (!currentBookName) {
      setMappedCategoryId(null);
      return;
    }
    loadBookCategoryForBook(currentBookName);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentBookName]);

  // =========================
  // ✅ book 자동완성 로드 (debounce)
  // =========================
  useEffect(() => {
    // bookOverride 변경될 때마다 추천 갱신(너무 자주 호출 방지)
    const q = (bookOverride || "").trim();

    if (bookSuggestTimer.current) clearTimeout(bookSuggestTimer.current);
    bookSuggestTimer.current = setTimeout(() => {
      loadBookSuggestions(q);
    }, 220);

    return () => {
      if (bookSuggestTimer.current) clearTimeout(bookSuggestTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookOverride]);

  // 첫 진입 시에도 최근 book 목록 한 번 로드(빈 검색)
  useEffect(() => {
    loadBookSuggestions("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function loadBookSuggestions(query) {
    setBookSuggestLoading(true);
    try {
      const q = (query || "").trim();
      const like = q ? `%${q}%` : "%";

      // ✅ 1) word_batches에서 최근 book 먼저(가벼움)
      const { data: b1, error: e1 } = await supabase
        .from("word_batches")
        .select("book,created_at")
        .ilike("book", like)
        .order("created_at", { ascending: false })
        .limit(60);

      if (e1) throw new Error(e1.message);

      // ✅ 2) vocab_words에서도 book을 조금 보강(혹시 batches가 적을 때)
      const { data: b2, error: e2 } = await supabase
        .from("vocab_words")
        .select("book,created_at")
        .ilike("book", like)
        .order("created_at", { ascending: false })
        .limit(60);

      if (e2) {
        // vocab_words 쪽은 실패해도 batches만으로 동작하게(경고만)
        console.warn("vocab_words book suggestion error:", e2.message);
      }

      const merged = [];
      const seen = new Set();

      const pushBook = (val) => {
        const s = (val || "").toString().trim();
        if (!s) return;
        if (seen.has(s)) return;
        seen.add(s);
        merged.push(s);
      };

      (b1 || []).forEach((x) => pushBook(x.book));
      (b2 || []).forEach((x) => pushBook(x.book));

      // 너무 많으면 20개만
      setBookSuggest(merged.slice(0, 20));
    } catch (e) {
      console.warn("loadBookSuggestions failed:", e?.message || String(e));
      // 조용히 실패 처리(자동완성은 부가 기능)
      setBookSuggest([]);
    } finally {
      setBookSuggestLoading(false);
    }
  }

  function applyBookSuggestion(name) {
    const v = (name || "").toString().trim();
    if (!v) return;
    setBookOverride(v);
    setBookSuggestOpen(false);
  }

  // =========================
  // 공통: chapter를 안전하게 숫자로 바꾸기
  // =========================
  function toSafeChapter(val) {
    if (val === undefined || val === null || val === "") return null;
    const n = Number(val);
    if (Number.isNaN(n)) return null;
    return n;
  }

  // ✅ 키 정규화 (중복 판별용)
  function normTerm(v) {
    return (v ?? "").toString().trim().toLowerCase();
  }
  function normBook(v) {
    return (v ?? "").toString().trim();
  }
  function makeKey(book, chapter, term) {
    const b = normBook(book);
    const ch = toSafeChapter(chapter);
    const t = normTerm(term);
    return `${b}__${ch ?? "null"}__${t}`;
  }

  // ✅ 파일 내부 중복 제거 + (가능하면) 정보 보강 병합
  function dedupeRowsWithMerge(inputRows) {
    const map = new Map();
    let dupCount = 0;

    const splitAccepted = (s) =>
      (s ?? "")
        .toString()
        .split(/[,\|;]/g)
        .map((x) => x.trim())
        .filter(Boolean);

    for (const r of inputRows) {
      const key = makeKey(r.book, r.chapter, r.term_en);
      if (!key) continue;

      if (!map.has(key)) {
        map.set(key, { ...r });
      } else {
        dupCount += 1;
        const cur = map.get(key);

        // 빈 값이면 보강
        if (!String(cur.meaning_ko ?? "").trim() && String(r.meaning_ko ?? "").trim()) {
          cur.meaning_ko = r.meaning_ko;
        }
        if (!String(cur.pos ?? "").trim() && String(r.pos ?? "").trim()) {
          cur.pos = r.pos;
        }

        // accepted_ko는 합치기
        const a = new Set([...splitAccepted(cur.accepted_ko), ...splitAccepted(r.accepted_ko)]);
        cur.accepted_ko = Array.from(a).join(", ");

        map.set(key, cur);
      }
    }

    return { deduped: Array.from(map.values()), dupCount };
  }

  /** CSV 파일을 표준 행 구조로 파싱 */
  async function parseCsvFileToRows(file, bookFallback) {
    const text = await file.text();
    const parsed = Papa.parse(text, { header: true, skipEmptyLines: true });
    const headerMode = Array.isArray(parsed.data) && parsed.meta?.fields?.length > 0;
    let out = [];

    if (headerMode) {
      out = parsed.data
        .filter((r) => r && Object.values(r).some((v) => String(v ?? "").trim() !== ""))
        .map((r) => {
          const chapterRaw = r.chapter ?? r.index ?? r.chap ?? r.unit ?? r.section ?? "";

          return {
            book: (r.book ?? bookFallback ?? "").toString().trim(),
            chapter: chapterRaw.toString().trim(),
            term_en: (r.term_en ?? r.en ?? r.english ?? r.word ?? "").toString().trim(),
            meaning_ko: (r.meaning_ko ?? r.ko ?? r.korean ?? r.meaning ?? "").toString().trim(),
            pos: (r.pos ?? r.part_of_speech ?? "").toString().trim(),
            accepted_ko: (r.accepted_ko ?? r.synonyms_ko ?? r.syn_ko ?? "").toString().trim(),
          };
        });
    } else {
      // 헤더가 없는 CSV일 때
      const lines = text
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean);

      out = lines.map((line) => {
        const p = line.split(",");
        return {
          book: (p[0] ?? bookFallback ?? "").toString().trim(),
          chapter: (p[1] ?? "").toString().trim(),
          term_en: (p[2] ?? "").toString().trim(),
          meaning_ko: (p[3] ?? "").toString().trim(),
          pos: (p[4] ?? "").toString().trim(),
          accepted_ko: (p[5] ?? "").toString().trim(),
        };
      });
    }

    // 빈 행 제거
    out = out.filter(
      (r) => r.term_en !== "" || r.meaning_ko !== "" || r.pos !== "" || r.accepted_ko !== ""
    );

    // chapter 비어 있으면 "0"
    out = out.map((r) => ({
      ...r,
      chapter: r.chapter === "" ? "0" : r.chapter,
    }));

    return out;
  }

  /** 아주 작은 소배치(3줄)를 /api/csv-prepare로 보내서 AI 보정 */
  async function postSmallBatch(rowsChunk, { book, aiFill }) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 12000);

    try {
      const resp = await fetch("/api/csv-prepare", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rows: rowsChunk,
          book,
          aiFill,
        }),
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (!resp.ok) {
        return rowsChunk;
      }

      const data = await resp.json().catch(() => ({}));
      if (Array.isArray(data?.rows) && data.rows.length) {
        return data.rows;
      }

      return rowsChunk;
    } catch (e) {
      clearTimeout(timer);
      return rowsChunk;
    }
  }

  /** 큰 배열을 3줄씩 순차 처리 */
  async function prepareInTinyBatches(allRows, { book, aiFill, onProgress }) {
    const MAX_PER_REQ = 3;
    const out = [];
    const total = allRows.length || 0;
    let done = 0;

    for (let i = 0; i < total; i += MAX_PER_REQ) {
      const chunk = allRows.slice(i, i + MAX_PER_REQ);
      const converted = await postSmallBatch(chunk, { book, aiFill });
      out.push(...converted);
      done += chunk.length;
      if (onProgress) onProgress(done, total);
    }

    if (onProgress) onProgress(total, total);
    return out;
  }

  /** 업로드 핸들러 */
  async function handleUpload() {
    setErrorMsg("");
    setStats(null);
    setResultCsv("");
    setRows([]);
    setProgress(0);
    setRegisterReport(null);
    setBusy(true);

    try {
      const file = fileRef.current?.files?.[0];
      if (!file) {
        setErrorMsg("CSV 파일을 선택해주세요.");
        setBusy(false);
        return;
      }

      const fallbackBook = (bookOverride || file.name.replace(/\.[^.]+$/, "")).trim();
      const parsedRows = await parseCsvFileToRows(file, fallbackBook);

      let filledRows = parsedRows;

      if (fillMissing) {
        filledRows = await prepareInTinyBatches(parsedRows, {
          book: fallbackBook,
          aiFill: true,
          onProgress: (done, total) => {
            const pct = total > 0 ? done / total : 1;
            setProgress(pct);
          },
        });
      }

      // pos 후처리
      const postProcessed = filledRows.map((r) => {
        let pos = (r.pos || "").trim();
        const ko = (r.meaning_ko || "").trim();

        if (!pos) {
          if (
            ko.endsWith("의") ||
            ko.endsWith("적인") ||
            ko.endsWith("스러운") ||
            ko.endsWith("스러워하는")
          ) {
            pos = "형용사";
          }
        }

        return {
          ...r,
          pos,
        };
      });

      const csv = Papa.unparse(
        postProcessed.map((r) => ({
          ...r,
          chapter: r.chapter === "" ? "0" : r.chapter,
        })),
        {
          columns: ["book", "chapter", "term_en", "meaning_ko", "pos", "accepted_ko"],
        }
      );

      setRows(postProcessed);
      setResultCsv(csv);

      const total = postProcessed.length;
      const withPos = postProcessed.filter((r) => String(r.pos ?? "").trim() !== "").length;
      const withAcc = postProcessed.filter((r) => String(r.accepted_ko ?? "").trim() !== "").length;

      setStats({
        book: fallbackBook,
        original_rows: parsedRows.length,
        processed_rows: total,
        filled_pos_count: withPos,
        filled_acc_count: withAcc,
      });

      // 업로드 후 매핑 재조회
      if (fallbackBook) {
        await loadBookCategoryForBook(fallbackBook);
      }
    } catch (e) {
      setErrorMsg(e.message || String(e));
    } finally {
      setBusy(false);
    }
  }

  function downloadCsv() {
    if (!resultCsv) return;
    const fname = `${stats?.book || "normalized"}.csv`;
    const blob = new Blob([resultCsv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.download = fname;
    a.href = url;
    a.click();
    URL.revokeObjectURL(url);
  }

  /**
   * ✅ 책을 "누적 완성"하는 업로드 방식
   * - 같은 book 이름으로 여러 번 등록 가능
   * - (book,chapter,term_en) 유니크 기준으로 이미 있던 것은 스킵, 새 것만 추가
   * - => 1~3강 먼저 올리고, 4~30강 나중에 올려도 같은 book으로 계속 쌓임
   */
  async function registerToSupabase() {
    setErrorMsg("");
    setRegisterReport(null);

    if (!resultCsv || rows.length === 0) {
      setErrorMsg("먼저 CSV를 업로드하여 변환/보정을 완료해 주세요.");
      return;
    }

    setBusy(true);
    setProgress(0);

    try {
      const CHUNK = 500;

      // ✅ 최종 저장될 book명(선택값 우선)
      const finalBook = (bookOverride || stats?.book || "unknown").toString().trim();

      // ✅ 등록용 정규화 rows 만들기
      const normalized = rows.map((r) => {
        const rawChapter = r.chapter ?? r.index ?? "";
        const pos = (r.pos ?? "").toString().trim() || "기타";
        const accepted_ko = (r.accepted_ko ?? "").toString().trim() || null;

        return {
          book: finalBook,
          chapter: toSafeChapter(rawChapter),
          term_en: (r.term_en ?? "").toString().trim(),
          meaning_ko: (r.meaning_ko ?? "").toString().trim(),
          pos,
          accepted_ko,
        };
      });

      // ✅ 파일 내부 중복 제거(병합) + 카운트
      const { deduped, dupCount: skippedFileDup } = dedupeRowsWithMerge(normalized);

      // ✅ DB upsert(ignoreDuplicates)로 등록
      let attemptedUnique = 0;
      let inserted = 0;

      for (let i = 0; i < deduped.length; i += CHUNK) {
        const chunk = deduped.slice(i, i + CHUNK);

        const safeChunk = chunk.filter(
          (r) =>
            String(r.book ?? "").trim() &&
            String(r.term_en ?? "").trim() &&
            r.chapter !== null &&
            r.chapter !== undefined
        );

        attemptedUnique += safeChunk.length;

        const { data, error: e2 } = await supabase
          .from("vocab_words")
          .upsert(safeChunk, {
            onConflict: "book,chapter,term_en",
            ignoreDuplicates: true, // ✅ 이미 있던 건 "스킵" => 누적 업로드에 최적
          })
          .select("id");

        if (e2) {
          throw new Error(`[vocab_words.upsert] ${e2.message}`);
        }

        inserted += Array.isArray(data) ? data.length : 0;

        const done = Math.min(i + CHUNK, deduped.length);
        setProgress(deduped.length > 0 ? done / deduped.length : 1);
      }

      const skippedDbDup = Math.max(0, attemptedUnique - inserted);

      // 2) word_batches 기록(로그)
      const { data: batch, error: e1 } = await supabase
        .from("word_batches")
        .insert({
          filename: fileRef.current?.files?.[0]?.name || "(unknown filename)",
          book: finalBook,
          chapter: linkedChapter ? toSafeChapter(linkedChapter) : 0,
          total_rows: rows.length,
        })
        .select()
        .single();

      if (e1) {
        throw new Error(
          `[word_batches.insert] 단어는 저장됐지만 기록은 못 남겼습니다: ${e1.message}`
        );
      }

      // 3) Storage 업로드(로그용 CSV 저장)
      if (resultCsv && batch?.id) {
        const csvBlob = new Blob([resultCsv], { type: "text/csv;charset=utf-8" });
        const storagePath = `${batch.id}.csv`;

        const { error: uploadErr } = await supabase.storage
          .from("csv_uploads")
          .upload(storagePath, csvBlob, {
            upsert: true,
            contentType: "text/csv",
          });

        if (uploadErr) {
          alert(
            "CSV는 테이블에 저장됐지만 Storage 업로드는 실패했습니다.\n" +
              uploadErr.message +
              "\n\nStorage 버킷(csv_uploads)에 insert 권한이 있는지 확인해 주세요."
          );
        }
      }

      setRegisterReport({
        attemptedUnique,
        inserted,
        skippedFileDup,
        skippedDbDup,
        batchId: batch?.id || null,
        book: finalBook,
      });

      // ✅ 등록 후 book 추천 목록도 최신화
      loadBookSuggestions(finalBook);

      alert(
        `등록 완료!\n배치ID: ${batch?.id}\n` +
          `유니크 기준 시도: ${attemptedUnique.toLocaleString()}건\n` +
          `신규 등록: ${inserted.toLocaleString()}건\n` +
          `중복 스킵(파일): ${skippedFileDup.toLocaleString()}건\n` +
          `중복 스킵(DB): ${skippedDbDup.toLocaleString()}건\n\n` +
          `✅ 같은 book 이름으로 나중에 강을 추가 업로드하면, 책이 계속 누적되어 완성됩니다.`
      );
    } catch (e) {
      setErrorMsg(e.message || String(e));
    } finally {
      setBusy(false);
      setProgress(0);
    }
  }

  // =========================
  // ✅ 분류 트리 로직 (book_category_nodes)
  // =========================
  async function loadCategories() {
    setCatError("");
    setCatBusy(true);
    try {
      const { data, error } = await supabase
        .from("book_category_nodes")
        .select("id,parent_id,name,sort_order,created_at,updated_at")
        .order("parent_id", { ascending: true, nullsFirst: true })
        .order("sort_order", { ascending: true })
        .order("name", { ascending: true });

      if (error) throw new Error(error.message);
      setFlatCats(Array.isArray(data) ? data : []);
    } catch (e) {
      setCatError(e.message || String(e));
    } finally {
      setCatBusy(false);
    }
  }

  // 트리 구성
  const catTree = useMemo(() => {
    const list = Array.isArray(flatCats) ? flatCats : [];
    const byParent = new Map();
    for (const n of list) {
      const p = n.parent_id || "root";
      if (!byParent.has(p)) byParent.set(p, []);
      byParent.get(p).push(n);
    }
    for (const [k, arr] of byParent.entries()) {
      arr.sort((a, b) => {
        const sa = a.sort_order ?? 0;
        const sb = b.sort_order ?? 0;
        if (sa !== sb) return sa - sb;
        return String(a.name || "").localeCompare(String(b.name || ""));
      });
      byParent.set(k, arr);
    }

    function build(parentKey) {
      const children = byParent.get(parentKey) || [];
      return children.map((c) => ({
        ...c,
        children: build(c.id),
      }));
    }

    return build("root");
  }, [flatCats]);

  function toggleExpand(id) {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function selectNode(id) {
    setSelectedCatId(id);
    setRenameName("");
  }

  const selectedNode = useMemo(() => {
    return flatCats.find((x) => x.id === selectedCatId) || null;
  }, [flatCats, selectedCatId]);

  async function addRootCategory() {
    const name = (newRootName || "").trim();
    if (!name) return;

    setCatError("");
    setCatBusy(true);
    try {
      const maxSort =
        Math.max(
          0,
          ...flatCats.filter((x) => !x.parent_id).map((x) => x.sort_order ?? 0)
        ) + 1;

      const { error } = await supabase.from("book_category_nodes").insert({
        name,
        parent_id: null,
        sort_order: maxSort,
      });

      if (error) throw new Error(error.message);

      setNewRootName("");
      await loadCategories();
    } catch (e) {
      setCatError(e.message || String(e));
    } finally {
      setCatBusy(false);
    }
  }

  async function addChildCategory() {
    const name = (newChildName || "").trim();
    if (!name) return;
    if (!selectedCatId) {
      setCatError("하위 분류를 추가하려면 먼저 부모 분류를 선택하세요.");
      return;
    }

    setCatError("");
    setCatBusy(true);
    try {
      const siblings = flatCats.filter((x) => x.parent_id === selectedCatId);
      const maxSort = Math.max(0, ...siblings.map((x) => x.sort_order ?? 0)) + 1;

      const { error } = await supabase.from("book_category_nodes").insert({
        name,
        parent_id: selectedCatId,
        sort_order: maxSort,
      });

      if (error) throw new Error(error.message);

      setNewChildName("");
      setExpandedIds((prev) => {
        const next = new Set(prev);
        next.add(selectedCatId);
        return next;
      });

      await loadCategories();
    } catch (e) {
      setCatError(e.message || String(e));
    } finally {
      setCatBusy(false);
    }
  }

  async function renameCategory() {
    if (!selectedCatId) return;
    const name = (renameName || "").trim();
    if (!name) return;

    setCatError("");
    setCatBusy(true);
    try {
      const { error } = await supabase
        .from("book_category_nodes")
        .update({ name })
        .eq("id", selectedCatId);

      if (error) throw new Error(error.message);

      setRenameName("");
      await loadCategories();
    } catch (e) {
      setCatError(e.message || String(e));
    } finally {
      setCatBusy(false);
    }
  }

  async function deleteCategory() {
    if (!selectedCatId) return;
    setCatError("");
    setCatBusy(true);
    try {
      const { error } = await supabase
        .from("book_category_nodes")
        .delete()
        .eq("id", selectedCatId);
      if (error) throw new Error(error.message);

      setSelectedCatId(null);
      setRenameName("");

      if (mappedCategoryId === selectedCatId) {
        setMappedCategoryId(null);
      }

      await loadCategories();
      if (currentBookName) await loadBookCategoryForBook(currentBookName);
    } catch (e) {
      setCatError(e.message || String(e));
    } finally {
      setCatBusy(false);
    }
  }

  // =========================
  // ✅ book_category_map 로딩/저장
  // =========================
  async function loadBookCategoryForBook(book) {
    const b = (book || "").toString().trim();
    if (!b) return;

    setCatError("");
    try {
      const { data, error } = await supabase
        .from("book_category_map")
        .select("book,category_id")
        .eq("book", b)
        .maybeSingle();

      if (error) throw new Error(error.message);
      setMappedCategoryId(data?.category_id || null);
    } catch (e) {
      setCatError(e.message || String(e));
      setMappedCategoryId(null);
    }
  }

  async function saveBookCategoryMapping() {
    const b = (currentBookName || "").toString().trim();
    if (!b) {
      setCatError("book 이름이 비어 있습니다. 먼저 book 이름을 지정하세요.");
      return;
    }
    if (!selectedCatId) {
      setCatError("책에 지정할 분류를 트리에서 선택하세요.");
      return;
    }

    setCatError("");
    setCatBusy(true);
    try {
      const { error } = await supabase
        .from("book_category_map")
        .upsert(
          {
            book: b,
            category_id: selectedCatId,
          },
          { onConflict: "book" }
        );

      if (error) throw new Error(error.message);

      setMappedCategoryId(selectedCatId);
    } catch (e) {
      setCatError(e.message || String(e));
    } finally {
      setCatBusy(false);
    }
  }

  async function clearBookCategoryMapping() {
    const b = (currentBookName || "").toString().trim();
    if (!b) return;

    setCatError("");
    setCatBusy(true);
    try {
      const { error } = await supabase.from("book_category_map").delete().eq("book", b);
      if (error) throw new Error(error.message);

      setMappedCategoryId(null);
    } catch (e) {
      setCatError(e.message || String(e));
    } finally {
      setCatBusy(false);
    }
  }

  // =========================
  // UI helpers
  // =========================
  function renderTree(nodes, depth = 0) {
    return nodes.map((n) => {
      const hasChildren = Array.isArray(n.children) && n.children.length > 0;
      const expanded = expandedIds.has(n.id);
      const selected = selectedCatId === n.id;
      const mapped = mappedCategoryId === n.id;

      return (
        <div key={n.id}>
          <div
            role="button"
            onClick={() => selectNode(n.id)}
            style={{
              ...styles.nodeRow,
              paddingLeft: 10 + depth * 14,
              background: selected ? "rgba(255,111,163,0.10)" : "#fff",
              borderColor: selected ? "rgba(255,111,163,0.45)" : "rgba(31,42,68,0.10)",
            }}
            title={n.name}
          >
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                if (hasChildren) toggleExpand(n.id);
              }}
              style={{
                ...styles.iconBtn,
                opacity: hasChildren ? 1 : 0.35,
                cursor: hasChildren ? "pointer" : "default",
              }}
              aria-label="toggle"
              title={hasChildren ? (expanded ? "접기" : "펼치기") : "하위 없음"}
            >
              {hasChildren ? (expanded ? "▾" : "▸") : "•"}
            </button>

            <div style={{ minWidth: 0, display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ ...styles.nodeName, fontWeight: selected ? 900 : 800 }}>{n.name}</div>
              {mapped && <span style={styles.badge}>현재 book</span>}
            </div>
          </div>

          {hasChildren && expanded && (
            <div style={{ marginTop: 6 }}>{renderTree(n.children, depth + 1)}</div>
          )}
        </div>
      );
    });
  }

  const canRunAi = !busy;
  const canDownload = !!resultCsv && !busy;
  const canRegister = !!resultCsv && rows.length > 0 && !busy;

  return (
    <div style={styles.page}>
      {/* ✅ sticky header (풀-폭) */}
      <div style={styles.headerWrap}>
        <div style={styles.headerInner}>
          <div style={styles.headerTop}>
            <div style={{ minWidth: 0 }}>
              <div style={styles.titleRow}>
                <div style={styles.title}>CSV 관리 (AI 변환/보정 + 책 분류)</div>
                <a href="/admin/csv/batches" style={styles.link}>
                  업로드 기록 보기 →
                </a>
              </div>
              <div style={styles.sub}>
                파일 업로드 → (선택)AI 보정 → Supabase 등록 + 책 분류 지정/관리
              </div>
            </div>

            <div style={styles.headerBtns}>
              <button
                type="button"
                onClick={handleUpload}
                disabled={!canRunAi}
                style={styles.btnPink}
                title="선택한 CSV를 파싱하고(선택 시) AI 보정을 수행합니다."
              >
                {busy ? "처리 중…" : "AI 변환 실행"}
              </button>
            </div>
          </div>

          {linkedBatchInfo && (
            <div style={styles.info}>
              업로드 기록에서 넘어온 배치입니다.
              {linkedBatchInfo.batchId ? <> (batchId: {linkedBatchInfo.batchId})</> : null}
              <br />
              이 페이지에서 파일을 다시 업로드한 뒤 “Supabase 등록”을 눌러주세요.
            </div>
          )}

          {busy && (
            <div style={styles.progressWrap}>
              <div style={styles.progressBarBg}>
                <div
                  style={{
                    ...styles.progressBarFill,
                    width: `${Math.round(progress * 100)}%`,
                  }}
                />
              </div>
              <div style={styles.progressText}>{Math.round(progress * 100)}%</div>
            </div>
          )}

          {errorMsg && (
            <div style={styles.error}>
              <strong>오류:</strong> {errorMsg}
            </div>
          )}
        </div>
      </div>

      {/* ✅ content (풀-폭) */}
      <div style={styles.content}>
        {/* 설정 */}
        <div style={styles.card}>
          <div style={styles.cardTitle}>업로드 / 옵션</div>

          <div className="_csv_grid" style={styles.grid3}>
            <div style={styles.col}>
              <label style={styles.label}>CSV 파일</label>
              <input ref={fileRef} type="file" accept=".csv" style={styles.fileInput} />
              <div style={styles.hint}>
                같은 book 이름으로 여러 번 등록하면, 기존 단어는 중복 스킵되고 새 단어만
                추가되어 책이 점점 완성됩니다.
              </div>
            </div>

            <div style={styles.col}>
              <label style={styles.label}>book 이름(책 이름) — 자동완성</label>

              {/* ✅ datalist 제거: 커스텀 추천만 사용 (겹침 방지) */}
              <input
                value={bookOverride}
                onChange={(e) => setBookOverride(e.target.value)}
                onFocus={() => setBookSuggestOpen(true)}
                onBlur={() => {
                  // 클릭 선택을 위해 약간 늦게 닫기
                  setTimeout(() => setBookSuggestOpen(false), 120);
                }}
                placeholder="예: 워드마스터 수능2000 (파생어포함, 2023개정)"
                style={styles.input}
                autoComplete="off"
              />

              {/* ✅ 커스텀 추천 드롭다운(모바일에서도 확실히 보이게) */}
              {bookSuggestOpen && (bookSuggest?.length > 0 || bookSuggestLoading) && (
                <div style={styles.suggestBox}>
                  <div style={styles.suggestHeader}>
                    <div style={{ fontWeight: 900 }}>추천 book</div>
                    <div style={styles.suggestSub}>
                      {bookSuggestLoading ? "불러오는 중…" : `${bookSuggest.length}개`}
                    </div>
                  </div>
                  <div style={styles.suggestList}>
                    {(bookSuggest || []).map((b) => (
                      <button
                        key={b}
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => applyBookSuggestion(b)}
                        style={styles.suggestItem}
                        title={b}
                      >
                        {b}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {linkedChapter ? (
                <div style={styles.hint}>※ 이 배치는 chapter {linkedChapter} 로 넘어왔습니다.</div>
              ) : null}
              {currentBookName ? (
                <div style={{ ...styles.hint, marginTop: 6 }}>
                  현재 book: <b>{currentBookName}</b>
                </div>
              ) : null}
            </div>

            <div style={styles.col}>
              <label style={styles.label}>AI 보정</label>
              <label style={styles.check}>
                <input
                  type="checkbox"
                  checked={fillMissing}
                  onChange={(e) => setFillMissing(e.target.checked)}
                />
                <span style={{ marginLeft: 8 }}>비어 있는 pos/accepted_ko 채우기</span>
              </label>

              <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap" }}>
                <button type="button" onClick={downloadCsv} disabled={!canDownload} style={styles.btnGhost}>
                  결과 CSV 다운로드
                </button>
                <button
                  type="button"
                  onClick={registerToSupabase}
                  disabled={!canRegister}
                  style={styles.btnPinkSolid}
                >
                  Supabase 등록
                </button>
              </div>
            </div>
          </div>

          {stats && (
            <div style={styles.stats}>
              <div style={styles.statsTitle}>처리 요약</div>
              <div className="_csv_stats" style={styles.statsGrid}>
                <div style={styles.statsLabel}>book</div>
                <div style={styles.statsValue}>{stats.book}</div>

                <div style={styles.statsLabel}>원본 행 수</div>
                <div style={styles.statsValue}>{stats.original_rows?.toLocaleString?.()}</div>

                <div style={styles.statsLabel}>처리 행 수</div>
                <div style={styles.statsValue}>{stats.processed_rows?.toLocaleString?.()}</div>

                <div style={styles.statsLabel}>pos 채워진 행</div>
                <div style={styles.statsValue}>{stats.filled_pos_count?.toLocaleString?.()}</div>

                <div style={styles.statsLabel}>accepted_ko 채워진 행</div>
                <div style={styles.statsValue}>{stats.filled_acc_count?.toLocaleString?.()}</div>
              </div>
            </div>
          )}

          {registerReport && (
            <div style={styles.report}>
              <div style={styles.reportTitle}>✅ 등록 결과 (중복 스킵 포함)</div>
              <div className="_csv_report" style={styles.reportGrid}>
                <div style={styles.reportLabel}>book</div>
                <div style={styles.reportValue}>{registerReport.book}</div>

                <div style={styles.reportLabel}>유니크 기준 시도</div>
                <div style={styles.reportValue}>{registerReport.attemptedUnique.toLocaleString()}건</div>

                <div style={styles.reportLabel}>신규 등록</div>
                <div style={styles.reportValue}>{registerReport.inserted.toLocaleString()}건</div>

                <div style={styles.reportLabel}>중복 스킵(파일 내부)</div>
                <div style={styles.reportValue}>{registerReport.skippedFileDup.toLocaleString()}건</div>

                <div style={styles.reportLabel}>중복 스킵(DB 기존)</div>
                <div style={styles.reportValue}>{registerReport.skippedDbDup.toLocaleString()}건</div>

                <div style={styles.reportLabel}>배치 ID</div>
                <div style={styles.reportValue}>{registerReport.batchId || "-"}</div>
              </div>
              <div style={styles.reportHint}>
                ※ 같은 book으로 다시 업로드해도 이미 있던 (book+chapter+term_en)은 스킵되고 새 강/새 단어만 추가됩니다.
              </div>
            </div>
          )}
        </div>

        {/* ✅ 여기부터: 미리보기 대신 "분류 트리 + 관리 + 책에 지정" */}
        <div style={{ height: 12 }} />

        <div style={styles.card}>
          <div style={styles.subhead}>
            <div style={{ fontWeight: 900 }}>책 분류(트리) / 분류 지정</div>
            <div style={styles.muted}>{catBusy ? "불러오는 중…" : `분류 ${flatCats.length.toLocaleString()}개`}</div>
          </div>

          {catError && (
            <div style={{ ...styles.error, marginTop: 0 }}>
              <strong>분류 오류:</strong> {catError}
            </div>
          )}

          <div className="_cat_grid" style={styles.catGrid}>
            {/* 왼쪽: 트리 */}
            <div style={styles.catCol}>
              <div style={styles.catBoxTitle}>분류 트리</div>

              <div style={styles.catBox}>
                {catBusy ? (
                  <div style={styles.catEmpty}>불러오는 중…</div>
                ) : catTree.length === 0 ? (
                  <div style={styles.catEmpty}>아직 분류가 없습니다. 오른쪽에서 “루트 분류 추가” 해주세요.</div>
                ) : (
                  <div>{renderTree(catTree)}</div>
                )}
              </div>

              <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                <button type="button" onClick={loadCategories} style={styles.btnGhost} disabled={catBusy}>
                  새로고침
                </button>

                <button
                  type="button"
                  onClick={saveBookCategoryMapping}
                  style={styles.btnPinkSolid}
                  disabled={catBusy || !currentBookName || !selectedCatId}
                  title="현재 book에 선택한 분류를 저장합니다."
                >
                  현재 book에 분류 지정
                </button>

                <button
                  type="button"
                  onClick={clearBookCategoryMapping}
                  style={styles.btnDangerGhost}
                  disabled={catBusy || !currentBookName || !mappedCategoryId}
                  title="현재 book의 분류 지정을 해제합니다."
                >
                  분류 지정 해제
                </button>
              </div>

              <div style={styles.catHint}>
                현재 book: <b>{currentBookName || "(없음)"}</b>
                <br />
                지정된 분류:{" "}
                <b>
                  {mappedCategoryId ? flatCats.find((x) => x.id === mappedCategoryId)?.name || "(알 수 없음)" : "-"}
                </b>
              </div>
            </div>

            {/* 오른쪽: 관리 패널 */}
            <div style={styles.catCol}>
              <div style={styles.catBoxTitle}>분류 관리</div>

              <div style={styles.manageBox}>
                <div style={styles.manageSection}>
                  <div style={styles.manageTitle}>루트 분류 추가</div>
                  <div style={styles.manageRow}>
                    <input
                      value={newRootName}
                      onChange={(e) => setNewRootName(e.target.value)}
                      placeholder="예: 중등 / 고등 / 수능 / 교재..."
                      style={styles.input}
                      disabled={catBusy}
                    />
                    <button
                      type="button"
                      onClick={addRootCategory}
                      style={styles.btnPinkSolid}
                      disabled={catBusy || !newRootName.trim()}
                    >
                      추가
                    </button>
                  </div>
                </div>

                <div style={styles.hr} />

                <div style={styles.manageSection}>
                  <div style={styles.manageTitle}>하위 분류 추가</div>
                  <div style={styles.manageSub}>
                    부모: <b>{selectedNode ? selectedNode.name : "(선택 없음)"} </b>
                    <span style={{ color: "#5d6b82" }}>(트리에서 부모를 클릭)</span>
                  </div>
                  <div style={styles.manageRow}>
                    <input
                      value={newChildName}
                      onChange={(e) => setNewChildName(e.target.value)}
                      placeholder="예: 중1~중2 / 중2~중3 / ..."
                      style={styles.input}
                      disabled={catBusy}
                    />
                    <button
                      type="button"
                      onClick={addChildCategory}
                      style={styles.btnPinkSolid}
                      disabled={catBusy || !selectedCatId || !newChildName.trim()}
                    >
                      추가
                    </button>
                  </div>
                </div>

                <div style={styles.hr} />

                <div style={styles.manageSection}>
                  <div style={styles.manageTitle}>이름 변경 / 삭제</div>
                  <div style={styles.manageSub}>
                    선택: <b>{selectedNode ? selectedNode.name : "(선택 없음)"}</b>
                  </div>
                  <div style={styles.manageRow}>
                    <input
                      value={renameName}
                      onChange={(e) => setRenameName(e.target.value)}
                      placeholder="새 이름"
                      style={styles.input}
                      disabled={catBusy || !selectedCatId}
                    />
                    <button
                      type="button"
                      onClick={renameCategory}
                      style={styles.btnGhost}
                      disabled={catBusy || !selectedCatId || !renameName.trim()}
                    >
                      변경
                    </button>
                  </div>

                  <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                    <button
                      type="button"
                      onClick={deleteCategory}
                      style={styles.btnDangerSolid}
                      disabled={catBusy || !selectedCatId}
                      title="선택한 분류를 삭제합니다. (하위도 함께 삭제됩니다)"
                    >
                      선택 분류 삭제
                    </button>
                    <div style={styles.warn}>
                      삭제 시 하위 분류도 함께 삭제됩니다(ON DELETE CASCADE).
                      <br />
                      또한 해당 분류로 지정된 book 매핑도 삭제됩니다(ON DELETE CASCADE).
                    </div>
                  </div>
                </div>
              </div>

              <div style={styles.catHint}>💡 팁: 트리에서 펼침/접힘은 왼쪽 아이콘(▸/▾)으로 조작합니다.</div>
            </div>
          </div>
        </div>

        <div style={{ height: 16 }} />
      </div>

      {/* ✅ 반응형 */}
      <style>{`
        @media (max-width: 860px) {
          ._csv_grid { grid-template-columns: 1fr !important; }
          ._csv_stats { grid-template-columns: 140px 1fr !important; }
          ._csv_report { grid-template-columns: 140px 1fr !important; }
          ._cat_grid { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </div>
  );
}

const styles = {
  page: {
    minHeight: "100vh",
    height: "100dvh",
    background: "#fff5f8",
    color: "#1f2a44",
  },

  headerWrap: {
    position: "sticky",
    top: 0,
    zIndex: 10,
    background: "#fff5f8",
    paddingTop: "env(safe-area-inset-top, 0px)",
    borderBottom: "1px solid #ffd3e3",
  },
  headerInner: {
    maxWidth: 1600,
    margin: "0 auto",
    padding: 14,
    paddingLeft: "max(14px, env(safe-area-inset-left, 0px))",
    paddingRight: "max(14px, env(safe-area-inset-right, 0px))",
  },
  headerTop: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
    flexWrap: "wrap",
  },
  titleRow: { display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" },
  title: { fontSize: 18, fontWeight: 900, letterSpacing: "-0.2px" },
  link: { fontSize: 13, color: "#ff6fa3", fontWeight: 900, textDecoration: "none" },
  sub: { marginTop: 4, fontSize: 12, color: "#5d6b82", fontWeight: 800 },

  headerBtns: { display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" },

  info: {
    marginTop: 10,
    background: "#ecfeff",
    border: "1px solid #bae6fd",
    borderRadius: 12,
    padding: 10,
    fontSize: 13,
    color: "#075985",
    fontWeight: 800,
    lineHeight: 1.45,
  },

  progressWrap: { marginTop: 10, display: "flex", alignItems: "center", gap: 10 },
  progressBarBg: { flex: 1, height: 10, background: "#fff", border: "1px solid #ffd3e3", borderRadius: 999 },
  progressBarFill: { height: 10, borderRadius: 999, background: "#ff6fa3", transition: "width .2s" },
  progressText: { fontSize: 12, color: "#5d6b82", fontWeight: 900, minWidth: 38, textAlign: "right" },

  error: {
    marginTop: 10,
    padding: 10,
    borderRadius: 12,
    background: "#fff1f2",
    border: "1px solid #fecdd3",
    color: "#9f1239",
    fontWeight: 900,
    boxShadow: "0 10px 22px rgba(159,18,57,.08)",
  },

  content: {
    maxWidth: 1600,
    margin: "0 auto",
    padding: 14,
    paddingLeft: "max(14px, env(safe-area-inset-left, 0px))",
    paddingRight: "max(14px, env(safe-area-inset-right, 0px))",
    paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 16px)",
  },

  card: {
    background: "#ffffff",
    border: "1px solid #e9eef5",
    borderRadius: 16,
    padding: 14,
    boxShadow: "0 10px 30px rgba(255,192,217,.22)",
  },

  cardTitle: { fontSize: 14, fontWeight: 900, color: "#1f2a44", marginBottom: 10 },

  grid3: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr 1fr",
    gap: 12,
  },

  col: { minWidth: 0 },
  label: { display: "block", fontSize: 12, color: "#5d6b82", fontWeight: 900, marginBottom: 6 },
  hint: { fontSize: 12, color: "#6b7280", marginTop: 6, lineHeight: 1.45 },

  fileInput: { width: "100%", height: 44 },

  input: {
    width: "100%",
    height: 44,
    padding: "0 12px",
    border: "1px solid #ffd3e3",
    borderRadius: 12,
    outline: "none",
    fontSize: 14,
    fontWeight: 800,
    color: "#1f2a44",
    background: "#fff",
  },

  // ✅ book 추천 드롭다운
  suggestBox: {
    marginTop: 8,
    borderRadius: 14,
    border: "1px solid rgba(31,42,68,0.12)",
    background: "#fff",
    overflow: "hidden",
    boxShadow: "0 12px 24px rgba(31,42,68,0.10)",
  },
  suggestHeader: {
    display: "flex",
    justifyContent: "space-between",
    gap: 10,
    padding: "10px 12px",
    borderBottom: "1px solid rgba(31,42,68,0.08)",
  },
  suggestSub: { fontSize: 12, color: "#5d6b82", fontWeight: 900 },
  suggestList: { maxHeight: 220, overflow: "auto" },
  suggestItem: {
    width: "100%",
    textAlign: "left",
    padding: "10px 12px",
    border: "none",
    background: "#fff",
    cursor: "pointer",
    fontWeight: 900,
    color: "#1f2a44",
    borderBottom: "1px solid rgba(31,42,68,0.06)",
  },

  check: { display: "flex", alignItems: "center", height: 44, fontWeight: 800, color: "#1f2a44" },

  btnPink: {
    height: 44,
    padding: "0 14px",
    borderRadius: 999,
    border: "none",
    background: "#ff6fa3",
    color: "#fff",
    fontWeight: 900,
    cursor: "pointer",
    boxShadow: "0 10px 22px rgba(255,111,163,.18)",
    WebkitTapHighlightColor: "transparent",
    touchAction: "manipulation",
    whiteSpace: "nowrap",
  },

  btnPinkSolid: {
    height: 44,
    padding: "0 14px",
    borderRadius: 12,
    border: "1px solid #ff6fa3",
    background: "#ff6fa3",
    color: "#fff",
    fontWeight: 900,
    cursor: "pointer",
    boxShadow: "0 10px 22px rgba(255,111,163,.18)",
    WebkitTapHighlightColor: "transparent",
    touchAction: "manipulation",
    whiteSpace: "nowrap",
  },

  btnGhost: {
    height: 44,
    padding: "0 14px",
    borderRadius: 12,
    border: "1px solid #e5e7eb",
    background: "#fff",
    color: "#1f2a44",
    fontWeight: 900,
    cursor: "pointer",
    WebkitTapHighlightColor: "transparent",
    touchAction: "manipulation",
    whiteSpace: "nowrap",
  },

  btnDangerSolid: {
    height: 44,
    padding: "0 14px",
    borderRadius: 12,
    border: "1px solid #e54848",
    background: "#e54848",
    color: "#fff",
    fontWeight: 900,
    cursor: "pointer",
    WebkitTapHighlightColor: "transparent",
    touchAction: "manipulation",
    whiteSpace: "nowrap",
  },

  btnDangerGhost: {
    height: 44,
    padding: "0 14px",
    borderRadius: 12,
    border: "1px solid rgba(229,72,72,0.35)",
    background: "#fff",
    color: "#b91c1c",
    fontWeight: 900,
    cursor: "pointer",
    WebkitTapHighlightColor: "transparent",
    touchAction: "manipulation",
    whiteSpace: "nowrap",
  },

  stats: {
    marginTop: 12,
    padding: 12,
    borderRadius: 14,
    border: "1px solid #ffd3e3",
    background: "#fffbfd",
  },
  statsTitle: { fontWeight: 900, marginBottom: 8, color: "#1f2a44" },
  statsGrid: {
    display: "grid",
    gridTemplateColumns: "220px 1fr",
    gap: 8,
    fontSize: 13,
  },
  statsLabel: { color: "#5d6b82", fontWeight: 900 },
  statsValue: { color: "#1f2a44", fontWeight: 900 },

  report: {
    marginTop: 12,
    padding: 12,
    borderRadius: 14,
    background: "#ecfdf5",
    border: "1px solid #bbf7d0",
    color: "#065f46",
  },
  reportTitle: { fontWeight: 900, marginBottom: 8 },
  reportGrid: { display: "grid", gridTemplateColumns: "220px 1fr", gap: 8, fontSize: 13 },
  reportLabel: { fontWeight: 900, opacity: 0.9 },
  reportValue: { fontWeight: 900 },
  reportHint: { marginTop: 10, fontSize: 12, color: "#047857", fontWeight: 800, lineHeight: 1.45 },

  subhead: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 10 },
  muted: { color: "#5d6b82", fontWeight: 800, fontSize: 12 },

  // =========================
  // 분류 UI
  // =========================
  catGrid: {
    display: "grid",
    gridTemplateColumns: "1.1fr 0.9fr",
    gap: 12,
    alignItems: "start",
  },
  catCol: { minWidth: 0 },

  catBoxTitle: { fontSize: 13, fontWeight: 900, color: "#1f2a44", marginBottom: 8 },

  catBox: {
    border: "1px solid rgba(31,42,68,0.10)",
    borderRadius: 14,
    padding: 10,
    background: "#fff",
    maxHeight: 520,
    overflow: "auto",
  },

  catEmpty: { padding: 10, color: "#5d6b82", fontWeight: 800, fontSize: 13, lineHeight: 1.45 },

  nodeRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "10px 10px",
    borderRadius: 12,
    border: "1px solid rgba(31,42,68,0.10)",
    cursor: "pointer",
    userSelect: "none",
  },
  iconBtn: {
    width: 28,
    height: 28,
    borderRadius: 8,
    border: "1px solid rgba(31,42,68,0.10)",
    background: "#fff",
    fontWeight: 900,
    color: "#1f2a44",
  },
  nodeName: {
    fontSize: 13,
    color: "#1f2a44",
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
    maxWidth: 360,
  },
  badge: {
    fontSize: 11,
    fontWeight: 900,
    padding: "3px 8px",
    borderRadius: 999,
    background: "rgba(47,111,237,0.10)",
    border: "1px solid rgba(47,111,237,0.25)",
    color: "#1d4ed8",
    whiteSpace: "nowrap",
  },

  manageBox: {
    border: "1px solid rgba(31,42,68,0.10)",
    borderRadius: 14,
    padding: 12,
    background: "#fff",
  },
  manageSection: { padding: 2 },
  manageTitle: { fontWeight: 900, fontSize: 13, marginBottom: 8 },
  manageSub: { fontSize: 12, color: "#5d6b82", fontWeight: 800, marginBottom: 8, lineHeight: 1.45 },
  manageRow: { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" },

  hr: { height: 1, background: "rgba(31,42,68,0.10)", margin: "12px 0" },

  warn: {
    fontSize: 12,
    color: "#5d6b82",
    fontWeight: 800,
    lineHeight: 1.45,
  },

  catHint: {
    marginTop: 10,
    fontSize: 12,
    color: "#5d6b82",
    fontWeight: 800,
    lineHeight: 1.45,
  },
};
