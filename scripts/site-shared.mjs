// scripts/site-shared.mjs — 생성 페이지(weekly-brief.mjs, validate.mjs, brief/index 등)가
// site.css / site.js / gnav 마크업을 "인라인"해서 아카이브가 스스로 완결되게 만들 때 쓰는 공용 모듈.
// PLAN §3 계약: siteCSS(root), gnav(active, prefix='./'), FOOT, siteJS(root)(또는 SITE_JS_MIN).
// gnav() 는 site.js 의 SITE.gnav() 와 같은 마크업을 낸다 — 아이콘/구조를 손대면 두 파일 다 고칠 것.
import fs from 'node:fs';
import path from 'node:path';

/** site.css 파일 내용을 문자열로 읽는다. 생성 페이지의 <style> 안에 그대로 넣는다. */
export function siteCSS(root){
  return fs.readFileSync(path.join(root, 'site.css'), 'utf8');
}

/** site.js 파일 내용을 문자열로 읽는다. 생성 페이지에 <script>${siteJS(root)}</script> 로 인라인한다. */
export function siteJS(root){
  return fs.readFileSync(path.join(root, 'site.js'), 'utf8');
}

// site.js 의 NAV_ITEMS/NAV_ICONS 와 동일 — 마크업을 byte 단위로 맞추기 위해 그대로 복제.
const NAV_ITEMS = [
  { id: 'brief',    file: 'brief.html',    label: '이번 주', icon: 'calendar' },
  { id: 'index',    file: 'index.html',    label: '로또',    icon: 'ball' },
  { id: 'pension',  file: 'pension.html',  label: '연금',    icon: 'ticket' },
  { id: 'validate', file: 'validate.html', label: '검증',    icon: 'check-shield' },
  { id: 'record',   file: 'record.html',   label: '기록',    icon: 'ledger' }
];
const NAV_ICONS = {
  calendar: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.2" y="5" width="17.6" height="15.5" rx="2"/><path d="M8 3v4M16 3v4M3.2 9.6h17.6"/></svg>',
  ball: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.3"/><path d="M8.6 8.9a2.4 2.4 0 0 1 2.4-2.3"/></svg>',
  ticket: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 8.2a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v2.1a2 2 0 0 0 0 3.8v2.1a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-2.1a2 2 0 0 0 0-3.8V8.2Z"/><path d="M9.3 6.4v11.3" stroke-dasharray="2.1 2.1"/></svg>',
  'check-shield': '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.2 19 6v6c0 4.5-3 7.6-7 9-4-1.4-7-4.5-7-9V6l7-2.8Z"/><path d="M8.7 12.2 11 14.5l4.3-4.3"/></svg>',
  ledger: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4.2" y="3" width="15.6" height="18" rx="1.4"/><path d="M7.6 8h8.8M7.6 12h8.8M7.6 16h5.6"/></svg>'
};
function navId(active){
  let s = String(active || '').replace(/^\.?\/*/, '').replace(/\.html$/, '');
  if (s === 'lotto') s = 'index';
  if (s === '이번주' || s === '이번 주' || s === 'brief') s = 'brief';
  return s;
}

/**
 * 전역 내비(gnav) 마크업. site.js 의 SITE.gnav(active) 와 동일한 출력을 낸다.
 * @param {string} active  현재 페이지 id('brief'|'index'|'pension'|'validate'|'record', 또는 'index.html' 같은 파일명도 허용)
 * @param {string} [prefix='./']  링크 앞에 붙일 경로 접두어. 아카이브(brief/YYYY-MM-DD.html)에서는 '../'.
 */
export function gnav(active, prefix = './'){
  const cur = navId(active);
  let html = '<nav class="gnav" aria-label="사이트">';
  for (const it of NAV_ITEMS){
    const isCur = it.id === cur;
    html += `<a href="${prefix}${it.file}"${isCur ? ' aria-current="page"' : ''}>${NAV_ICONS[it.icon]}<span>${it.label}</span></a>`;
  }
  html += '</nav>';
  return html;
}

/** 법적 고지 문구(그대로 재사용) — 기존 brief/validate/carryover 가 쓰던 문구와 동일. */
export const FOOT = '복권 구매는 감당할 수 있는 범위 안에서. 만 19세 미만은 구매할 수 없습니다.';
