#!/usr/bin/env node
// scripts/check-names.mjs — 공개 저장소에 금지된 이름이 다시 들어오지 않게 막는 문지기.
//
// 하는 일: git 이 추적하는 모든 파일(내용 + 파일 이름)에서 금지어를 찾는다. 하나라도 있으면 종료 코드 1.
// 의존성: Node 내장 모듈만(child_process·fs·path·url). npm install 없이 워크플로 첫 단계에서 돈다.
//
// ── 금지어 목록은 이 저장소에 없다 ──────────────────────────────────────────────────────────
// 저장소가 공개라서, 목록을 코드에 두면(이스케이프·조각 이어붙이기·해시 어느 쪽이든) 그 자체가 이름을 알려 준다.
// 그래서 목록은 git 밖에서 읽는다. 두 곳을 읽어 합친다:
//   · 환경변수 CHECK_NAMES_LIST — CI. Actions 시크릿 CHECK_NAMES_LIST 를 사람이 등록한다(워크플로가 env 로 넘김).
//   · 파일 .lab/banned-names.txt — 로컬. .lab/ 은 .gitignore 이다. 다른 경로는 --list <파일>.
//   형식: 한 줄에 하나. 빈 줄 무시, # 로 시작하면 주석. 대소문자 무시, 한글은 조합형·분해형을 모두 찾는다.
//         공백이 든 항목(예: 영문 «성 이름»)은 붙임·공백·하이픈·밑줄·점 변형으로 자동 확장된다.
//   목록이 추적 파일이면(=공개되면) 실행 오류로 멈춘다.
//
// 목록이 하나도 없을 때(소유자 결정 사항 — 기본은 «경고만 내고 통과»):
//   · 기본: ::warning 한 줄을 내고 종료 코드 0. 시크릿을 아직 등록하지 않은 CI 가 갑자기 멈추지 않게.
//   · 막으려면: 환경변수 CHECK_NAMES_REQUIRE=1 (CI 는 저장소 변수 CHECK_NAMES_REQUIRE 를 1 로) 또는 --require → 종료 코드 2.
//
// ── 출력에 금지어를 찍지 않는다 ─────────────────────────────────────────────────────────────
// 로그·::error 주석은 공개 API 로 보일 수 있다. 그래서 금지어도, 그 줄의 내용도, 어느 항목인지의 글자도 찍지 않고
// «항목 번호» 만 낸다. 파일 «이름» 에 금지어가 있으면 그 경로도 가리고 추적 파일 순번만 낸다
// (로컬에서만 --show-paths 로 경로를 본다. GitHub Actions 에서는 이 옵션이 무시된다).
//
// 사용: node scripts/check-names.mjs [--root <저장소 폴더>] [--list <목록 파일>] [--require] [--show-paths]
//       <텍스트> | node scripts/check-names.mjs --stdin      (커밋 메시지·작성자 등 git 이 추적 파일로 보지 않는 곳 점검)
//         예) git log --all --format='%an %ae %cn %ce%n%B' | node scripts/check-names.mjs --stdin
// 종료 코드: 0 = 깨끗함(또는 목록 없음+경고), 1 = 발견, 2 = 실행 오류

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const has = (name) => process.argv.includes(name);
function arg(name, def) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}
// ::error 속성값 이스케이프(공식 규칙: % \r \n : ,)
const escProp = (s) => String(s).replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A').replace(/:/g, '%3A').replace(/,/g, '%2C');

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(arg('--root', path.join(here, '..')));
const IN_CI = !!process.env.GITHUB_ACTIONS;
const REQUIRE = has('--require') || /^(1|true|yes)$/i.test(String(process.env.CHECK_NAMES_REQUIRE || '').trim());
const SHOW_PATHS = has('--show-paths') && !IN_CI;
const STDIN_MODE = has('--stdin');

function fail(title, msg, code = 2) {
  console.error('::error title=' + title + '::' + msg);
  process.exit(code);
}

