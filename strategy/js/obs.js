// obs.js
const MAP_BASE_WIDTH = 1203.3;
const MAP_BASE_HEIGHT = 800;

let timelineData = [ [] ];
let currentStepIndex = 0;
let myTeamSide = 'blue';
let bluePreset = [];
let redPreset = [];
let zoomLevel = 1.0;
let champIconSize = 40;
let minionIconSize = 60;
let objectIconSize = 32;
let currentVersion = "14.5.1"; // 기본값 (메시지 수신 시 업데이트됨)
let lastViewport = {
    mapCenterX: MAP_BASE_WIDTH / 2,
    mapCenterY: MAP_BASE_HEIGHT / 2
};

let currentMode = 'map';
let selectedScreenshotId = null;
let activeScreenshotDataUrl = null;
let showGhostChampions = true;

const mapEl = document.getElementById('rift-map');
const svgLayer = document.getElementById('svg-layer');
const structureLayer = document.getElementById('structure-layer');
const obsMousePointer = document.getElementById('obs-mouse-pointer');

// 🛡️ OBS 수신 데이터 정화(Sanitize): BroadcastChannel/WebSocket 인젝션 및 DOM 하이재킹 방어
const MAX_OBS_MSG_CHARS = 5 * 1024 * 1024;
const SAFE_OBS_IMG_HOSTS = ['ddragon.leagueoflegends.com', 'raw.communitydragon.org'];
const SAFE_OBS_TYPES = ['champion', 'minion', 'ward', 'ping', 'object', 'pen_stroke', 'free_arrow', 'structure_destroyed'];
const SAFE_OBJ_UID_RE = /^(champ|minion|ward|ping|object|obj|monster|stroke|arrow|imp)_[A-Za-z0-9_-]{1,70}$/;
const SAFE_UID_RE = /^[A-Za-z0-9_-]{1,80}$/;
const SAFE_CHAMP_ID_RE = /^[A-Za-z0-9]{1,40}$/;
const SAFE_COLOR_RE = /^#[0-9a-fA-F]{3,8}$/;
const SAFE_VERSION_RE = /^[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}$/;
const SAFE_LOCAL_IMG_RE = /^images\/[A-Za-z0-9_.' -]{1,80}\.(png|jpg|jpeg|webp|gif)$/;
const SAFE_DATA_IMAGE_RE = /^data:image\/(png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/=]+$/;
const OBS_UID_TYPE_PREFIX = {
    champion: 'champ',
    minion: 'minion',
    ward: 'ward',
    ping: 'ping',
    object: 'object',
    pen_stroke: 'stroke',
    free_arrow: 'arrow'
};

function safeObsJsonParse(jsonStr) {
    return JSON.parse(jsonStr, (key, value) => {
        if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
            return undefined;
        }
        return value;
    });
}

function sanitizeObsDataUrl(url) {
    if (typeof url !== 'string') return '';
    const trimmed = url.trim();
    const match = trimmed.match(/^(data:image\/(?:png|jpeg|jpg|webp|gif);base64,)([\s\S]+)$/i);
    if (!match) return '';
    const cleaned = match[1].toLowerCase() + match[2].replace(/\s+/g, '');
    return SAFE_DATA_IMAGE_RE.test(cleaned) ? cleaned : '';
}

function sanitizeObsSrc(src) {
    if (typeof src !== 'string') return '';
    const s = src.trim();
    if (SAFE_LOCAL_IMG_RE.test(s)) return s;
    const safeData = sanitizeObsDataUrl(s);
    if (safeData) return safeData;
    try {
        const u = new URL(s);
        if (u.protocol === 'https:' && SAFE_OBS_IMG_HOSTS.includes(u.hostname)) return u.href;
    } catch (e) {}
    return '';
}

function sanitizeObsNum(v, min, max, fallback) {
    const n = Number(v);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, n));
}

function sanitizeObsVersion(ver) {
    return (typeof ver === 'string' && SAFE_VERSION_RE.test(ver)) ? ver : '14.5.1';
}

function sanitizeObsChampList(arr) {
    return (Array.isArray(arr) ? arr : [])
        .filter(k => typeof k === 'string' && SAFE_CHAMP_ID_RE.test(k))
        .slice(0, 5);
}

