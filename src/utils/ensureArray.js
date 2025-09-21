// src/utils/ensureArray.js
export function ensureArray(v) {
  if (Array.isArray(v)) return v;
  if (v === undefined || v === null) return [];
  return [v]; // 숫자/문자 등 단일 값 -> [값]
}