/* ── 1. 금지어 목록 읽기 (저장소 밖) ─────────────────────────────────────────────────────── */
const SEPS = ['', ' ', '-', '_', '.'];
const stripBom = (t) => (t.charCodeAt(0) === 0xFEFF ? t.slice(1) : t);
// 바이트를 1:1 로 문자로 바꿔(latin1) 소문자화 → 바이너리 파일 안의 UTF-8 바이트열도 같은 방식으로 찾는다.
const fold = (buf) => buf.toString('latin1').toLowerCase();

const listArg = arg('--list', null);
const listFile = listArg ? path.resolve(listArg) : path.join(ROOT, '.lab', 'banned-names.txt');
const sources = []; // { tag, lines }
if (String(process.env.CHECK_NAMES_LIST || '').trim()) sources.push({ tag: 'CHECK_NAMES_LIST', lines: process.env.CHECK_NAMES_LIST });
if (fs.existsSync(listFile)) {
  try {
    sources.push({ tag: '목록파일', lines: fs.readFileSync(listFile, 'utf8') });
  } catch (e) {
    fail('check-names 실행 오류', '금지어 목록 파일을 읽지 못했습니다 — ' + (e.message || e));
  }
} else if (listArg) {
  fail('check-names 실행 오류', '--list 로 준 금지어 목록 파일이 없습니다.');
}

const needles = []; // { label, key }
let entryCount = 0;
for (const src of sources) {
  let k = 0;
  for (const raw of stripBom(src.lines).split(/\r?\n/)) {
    const text = raw.trim();
    if (!text || text.startsWith('#')) continue;
    k++;
    entryCount++;
    const label = src.tag + ' #' + k;
    if ([...text].length < 2) fail('check-names 실행 오류', '금지어 항목 «' + label + '» 이(가) 너무 짧습니다(2자 이상). 모든 파일에 걸립니다.');
    const parts = text.split(/\s+/);
    const variants = parts.length > 1 ? SEPS.map((s) => parts.join(s)) : [text];
    const forms = new Set();
    for (const v of variants) {
      const low = v.toLowerCase();
      forms.add(low.normalize('NFC'));
      forms.add(low.normalize('NFD'));
    }
    for (const f of forms) needles.push({ label, key: fold(Buffer.from(f, 'utf8')) });
  }
}

if (!needles.length) {
  const msg = '금지어 목록이 없어 이름 검사를 하지 못했습니다. CI: Actions 시크릿 CHECK_NAMES_LIST 를 등록하세요. 로컬: .lab/banned-names.txt (또는 --list <파일>).';
  if (REQUIRE) fail('check-names 목록 없음', msg + ' (CHECK_NAMES_REQUIRE 가 켜져 있어 실패로 막습니다)');
  console.log('::warning title=check-names 건너뜀::' + msg + ' 목록이 없을 때 실패로 막으려면 CHECK_NAMES_REQUIRE=1.');
  console.log('check-names 건너뜀: 금지어 목록 없음(경고만, 종료 코드 0).');
  process.exit(0);
}

/* ── 2. 찾기 ─────────────────────────────────────────────────────────────────────────────── */
const hits = []; // { fi(추적 파일 인덱스, 표준입력이면 -1), line, label, kind }
let capped = false;

function scan(haystack, fi, kind) {
  for (const n of needles) {
    let from = 0;
    for (;;) {
      const i = haystack.indexOf(n.key, from);
      if (i < 0) break;
      let line = 1;
      if (kind !== '파일 이름') for (let q = haystack.indexOf('\n'); q >= 0 && q < i; q = haystack.indexOf('\n', q + 1)) line++;
      const last = hits[hits.length - 1];
      if (!(last && last.fi === fi && last.line === (kind === '파일 이름' ? 0 : line) && last.label === n.label && last.kind === kind)) {
        hits.push({ fi, line: kind === '파일 이름' ? 0 : line, label: n.label, kind });
      }
      from = i + n.key.length;
      if (hits.length > 200) { capped = true; return; } // 폭주 방지
    }
  }
}