function getObsPlacedObjectEl(uid) {
    if (typeof uid !== 'string' || !SAFE_OBJ_UID_RE.test(uid)) return null;
    const el = document.getElementById(uid);
    if (!el || el.parentElement !== mapEl || !el.classList.contains('placed-object')) return null;
    return el;
}

function sanitizeObsTimeline(timeline) {
    const steps = Array.isArray(timeline) ? timeline.slice(0, 200) : [[]];
    const uidMap = new Map();
    const mapUid = (rawUid, typePrefix) => {
        const key = String(rawUid);
        if (uidMap.has(key)) return uidMap.get(key);
        const safePrefix = OBS_UID_TYPE_PREFIX[typePrefix] || 'imp';
        const safe = SAFE_OBJ_UID_RE.test(key)
            ? key
            : `${safePrefix}_imp_${Date.now().toString(36)}_${Math.random().toString(36).substr(2, 6)}_${uidMap.size}`;
        uidMap.set(key, safe);
        return safe;
    };

    const result = steps.map(step => {
        if (!Array.isArray(step)) return [];
        const out = [];
        step.slice(0, 2000).forEach(o => {
            if (!o || typeof o !== 'object' || !SAFE_OBS_TYPES.includes(o.type)) return;

            if (o.type === 'structure_destroyed') {
                if (typeof o.uid === 'string' && /^struct_\d{1,3}$/.test(o.uid)) {
                    out.push({ type: 'structure_destroyed', uid: o.uid });
                }
                return;
            }

            const clean = { type: o.type, uid: mapUid(o.uid, o.type) };
            clean.x = sanitizeObsNum(o.x, -5000, 5000, 0);
            clean.y = sanitizeObsNum(o.y, -5000, 5000, 0);

            if (o.arrow && typeof o.arrow === 'object') {
                clean.arrow = {
                    hasArrow: Boolean(o.arrow.hasArrow),
                    dx: sanitizeObsNum(o.arrow.dx, -5000, 5000, 0),
                    dy: sanitizeObsNum(o.arrow.dy, -5000, 5000, 0)
                };
            }
            if (o.dimmed) clean.dimmed = true;

            if (o.type === 'champion') {
                clean.champId = (typeof o.champId === 'string' && SAFE_CHAMP_ID_RE.test(o.champId)) ? o.champId : 'Poro';
                if (o.team === 'blue' || o.team === 'red' || o.team === 'none') clean.team = o.team;
            } else if (o.type === 'pen_stroke') {
                clean.color = (typeof o.color === 'string' && SAFE_COLOR_RE.test(o.color)) ? o.color : '#ff5252';
                clean.width = sanitizeObsNum(o.width, 1, 40, 4);
                clean.points = (Array.isArray(o.points) ? o.points.slice(0, 5000) : [])
                    .filter(p => p && typeof p === 'object')
                    .map(p => ({ x: sanitizeObsNum(p.x, -5000, 5000, 0), y: sanitizeObsNum(p.y, -5000, 5000, 0) }));
                delete clean.arrow;
            } else if (o.type === 'free_arrow') {
                if (!clean.arrow) clean.arrow = { hasArrow: true, dx: 0, dy: 0 };
            } else {
                clean.src = sanitizeObsSrc(o.src);
                if (o.type === 'minion') {
                    clean.minionType = o.minionType === 'minion-red' ? 'minion-red' : 'minion-blue';
                }
            }
            out.push(clean);
        });
        return out;
    });
    return result.length > 0 ? result : [[]];
}

// --- 1. 통신 리스너 설정 ---

// BroadcastChannel 리스너
const obsChannel = new BroadcastChannel('lol_board_obs');
obsChannel.onmessage = (e) => {
    handleMessage(e.data);
};
obsChannel.postMessage({ type: 'request-sync' });

// WebSocket 리스너 및 자동 재연결
let ws = null;
let wsRetryCount = 0;
const MAX_WS_RETRIES = 5;

