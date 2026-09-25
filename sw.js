/* sw.js — 일확천금 서비스워커.
   동일 출처 GET만 다룬다. network-first(3.5s 타임아웃) → 캐시 폴백.
   캐시명 ll-v2. 프리캐시: brief.html, record.html, site.css, site.js, icon.svg, rank.html, rank-core.js, rank-explorer.js, rank-worker.js, rank-tiers-view.js.
   dhlottery·폰트 등 교차 출처는 절대 가로채지 않는다(respondWith 안 함).
   200 이 아닌 응답은 캐시하지 않는다. skipWaiting + clients.claim 으로 즉시 갱신. */
"use strict";

var CACHE_NAME = 'll-v2';
var NETWORK_TIMEOUT_MS = 3500;
var PRECACHE = ['./brief.html', './record.html', './site.css', './site.js', './icon.svg',
  './rank.html', './rank-core.js', './rank-explorer.js', './rank-worker.js', './rank-tiers-view.js'];

self.addEventListener('install', function(event){
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(function(cache){
      // addAll 은 하나라도 실패하면 전체가 실패하므로, 개별 add 로 넣고 실패는 무시한다
      // (예: 이 시점에 record.html 이 아직 배포되지 않았을 수 있음).
      return Promise.all(PRECACHE.map(function(url){
        return cache.add(url).catch(function(){ /* 없으면 그냥 건너뜀 */ });
      }));
    })
  );
});

self.addEventListener('activate', function(event){
  event.waitUntil(
    caches.keys().then(function(names){
      return Promise.all(names.map(function(name){
        if(name !== CACHE_NAME) return caches.delete(name);
      }));
    }).then(function(){ return self.clients.claim(); })
  );
});

function timeoutPromise(ms){
  return new Promise(function(_, reject){
    setTimeout(function(){ reject(new Error('network-timeout')); }, ms);
  });
}

function networkFirst(request){
  var cache;
  return caches.open(CACHE_NAME).then(function(c){
    cache = c;
    return Promise.race([fetch(request), timeoutPromise(NETWORK_TIMEOUT_MS)]);
  }).then(function(res){
    if(res && res.status === 200 && res.type === 'basic'){
      cache.put(request, res.clone());
    }
    return res;
  }).catch(function(){
    return cache.match(request).then(function(hit){
      if(hit) return hit;
      throw new Error('offline-no-cache');
    });
  });
}

self.addEventListener('fetch', function(event){
  var req = event.request;
  if(req.method !== 'GET') return;                         // GET 이외는 손대지 않음

  var url;
  try{ url = new URL(req.url); }catch(e){ return; }
  if(url.origin !== self.location.origin) return;           // 교차 출처는 절대 respondWith 안 함(dhlottery, 폰트 등)

  event.respondWith(networkFirst(req));
});
