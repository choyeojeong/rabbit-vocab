// src/main.jsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './styles/responsive.css'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// ✅ PWA Service Worker 처리
if ('serviceWorker' in navigator) {
  if (import.meta.env.PROD) {
    // ── 배포(프로덕션)에서만 등록
    window.addEventListener('load', () => {
      navigator.serviceWorker
        .register('/sw.js')
        .then((reg) => {
          console.log('✅ Service Worker 등록 성공:', reg.scope)
        })
        .catch((err) => {
          console.error('❌ Service Worker 등록 실패:', err)
        })
    })
  } else {
    // ── 개발 모드: 기존 SW/캐시 자동 해제(웹소켓/HMR 충돌 방지)
    navigator.serviceWorker.getRegistrations?.().then((regs) => {
      regs.forEach((r) => r.unregister())
    })
    if (window.caches?.keys) {
      caches.keys().then((keys) => keys.forEach((k) => caches.delete(k)))
    }
    console.log('🧹 DEV: 기존 Service Worker 해제 & 캐시 삭제 완료')
  }
}