if (STDIN_MODE) {
  let buf;
  try {
    buf = fs.readFileSync(0);
  } catch (e) {
    fail('check-names 실행 오류', '표준입력을 읽지 못했습니다 — ' + (e.message || e));
  }
  scan(fold(buf), -1, '표준입력');
  if (hits.length) {
    for (const h of hits) console.log('::error title=금지된 문자열::표준입력 ' + h.line + '행에 «' + h.label + '» 이(가) 있습니다');
    console.log('check-names 실패(표준입력): 금지 문자열 ' + hits.length + '건' + (capped ? ' 이상' : '') + '.');
    process.exit(1);
  }
  console.log('check-names 통과(표준입력): 금지 문자열 0건 · 목록 항목 ' + entryCount + '개.');
  process.exit(0);
}

let files;
try {
  const out = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 });
  files = out.toString('utf8').split('\0').filter(Boolean);
} catch (e) {
  fail('check-names 실행 오류', 'git ls-files 를 실행하지 못했습니다 — ' + (e.message || e));
}
if (!files.length) fail('check-names 실행 오류', '추적 파일이 0개입니다(저장소 폴더가 맞는지 확인).');

// 목록 파일이 추적되고 있으면(=공개됨) 검사 자체가 의미 없다.
{
  const rel = path.relative(ROOT, listFile).split(path.sep).join('/');
  if (fs.existsSync(listFile) && !rel.startsWith('..') && files.includes(rel)) {
    fail('check-names 실행 오류', '금지어 목록 파일이 git 에 추적되고 있습니다(공개됩니다). 추적에서 빼고(git rm --cached) 이 파일을 .gitignore 하세요.');
  }
}

// 1단계: 파일 이름. 걸린 파일은 이후 출력에서 경로를 가린다.
const nameHit = new Set();
for (let fi = 0; fi < files.length; fi++) {
  const before = hits.length;
  scan(fold(Buffer.from(files[fi], 'utf8')), fi, '파일 이름');
  if (hits.length > before) nameHit.add(fi);
  if (capped) break;
}
const masked = (fi) => nameHit.has(fi) && !SHOW_PATHS;
const shown = (fi) => (masked(fi) ? '(경로 가림: 추적 파일 순번 #' + (fi + 1) + ')' : files[fi]);

// 2단계: 파일 내용.
let scanned = 0;
let skipped = 0;
for (let fi = 0; fi < files.length && !capped; fi++) {
  let buf;
  try {
    buf = fs.readFileSync(path.join(ROOT, files[fi]));
  } catch (e) {
    if (e && (e.code === 'ENOENT' || e.code === 'EISDIR')) { skipped++; continue; } // 추적은 되지만 작업 트리에서 지워진 파일
    fail('check-names 실행 오류', shown(fi) + ' 를 읽지 못했습니다 — ' + (e.code || e.message || e));
  }
  scanned++;
  scan(fold(buf), fi, '내용');
}

/* ── 3. 보고 ─────────────────────────────────────────────────────────────────────────────── */
if (hits.length) {
  for (const h of hits) {
    const hide = masked(h.fi);
    const where = h.kind === '내용' ? shown(h.fi) + ':' + h.line : shown(h.fi);
    const props = (hide ? '' : 'file=' + escProp(files[h.fi]) + (h.line ? ',line=' + h.line + ',' : ',')) + 'title=금지된 문자열';
    console.log('::error ' + props + '::' + h.kind + '에 «' + h.label + '» 이(가) 있습니다 (' + where + ')');
  }
  console.log('check-names 실패: 금지 문자열 ' + hits.length + '건' + (capped ? ' 이상(200건에서 중단)' : '') + ' / 파일 ' + scanned + '개 검사. 대체 이름은 «잼족».');
  if (nameHit.size && !SHOW_PATHS) console.log('파일 이름에 걸린 경로는 가렸습니다. 로컬에서 --show-paths 로 확인하세요.');
  process.exit(1);
}
console.log('check-names 통과: 추적 파일 ' + scanned + '개(읽지 못한 삭제 파일 ' + skipped + '개 제외)에서 금지 문자열 0건 · 목록 항목 ' + entryCount + '개(' + needles.length + '개 변형).');