function connectWebSocket() {
    if (!window.location.host || window.location.protocol === 'file:' || window.location.hostname.endsWith('.github.io')) {
        return;
    }
    if (wsRetryCount >= MAX_WS_RETRIES) {
        console.warn(`[안내] OBS Viewer WebSocket 연결 시도를 ${MAX_WS_RETRIES}회 실패하여 재연결을 중단합니다. 정적 웹페이지(GitHub Pages 등) 환경에서는 동일 브라우저 내 탭 간 동기화(BroadcastChannel)만 원활히 작동합니다.`);
        return;
    }

    const wsProto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${wsProto}//${window.location.host}`;
    ws = new WebSocket(wsUrl);

    ws.onopen = () => {
        console.log("OBS Viewer WebSocket 연결 성공");
        wsRetryCount = 0;
        ws.send(JSON.stringify({ type: 'request-sync' }));
    };

    ws.onmessage = (e) => {
        try {
            if (typeof e.data !== 'string' || e.data.length > MAX_OBS_MSG_CHARS) return;
            const data = safeObsJsonParse(e.data);
            handleMessage(data);
        } catch (err) {
            console.error("웹소켓 메시지 파싱 에러:", err);
        }
    };

    ws.onclose = () => {
        wsRetryCount++;
        if (wsRetryCount < MAX_WS_RETRIES) {
            console.log(`OBS Viewer WebSocket 연결 끊김 (${wsRetryCount}/${MAX_WS_RETRIES}). 3초 후 재연결 시도...`);
            setTimeout(connectWebSocket, 3000);
        } else {
            console.warn(`[안내] OBS Viewer WebSocket 연결 시도를 ${MAX_WS_RETRIES}회 실패하여 재연결을 중단합니다. 정적 웹페이지(GitHub Pages 등) 환경에서는 동일 브라우저 내 탭 간 동기화(BroadcastChannel)만 원활히 작동합니다.`);
        }
    };

    ws.onerror = (err) => {
        console.log("OBS Viewer WebSocket 연결 에러 (서버 미구동 또는 정적 호스팅 환경일 수 있습니다.)");
    };
}
connectWebSocket();

// 메시지 통합 핸들러
function handleMessage(data) {
    if (!data || typeof data !== 'object') return;

    if (data.type === 'sync-scene') {
        timelineData = sanitizeObsTimeline(data.timelineData);
        currentStepIndex = Math.max(0, Math.min(Math.floor(sanitizeObsNum(data.currentStepIndex, 0, 1000, 0)), timelineData.length - 1));
        myTeamSide = data.myTeamSide === 'red' ? 'red' : 'blue';
        if (Array.isArray(data.bluePreset)) bluePreset = sanitizeObsChampList(data.bluePreset);
        if (Array.isArray(data.redPreset)) redPreset = sanitizeObsChampList(data.redPreset);
        zoomLevel = sanitizeObsNum(data.zoomLevel, 0.3, 4.0, 1.0);
        champIconSize = sanitizeObsNum(data.champIconSize, 8, 200, 40);
        minionIconSize = sanitizeObsNum(data.minionIconSize, 8, 240, 60);
        objectIconSize = sanitizeObsNum(data.objectIconSize, 8, 200, 32);
        if (data.currentVersion) {
            currentVersion = sanitizeObsVersion(data.currentVersion);
        }
        if (data.viewport && typeof data.viewport === 'object') {
            lastViewport = {
                mapCenterX: sanitizeObsNum(data.viewport.mapCenterX, -5000, 5000, MAP_BASE_WIDTH / 2),
                mapCenterY: sanitizeObsNum(data.viewport.mapCenterY, -5000, 5000, MAP_BASE_HEIGHT / 2)
            };
        }
        if (data.currentMode) {
            currentMode = data.currentMode === 'screenshot' ? 'screenshot' : 'map';
        }
        if (data.selectedScreenshotId !== undefined) {
            selectedScreenshotId = (typeof data.selectedScreenshotId === 'string' && SAFE_UID_RE.test(data.selectedScreenshotId))
                ? data.selectedScreenshotId
                : null;
        }
        if (data.activeScreenshotDataUrl !== undefined) {
            activeScreenshotDataUrl = data.activeScreenshotDataUrl ? (sanitizeObsDataUrl(data.activeScreenshotDataUrl) || null) : null;
        }
        if (data.showGhostChampions !== undefined) {
            showGhostChampions = Boolean(data.showGhostChampions);
        }
        
        applyZoom();
        applyAppMode();
        renderScene();
    } else if (data.type === 'sync-viewport') {
        zoomLevel = sanitizeObsNum(data.zoomLevel, 0.3, 4.0, 1.0);
        if (data.viewport && typeof data.viewport === 'object') {
            lastViewport = {
                mapCenterX: sanitizeObsNum(data.viewport.mapCenterX, -5000, 5000, MAP_BASE_WIDTH / 2),
                mapCenterY: sanitizeObsNum(data.viewport.mapCenterY, -5000, 5000, MAP_BASE_HEIGHT / 2)
            };
        }
        applyZoom();
    } else if (data.type === 'mouse-move') {
        const safeX = sanitizeObsNum(data.x, -5000, 5000, null);
        const safeY = sanitizeObsNum(data.y, -5000, 5000, null);
        if (obsMousePointer && safeX !== null && safeY !== null) {
            // 마우스 커서 위치 업데이트
            obsMousePointer.style.left = safeX + "px";
            obsMousePointer.style.top = safeY + "px";
            obsMousePointer.classList.add('active');
        }
    } else if (data.type === 'mouse-leave') {
        if (obsMousePointer) {
            obsMousePointer.classList.remove('active');
        }
    }
}

