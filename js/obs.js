// obs.js
const MAP_BASE_WIDTH = 1203.3;
const MAP_BASE_HEIGHT = 800;

let timelineData = [ [] ];
let currentStepIndex = 0;
let myTeamSide = 'blue';
let zoomLevel = 1.0;
let champIconSize = 40;
let currentVersion = "14.5.1"; // 기본값 (메시지 수신 시 업데이트됨)
let lastViewport = {
    mapCenterX: MAP_BASE_WIDTH / 2,
    mapCenterY: MAP_BASE_HEIGHT / 2
};

let currentMode = 'map';
let selectedScreenshotId = null;
let screenshots = [];

const mapEl = document.getElementById('rift-map');
const svgLayer = document.getElementById('svg-layer');
const structureLayer = document.getElementById('structure-layer');
const obsMousePointer = document.getElementById('obs-mouse-pointer');

// --- 1. 통신 리스너 설정 ---

// BroadcastChannel 리스너
const obsChannel = new BroadcastChannel('lol_board_obs');
obsChannel.onmessage = (e) => {
    handleMessage(e.data);
};

// WebSocket 리스너 및 자동 재연결
let ws = null;
let wsRetryCount = 0;
const MAX_WS_RETRIES = 5;

function connectWebSocket() {
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
    };

    ws.onmessage = (e) => {
        try {
            const data = JSON.parse(e.data);
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
    if (!data) return;

    if (data.type === 'sync-scene') {
        timelineData = data.timelineData || [ [] ];
        currentStepIndex = data.currentStepIndex || 0;
        myTeamSide = data.myTeamSide || 'blue';
        zoomLevel = data.zoomLevel || 1.0;
        champIconSize = data.champIconSize || 40;
        if (data.currentVersion) {
            currentVersion = data.currentVersion;
        }
        if (data.viewport) {
            lastViewport = data.viewport;
        }
        if (data.currentMode) {
            currentMode = data.currentMode;
        }
        if (data.selectedScreenshotId !== undefined) {
            selectedScreenshotId = data.selectedScreenshotId;
        }
        if (data.screenshots) {
            screenshots = data.screenshots;
        }
        
        applyZoom();
        applyAppMode();
        renderScene();
    } else if (data.type === 'sync-viewport') {
        console.log("[OBS 수신] sync-viewport:", data.viewport);
        zoomLevel = data.zoomLevel || 1.0;
        if (data.viewport) {
            lastViewport = data.viewport;
        }
        applyZoom();
    } else if (data.type === 'mouse-move') {
        if (obsMousePointer) {
            // 마우스 커서 위치 업데이트
            obsMousePointer.style.left = data.x + "px";
            obsMousePointer.style.top = data.y + "px";
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
        
        console.log("[OBS 정렬 적용] centerX:", centerX, "centerY:", centerY, "leftOffset:", leftOffset, "topOffset:", topOffset);
        
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
    renderObjects();
    renderArrows();
    renderStrokes();
    renderStructures();
}

function renderObjects() {
    const currentObjs = timelineData[currentStepIndex];
    const allDoms = Array.from(mapEl.querySelectorAll('.placed-object, .arrow-control.start'));
    
    // 삭제된 오브젝트 정리
    allDoms.forEach(el => {
        const uid = el.id.replace('start_', '');
        if (!currentObjs.find(o => o.uid === uid)) el.remove();
    });

    currentObjs.forEach(obj => {
        if (obj.type === 'champion') renderDOM(obj, 'placed-object placed-champion');
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

function renderDOM(obj, className) {
    let el = document.getElementById(obj.uid);
    
    if (!el) {
        el = document.createElement(obj.type === 'champion' ? 'div' : 'img');
        el.id = obj.uid;
        el.className = className;
        el.draggable = false;
        if(obj.type === 'champion') {
            if (obj.champId && obj.champId !== "Poro") {
                const imgUrl = obj.champId === "Locke" ? "images/Locke.png" : `https://ddragon.leagueoflegends.com/cdn/${currentVersion}/img/champion/${obj.champId}.png`;
                el.style.backgroundImage = `url(${imgUrl})`;
                el.style.backgroundSize = 'cover';
            } else {
                el.style.backgroundColor = '#ccc';
            }
        } else {
            el.src = obj.src;
        }
        mapEl.appendChild(el);
    }

    // 크기 설정
    const baseSize = obj.type === 'champion' ? champIconSize : (obj.type === 'minion' ? 44 : 32);
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
    const arrowObjs = currentObjs.filter(o => (o.arrow && o.arrow.hasArrow) || o.type === 'free_arrow');
    const activeArrowUids = arrowObjs.map(o => o.uid);
    svgLayer.querySelectorAll('g.arrow-group').forEach(g => {
        const uid = g.getAttribute('data-uid');
        if (uid && !activeArrowUids.includes(uid)) g.remove();
    });

    // 2) 화살표 그리기
    arrowObjs.forEach(obj => {
        let dx, dy, startX, startY;
        if (obj.type === 'free_arrow') {
            dx = obj.arrow.dx;
            dy = obj.arrow.dy;
            startX = obj.x;
            startY = obj.y;
        } else {
            dx = obj.arrow.dx;
            dy = obj.arrow.dy;
            const baseSize = obj.type === 'champion' ? champIconSize : (obj.type === 'minion' ? 44 : 32);
            startX = obj.x + baseSize / 2;
            startY = obj.y + baseSize / 2;
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
    let d = `M ${points[0].x} ${points[0].y}`;
    for (let i = 1; i < points.length; i++) {
        d += ` L ${points[i].x} ${points[i].y}`;
    }
    return d;
}

function renderStrokes() {
    const currentObjs = timelineData[currentStepIndex] || [];
    const strokeObjs = currentObjs.filter(o => o.type === 'pen_stroke');
    const activeStrokeUids = strokeObjs.map(o => o.uid);
    
    svgLayer.querySelectorAll('path').forEach(p => {
        const uid = p.getAttribute('data-uid');
        if (uid && !activeStrokeUids.includes(uid)) p.remove();
    });
    
    strokeObjs.forEach(obj => {
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
    structureLayer.innerHTML = '';
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
        
        const img = document.createElement('img');
        img.className = 'map-structure';
        if (isDestroyed) {
            img.classList.add('destroyed');
        }
        img.src = icons[st.team][st.type];
        img.style.left = (st.x + offsetX) + 'px';
        img.style.top = st.y + 'px';
        const size = st.type === 'nexus' ? 50 : st.type === 'inhib' ? 36 : 26;
        img.style.width = size + 'px';
        img.style.height = size + 'px';
        
        structureLayer.appendChild(img);
    });
}

function applyAppMode() {
    if (currentMode === 'map') {
        if (structureLayer) structureLayer.style.display = 'block';
        if (mapEl) {
            mapEl.style.backgroundImage = "url(images/Summoner's_Rift_map_s14.png)";
            mapEl.style.backgroundColor = 'transparent';
        }
    } else {
        if (structureLayer) structureLayer.style.display = 'none';
        const activeScr = screenshots.find(s => s.id === selectedScreenshotId);
        if (activeScr && mapEl) {
            mapEl.style.backgroundImage = `url(${activeScr.dataUrl})`;
            mapEl.style.backgroundColor = '#0f0f0f';
        } else {
            if (mapEl) {
                mapEl.style.backgroundImage = 'none';
                mapEl.style.backgroundColor = '#0f0f0f';
            }
        }
    }
}
