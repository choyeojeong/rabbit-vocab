// public/sw.js
// ✅ 버전 올려서 강제 업데이트
const SW_VERSION = 'v2025-09-21-02';
const CACHE = `rabbit-pwa-${SW_VERSION}`;

const OFFLINE_URLS = [
  '/', '/index.html',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/maskable-512.png',
];

// Supabase API/Storage/Auth/Edge 함수 도메인은 캐시 금지 (네트워크 전용)
function isSupabaseRequest(url) {
  return (
    url.includes('.supabase.co/rest/v1') ||
    url.includes('.supabase.co/storage/v1') ||
    url.includes('.supabase.co/auth/v1') ||
    url.includes('.supabase.co/functions/v1')
  );
}

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(OFFLINE_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) =>
        Promise.all(keys.map((k) => (k !== CACHE ? caches.delete(k) : null)))
      )
      .then(() => self.clients.claim())
  );
});

// ✅ 네비게이션: 네트워크 우선, 실패 시 /index.html
// ✅ Supabase: 항상 네트워크 (캐시 금지)
// ✅ 정적 리소스: 동일 출처 + GET만 캐시 우선
self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = req.url;

  // 1) 앱 내 라우팅(HTML): network-first
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).catch(() => caches.match('/index.html'))
    );
    return;
  }

  // 2) Supabase 관련은 항상 네트워크 (캐시하지 않음)
  if (isSupabaseRequest(url)) {
    e.respondWith(fetch(req));
    return;
  }

  // 3) 그 외 정적 리소스: 동일 출처 + GET만 캐시
  const sameOrigin = new URL(url).origin === self.location.origin;
  const isGET = req.method === 'GET';

  if (sameOrigin && isGET) {
    e.respondWith(
      caches.match(req).then((cached) => {
        if (cached) return cached;

        return fetch(req).then((res) => {
          // opaques 등 캐시 불가능 응답은 건너뜀
          if (!res || res.status !== 200 || res.type !== 'basic') return res;

          const clone = res.clone();
          caches.open(CACHE).then((c) => c.put(req, clone));
          return res;
        }).catch(() => {
          // 이미지/폰트 등은 오프라인 대체 없음 → 그냥 실패 전파
          // 필요하면 여기서 파일 유형별 fallback 추가 가능
          return caches.match('/index.html'); // 최후의 보루
        });
      })
    );
    return;
  }

  // 4) 그 외(서드파티, POST 등): 네트워크 기본
  e.respondWith(fetch(req));
});