function applyZoom() {
    const container = document.getElementById('zoom-container');
    if (container && mapEl) {
        container.style.width = (MAP_BASE_WIDTH * zoomLevel) + "px";
        container.style.height = (MAP_BASE_HEIGHT * zoomLevel) + "px";
        
        mapEl.style.transform = `scale(${zoomLevel})`;
        mapEl.style.transformOrigin = `0 0`;
        
        const obsContainer = document.getElementById('obs-container');
        const obsWidth = (obsContainer && obsContainer.clientWidth) || window.innerWidth;
        const obsHeight = (obsContainer && obsContainer.clientHeight) || window.innerHeight;
        
        const centerX = lastViewport.mapCenterX;
        const centerY = lastViewport.mapCenterY;
        
        // OBS 뷰어의 중앙에 해당 중심 좌표가 오도록 left, top 연산
        const leftOffset = obsWidth / 2 - (centerX * zoomLevel);
        const topOffset = obsHeight / 2 - (centerY * zoomLevel);
        
        container.style.position = 'absolute';
        container.style.left = leftOffset + 'px';
        container.style.top = topOffset + 'px';
        container.style.margin = '0';
    }
}

window.addEventListener('resize', () => {
    applyZoom();
});

// --- 2. 렌더러 구현 (app.js의 렌더러 경량화) ---

function renderScene() {
    if (!timelineData[currentStepIndex]) {
        timelineData[currentStepIndex] = [];
    }
    if (typeof applyIconBorderCssVars === 'function') {
        applyIconBorderCssVars(mapEl, champIconSize, objectIconSize);
    }
    renderObjects();
    renderGhosts();
    renderArrows();
    renderStrokes();
    renderStructures();
}

function resolveChampionTeam(obj) {
    if (!obj) return null;
    if (obj.team === 'none') return null;
    if (obj.team === 'blue' || obj.team === 'red') return obj.team;
    if (bluePreset.includes(obj.champId)) return 'blue';
    if (redPreset.includes(obj.champId)) return 'red';
    return null;
}

function renderObjects() {
    const currentObjs = timelineData[currentStepIndex];
    const allDoms = Array.from(mapEl.querySelectorAll('.placed-object:not(.ghost-champion), .arrow-control.start'));
    
    // 삭제된 오브젝트 정리
    allDoms.forEach(el => {
        const uid = el.id.replace('start_', '');
        if (!currentObjs.find(o => o.uid === uid)) el.remove();
    });

    currentObjs.forEach(obj => {
        if (obj.type === 'champion') {
            const effectiveTeam = resolveChampionTeam(obj);
            const teamClass = effectiveTeam ? `team-${effectiveTeam}` : '';
            renderDOM(obj, `placed-object placed-champion ${teamClass}`.trim());
        }
        else if (obj.type === 'minion') {
            let shouldFlip = false;
            if (myTeamSide === 'blue') {
                shouldFlip = (obj.minionType === 'minion-blue');
            } else {
                shouldFlip = (obj.minionType === 'minion-red');
            }
            const dirClass = shouldFlip ? 'flip-dir' : '';
            const teamColorClass = obj.minionType === 'minion-red' ? 'minion-red-glow' : 'minion-blue-glow';
            renderDOM(obj, `placed-object placed-minion ${teamColorClass} ${dirClass}`);
        }
        else if (obj.type === 'ping' || obj.type === 'ward' || obj.type === 'object') {
            renderDOM(obj, 'placed-object placed-icon');
        }
        else if (obj.type === 'free_arrow') {
            renderStartCtrl(obj);
        }
    });
}

function renderGhosts() {
    mapEl.querySelectorAll('.ghost-champion').forEach(el => el.remove());
    svgLayer.querySelectorAll('line.ghost-line').forEach(el => el.remove());

    if (!showGhostChampions || currentStepIndex <= 0) return;

    const prevObjs = timelineData[currentStepIndex - 1] || [];
    const currentObjs = timelineData[currentStepIndex] || [];

    currentObjs.forEach(obj => {
        if (obj.type !== 'champion') return;
        const prevObj = prevObjs.find(p => p.type === 'champion' && p.uid === obj.uid);
        if (!prevObj) return;

        const dist = Math.hypot(obj.x - prevObj.x, obj.y - prevObj.y);
        if (dist <= 5) return;

        const effectiveTeam = resolveChampionTeam(obj);

        // 1. 이동 궤적 점선
        const ghostLine = document.createElementNS("http://www.w3.org/2000/svg", "line");
        ghostLine.setAttribute("class", "ghost-line");
        ghostLine.setAttribute("data-ghost-uid", obj.uid);
        ghostLine.setAttribute("x1", prevObj.x);
        ghostLine.setAttribute("y1", prevObj.y);
        ghostLine.setAttribute("x2", obj.x);
        ghostLine.setAttribute("y2", obj.y);
        const lineColor = effectiveTeam === 'blue' ? 'rgba(0, 176, 255, 0.7)' : (effectiveTeam === 'red' ? 'rgba(255, 61, 61, 0.7)' : 'rgba(255, 255, 255, 0.5)');
        ghostLine.setAttribute("stroke", lineColor);
        ghostLine.setAttribute("stroke-width", "2.5");
        ghostLine.setAttribute("stroke-dasharray", "5,5");
        ghostLine.setAttribute("stroke-linecap", "round");
        svgLayer.insertBefore(ghostLine, svgLayer.firstChild);

        // 2. 이전 위치 반투명 잔상 아이콘
        const ghostEl = document.createElement('div');
        const teamClass = effectiveTeam ? `team-${effectiveTeam}` : '';
        ghostEl.className = `placed-object placed-champion ghost-champion ${teamClass}`.trim();
        ghostEl.setAttribute('data-ghost-uid', obj.uid);
        if (obj.champId && obj.champId !== "Poro" && SAFE_CHAMP_ID_RE.test(obj.champId)) {
            const safeVer = sanitizeObsVersion(currentVersion);
            const imgUrl = obj.champId === "Locke" ? "images/Locke.png" : `https://ddragon.leagueoflegends.com/cdn/${safeVer}/img/champion/${obj.champId}.png`;
            ghostEl.style.backgroundImage = `url("${imgUrl}")`;
            ghostEl.style.backgroundSize = 'cover';
        } else {
            ghostEl.style.backgroundColor = '#ccc';
        }
        ghostEl.style.width = champIconSize + "px";
        ghostEl.style.height = champIconSize + "px";
        ghostEl.style.left = prevObj.x + "px";
        ghostEl.style.top = prevObj.y + "px";
        mapEl.appendChild(ghostEl);
    });
}

function renderDOM(obj, className) {
    if (!obj || typeof obj.uid !== 'string' || !SAFE_OBJ_UID_RE.test(obj.uid)) return;
    let el = getObsPlacedObjectEl(obj.uid);
    const safeVer = sanitizeObsVersion(currentVersion);
    const safeChampId = (typeof obj.champId === 'string' && SAFE_CHAMP_ID_RE.test(obj.champId)) ? obj.champId : 'Poro';
    const desiredSrc = obj.type === 'champion'
        ? (safeChampId !== "Poro"
            ? (safeChampId === "Locke"
                ? "images/Locke.png"
                : `https://ddragon.leagueoflegends.com/cdn/${safeVer}/img/champion/${safeChampId}.png`)
            : "__poro__")
        : sanitizeObsSrc(obj.src || "");

    if (!el) {
        el = document.createElement(obj.type === 'champion' ? 'div' : 'img');
        el.id = obj.uid;
        el.className = className;
        el.draggable = false;
        mapEl.appendChild(el);
    }

    if (el.dataset.renderSrc !== desiredSrc) {
        el.dataset.renderSrc = desiredSrc;
        if (obj.type === 'champion') {
            if (desiredSrc !== "__poro__") {
                el.style.backgroundImage = `url("${desiredSrc}")`;
                el.style.backgroundSize = 'cover';
                el.style.backgroundColor = '#000';
            } else {
                el.style.backgroundImage = 'none';
                el.style.backgroundColor = '#ccc';
            }
        } else {
            el.src = desiredSrc;
        }
    }

    if (obj.type === 'champion') {
        const effectiveTeam = resolveChampionTeam(obj);
        el.classList.toggle('team-blue', effectiveTeam === 'blue');
        el.classList.toggle('team-red', effectiveTeam === 'red');
    }

    if (obj.type === 'minion') {
        const shouldFlip = myTeamSide === 'blue'
            ? (obj.minionType === 'minion-blue')
            : (obj.minionType === 'minion-red');
        el.classList.toggle('flip-dir', shouldFlip);
        el.classList.toggle('minion-red-glow', obj.minionType === 'minion-red');
        el.classList.toggle('minion-blue-glow', obj.minionType !== 'minion-red');
    }

    el.classList.toggle('dimmed', Boolean(obj.dimmed));

    // 크기 설정
    const baseSize = obj.type === 'champion'
        ? champIconSize
        : (obj.type === 'minion' ? minionIconSize : objectIconSize);
    el.style.width = baseSize + "px";
    el.style.height = baseSize + "px";

    // 위치 설정
    el.style.left = obj.x + "px";
    el.style.top = obj.y + "px";
}

function renderStartCtrl(obj) {
    const id = `start_${obj.uid}`;
    let el = document.getElementById(id);
    if(!el) {
        el = document.createElement('div');
        el.id = id;
        el.className = 'arrow-control start';
        el.style.display = 'none'; // OBS 뷰어에서는 시작 컨트롤링 숨김
        mapEl.appendChild(el);
    }
}

function renderArrows() {
    const currentObjs = timelineData[currentStepIndex] || [];
    
    // 1) 기존 화살표 중 삭제된 것 정리
    const arrowObjs = currentObjs.filter(o => o.arrow && o.arrow.hasArrow);
    const activeArrowUids = arrowObjs.map(o => o.uid);
    svgLayer.querySelectorAll('g.arrow-group').forEach(g => {
        const uid = g.getAttribute('data-uid');
        if (uid && !activeArrowUids.includes(uid)) g.remove();
    });

    // 2) 화살표 그리기
    arrowObjs.forEach(obj => {
        if (!obj || typeof obj.uid !== 'string' || !SAFE_OBJ_UID_RE.test(obj.uid)) return;
        let dx, dy, startX, startY;
        if (obj.type === 'free_arrow') {
            dx = obj.arrow.dx;
            dy = obj.arrow.dy;
            startX = obj.x;
            startY = obj.y;
        } else {
            dx = obj.arrow.dx;
            dy = obj.arrow.dy;
            startX = obj.x;
            startY = obj.y;
        }

        let g = svgLayer.querySelector(`g.arrow-group[data-uid="${obj.uid}"]`);
        if (!g) {
            g = document.createElementNS("http://www.w3.org/2000/svg", "g");
            g.setAttribute("class", "arrow-group");
            g.setAttribute("data-uid", obj.uid);

            const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
            line.setAttribute("stroke", "#ff5252");
            line.setAttribute("stroke-width", "4");
            line.setAttribute("marker-end", "url(#arrowhead)");
            g.appendChild(line);

            svgLayer.appendChild(g);
        }

        const line = g.querySelector('line');
        if (line) {
            line.setAttribute("x1", startX);
            line.setAttribute("y1", startY);
            line.setAttribute("x2", startX + dx);
            line.setAttribute("y2", startY + dy);
        }
    });
}

function getSvgPathFromPoints(points) {
    if (!points || points.length === 0) return "";
    if (points.length === 1) {
        return `M ${points[0].x} ${points[0].y} L ${points[0].x} ${points[0].y}`;
    }
    let d = `M ${points[0].x} ${points[0].y}`;
    if (points.length === 2) {
        d += ` L ${points[1].x} ${points[1].y}`;
        return d;
    }
    
    d += ` L ${(points[0].x + points[1].x) / 2} ${(points[0].y + points[1].y) / 2}`;
    for (let i = 1; i < points.length - 1; i++) {
        const cp = points[i];
        const next = points[i + 1];
        const endX = (cp.x + next.x) / 2;
        const endY = (cp.y + next.y) / 2;
        d += ` Q ${cp.x} ${cp.y}, ${endX} ${endY}`;
    }
    d += ` L ${points[points.length - 1].x} ${points[points.length - 1].y}`;
    return d;
}

function renderStrokes() {
    const currentObjs = timelineData[currentStepIndex] || [];
    const strokeObjs = currentObjs.filter(o => o.type === 'pen_stroke');
    const activeStrokeUids = strokeObjs.map(o => o.uid);
    
    svgLayer.querySelectorAll('path[data-uid]').forEach(p => {
        const uid = p.getAttribute('data-uid');
        if (uid && !activeStrokeUids.includes(uid)) p.remove();
    });
    
    strokeObjs.forEach(obj => {
        if (!obj || typeof obj.uid !== 'string' || !SAFE_OBJ_UID_RE.test(obj.uid)) return;
        let path = svgLayer.querySelector(`path[data-uid="${obj.uid}"]`);
        if (!path) {
            path = document.createElementNS("http://www.w3.org/2000/svg", "path");
            path.setAttribute("data-uid", obj.uid);
            path.setAttribute("fill", "none");
            path.setAttribute("stroke-linecap", "round");
            path.setAttribute("stroke-linejoin", "round");
            svgLayer.appendChild(path);
        }
        
        const dString = getSvgPathFromPoints(obj.points);
        path.setAttribute("d", dString);
        path.setAttribute("stroke", obj.color);
        path.setAttribute("stroke-width", obj.width);
    });
}

function renderStructures() {
    const icons = {
        blue: {
            tower: 'https://raw.communitydragon.org/14.5/game/assets/characters/turret/hud/turret_blue_circle.png',
            inhib: 'https://raw.communitydragon.org/14.5/game/assets/characters/inhibitor/hud/inhibitor_blue_circle.png', 
            nexus: 'https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/map-assets/map11/icon-ex-blue.png'
        },
        red: {
            tower: 'https://raw.communitydragon.org/14.5/game/assets/characters/turret/hud/turret_red_circle.png',
            inhib: 'https://raw.communitydragon.org/14.5/game/assets/characters/inhibitor/hud/inhibitor_red_circle.png',
            nexus: 'https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default/v1/map-assets/map11/icon-ex-red.png'
        }
    };
    const offsetX = (MAP_BASE_WIDTH - MAP_BASE_HEIGHT) / 2; // 가로 정렬 오프셋
    const currentObjs = timelineData[currentStepIndex] || [];
    
    structures.forEach((st, idx) => {
        const structId = `struct_${idx}`;
        const isDestroyed = currentObjs.some(o => o.type === 'structure_destroyed' && o.uid === structId);
        
        let img = structureLayer.querySelector(`img[data-struct-id="${structId}"]`);
        if (!img) {
            img = document.createElement('img');
            img.className = 'map-structure';
            img.setAttribute('data-struct-id', structId);
            img.src = icons[st.team][st.type];
            img.style.left = (st.x + offsetX) + 'px';
            img.style.top = st.y + 'px';
            const size = st.type === 'nexus' ? 50 : st.type === 'inhib' ? 36 : 26;
            img.style.width = size + 'px';
            img.style.height = size + 'px';
            
            structureLayer.appendChild(img);
        }
        img.classList.toggle('destroyed', isDestroyed);
    });
}

function applyAppMode() {
    if (currentMode === 'map') {
        if (structureLayer) structureLayer.style.display = 'block';
        if (mapEl) {
            mapEl.style.backgroundImage = 'url("images/Summoner\'s_Rift_map_s14.png")';
            mapEl.style.backgroundColor = 'transparent';
        }
    } else {
        if (structureLayer) structureLayer.style.display = 'none';
        const safeBgUrl = activeScreenshotDataUrl ? sanitizeObsDataUrl(activeScreenshotDataUrl) : '';
        if (safeBgUrl && mapEl) {
            mapEl.style.backgroundImage = `url("${safeBgUrl}")`;
            mapEl.style.backgroundColor = '#0f0f0f';
        } else {
            if (mapEl) {
                mapEl.style.backgroundImage = 'none';
                mapEl.style.backgroundColor = '#0f0f0f';
            }
        }
    }
}
