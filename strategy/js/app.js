const MAP_BASE_WIDTH = 1203.3;
const MAP_BASE_HEIGHT = 800;

window.currentDragData = null;
let myTeamSide = 'blue';

let currentMode = 'map';
let selectedScreenshotId = null;
let showGhostChampions = true;

let currentVersion = "";
let championData = {};
let baseChampSize = 40;
let baseMinionSize = 60;
let baseObjectSize = 32;
let champIconSize = 40;
let minionIconSize = 60;
let objectIconSize = 32;
let isAutoSizeEnabled = true;
const ICON_SIZE_STORAGE_KEY = 'lol_strategy_icon_sizes';

function showToast(message) {
    let container = document.getElementById('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        document.body.appendChild(container);
    }
    const toast = document.createElement('div');
    toast.className = 'toast-msg';
    toast.innerText = message;
    container.appendChild(toast);

    requestAnimationFrame(() => {
        toast.classList.add('show');
    });

    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 220);
    }, 2000);
}

const obsChannel = new BroadcastChannel('lol_board_obs');
obsChannel.onmessage = (e) => {
    if (e.data && e.data.type === 'request-sync') {
        syncObsScene(true, true);
    }
};
let isSyncMouseEnabled = true;
let wsConnection = null;
let wsRetryCount = 0;
const MAX_WS_RETRIES = 5;

function initWebSocket() {
    if (wsRetryCount >= MAX_WS_RETRIES) {
        console.warn(`[안내] WebSocket 연결 시도를 ${MAX_WS_RETRIES}회 실패하여 재연결을 중단합니다. 정적 웹페이지(GitHub Pages 등) 환경에서는 동일 브라우저 내 탭 간 동기화(BroadcastChannel)만 원활히 작동합니다.`);
        return;
    }

    // 정적 호스팅(GitHub Pages) 및 로컬 file:// 환경에서는 WebSocket 연결 생략
    if (!window.location.host || window.location.protocol === 'file:' || window.location.hostname.endsWith('.github.io')) {
        console.log('[안내] 정적/로컬 파일 환경입니다. BroadcastChannel 탭 간 동기화로 동작합니다.');
        return;
    }

    try {
        const wsProto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${wsProto}//${window.location.host}`;
        wsConnection = new WebSocket(wsUrl);

        wsConnection.onopen = () => {
            console.log("WebSocket 연결 성공");
            wsRetryCount = 0;
            syncObsScene(true, true);
        };

        wsConnection.onmessage = (e) => {
            try {
                const data = JSON.parse(e.data);
                if (data && data.type === 'request-sync') {
                    syncObsScene(true, true);
                }
            } catch (err) {}
        };

        wsConnection.onclose = () => {
            wsRetryCount++;
            if (wsRetryCount < MAX_WS_RETRIES) {
                console.log(`WebSocket 연결 끊김 (${wsRetryCount}/${MAX_WS_RETRIES}). 3초 후 재연결 시도...`);
                setTimeout(initWebSocket, 3000);
            } else {
                console.warn(`[안내] WebSocket 연결 시도를 ${MAX_WS_RETRIES}회 실패하여 재연결을 중단합니다. 정적 웹페이지(GitHub Pages 등) 환경에서는 동일 브라우저 내 탭 간 동기화(BroadcastChannel)만 원활히 작동합니다.`);
            }
        };

        wsConnection.onerror = (err) => {
            console.log("WebSocket 연결 에러 (서버 미구동 또는 정적 호스팅 환경일 수 있습니다.)");
        };
    } catch (e) {
        console.log("WebSocket 생성 건너뜀 (정적 호스팅 환경):", e.message);
    }
}

function sendToObs(message) {
    if (typeof obsChannel !== 'undefined') {
        obsChannel.postMessage(message);
    }
    if (wsConnection && wsConnection.readyState === WebSocket.OPEN) {
        wsConnection.send(JSON.stringify(message));
    }
}

let timelineData = [ [] ]; 
let currentStepIndex = 0;
let selectedObjUid = null;
let selectedChampKey = null;
let bluePreset = [];
let redPreset = [];
let currentTacticId = null;
const TACTICS_STORAGE_KEY = 'lol_strategy_saved_tactics';
let contextTargetUid = null;
let draggedObj = null;
let draggedEl = null;
let dragType = null;
let draggedDistance = 0;

// Undo/Redo
let historyStack = [];
let historyPointer = -1;

const mapEl = document.getElementById('rift-map');
const svgLayer = document.getElementById('svg-layer');
const structureLayer = document.getElementById('structure-layer');
const contextMenu = document.getElementById('context-menu');

// Zoom & Panning 상태 정의
let zoomLevel = 1.0;
const MIN_ZOOM = 0.3;
const MAX_ZOOM = 4.0;

// 지정한 기준점(커서/핀치 중점)을 고정한 채 목표 줌 배율로 이동
function zoomToPoint(nextZoom, clientX, clientY) {
    const mapArea = document.getElementById('map-area');
    const rect = mapArea.getBoundingClientRect();

    // 기준점 상대 위치 계산 (지정되지 않은 경우 뷰포트 중앙 기준)
    const anchorX = clientX !== undefined ? (clientX - rect.left) : (rect.width / 2);
    const anchorY = clientY !== undefined ? (clientY - rect.top) : (rect.height / 2);

    // 줌 전의 맵 기준 기준점 절대 위치 (1:1 비율)
    const mapX = (anchorX + mapArea.scrollLeft) / zoomLevel;
    const mapY = (anchorY + mapArea.scrollTop) / zoomLevel;

    const clamped = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, nextZoom));
    if (clamped === zoomLevel) return;

    zoomLevel = clamped;
    applyZoom();

    // 줌 후의 새로운 스크롤 위치 보정 (기준점이 손가락/커서 아래 고정)
    mapArea.scrollLeft = mapX * zoomLevel - anchorX;
    mapArea.scrollTop = mapY * zoomLevel - anchorY;

    if (typeof syncObsViewport === 'function') {
        syncObsViewport();
    }
}

function adjustZoom(delta, clientX, clientY) {
    zoomToPoint(zoomLevel + delta, clientX, clientY);
}

function resetZoom() {
    zoomLevel = 1.0;
    applyZoom();
    const mapArea = document.getElementById('map-area');
    mapArea.scrollLeft = 0;
    mapArea.scrollTop = 0;
    
    if (typeof syncObsViewport === 'function') {
        syncObsViewport();
    }
}

function applyZoom() {
    const container = document.getElementById('zoom-container');
    
    container.style.width = (MAP_BASE_WIDTH * zoomLevel) + "px";
    container.style.height = (MAP_BASE_HEIGHT * zoomLevel) + "px";
    
    mapEl.style.transform = `scale(${zoomLevel})`;
    mapEl.style.transformOrigin = `0 0`;
    
    mapEl.style.marginLeft = "0px";
    mapEl.style.marginRight = "0px";
    mapEl.style.marginTop = "0px";
    mapEl.style.marginBottom = "0px";
    
    document.getElementById('zoom-indicator').innerText = `${Math.round(zoomLevel * 100)}%`;

    if (isAutoSizeEnabled) {
        applyAutoSize();
    }
}



async function init() {
    try {
        const verRes = await fetch('https://ddragon.leagueoflegends.com/api/versions.json');
        const versions = await verRes.json();
        currentVersion = versions[0];
        
        const champRes = await fetch(`https://ddragon.leagueoflegends.com/cdn/${currentVersion}/data/ko_KR/champion.json`);
        const champJson = await champRes.json();
        championData = champJson.data;
        championData["Locke"] = {
            name: "로크",
            id: "Locke",
            image: { full: "Locke.png" }
        };

        renderLeftSidebar();
        renderRightSidebar();
        renderStructures();
        
        recordHistory();
        renderScene();
        
        // Zoom & Panning 이벤트 바인딩
        bindZoomAndPanEvents();
        renderPresets();
        checkAndApplyImportedChampions();
        initWebSocket();

        // 맵 스크롤(패닝)이 발생할 때 실시간 뷰포트 동기화 송신
        document.getElementById('map-area').addEventListener('scroll', () => {
            syncObsViewport();
        });

        // 아이콘 크기 설정 로드 및 슬라이더 이벤트 바인딩 (3종 분리 + 배율 비례 스케일)
        loadIconSizeSettings();

        const sizeSlider = document.getElementById('size-slider');
        if (sizeSlider) {
            sizeSlider.value = baseChampSize;
            sizeSlider.addEventListener('input', (e) => {
                baseChampSize = parseInt(e.target.value, 10);
                saveIconSizeSettings();
                applyAutoSize();
            });
        }

        const minionSizeSlider = document.getElementById('minion-size-slider');
        if (minionSizeSlider) {
            minionSizeSlider.value = baseMinionSize;
            minionSizeSlider.addEventListener('input', (e) => {
                baseMinionSize = parseInt(e.target.value, 10);
                saveIconSizeSettings();
                applyAutoSize();
            });
        }

        const objectSizeSlider = document.getElementById('object-size-slider');
        if (objectSizeSlider) {
            objectSizeSlider.value = baseObjectSize;
            objectSizeSlider.addEventListener('input', (e) => {
                baseObjectSize = parseInt(e.target.value, 10);
                saveIconSizeSettings();
                applyAutoSize();
            });
        }

        // OBS 마우스 동기화 체크박스 이벤트 바인딩
        const syncMouseCheckbox = document.getElementById('sync-mouse-checkbox');
        if (syncMouseCheckbox) {
            syncMouseCheckbox.addEventListener('change', (e) => {
                isSyncMouseEnabled = e.target.checked;
                if (!isSyncMouseEnabled) {
                    sendToObs({ type: 'mouse-leave' });
                }
            });
        }

        // 자동 조절 체크박스 이벤트 바인딩 (슬라이더 잠금 없이 기준값 비례 스케일 적용)
        const autoSizeCheckbox = document.getElementById('auto-size-checkbox');
        if (autoSizeCheckbox) {
            autoSizeCheckbox.checked = isAutoSizeEnabled;
            autoSizeCheckbox.addEventListener('change', (e) => {
                isAutoSizeEnabled = e.target.checked;
                saveIconSizeSettings();
                applyAutoSize();
            });
        }
        applyAutoSize();

        // 전역 드래그 클린업 바인딩
        window.addEventListener('dragend', () => {
            window.currentDragData = null;
        });
        window.addEventListener('mouseup', () => {
            setTimeout(() => {
                window.currentDragData = null;
            }, 100);
        });

        // paste 이벤트 바인딩 및 스크린샷 렌더링 초기화
        document.addEventListener('paste', handleScreenshotPaste);
        const presetNameInput = document.getElementById('preset-name-input');
        if (presetNameInput) {
            presetNameInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    saveCurrentPreset();
                }
            });
        }
        renderScreenshots();
        renderTacticsUI();
        setAppMode('map'); // 기본 앱 모드는 맵 모드
    } catch (e) { console.error(e); }
}

function loadIconSizeSettings() {
    try {
        const raw = localStorage.getItem(ICON_SIZE_STORAGE_KEY);
        if (!raw) return;
        const saved = JSON.parse(raw);
        if (typeof saved.champ === 'number') baseChampSize = Math.max(16, Math.min(72, saved.champ));
        if (typeof saved.minion === 'number') baseMinionSize = Math.max(20, Math.min(120, saved.minion));
        if (typeof saved.object === 'number') baseObjectSize = Math.max(16, Math.min(80, saved.object));
        if (typeof saved.auto === 'boolean') isAutoSizeEnabled = saved.auto;
    } catch (e) {}
}

function saveIconSizeSettings() {
    try {
        localStorage.setItem(ICON_SIZE_STORAGE_KEY, JSON.stringify({
            champ: baseChampSize,
            minion: baseMinionSize,
            object: baseObjectSize,
            auto: isAutoSizeEnabled
        }));
    } catch (e) {}
}

function resetIconSizes() {
    baseChampSize = 40;
    baseMinionSize = 60;
    baseObjectSize = 32;

    const sizeSlider = document.getElementById('size-slider');
    if (sizeSlider) sizeSlider.value = baseChampSize;
    const minionSizeSlider = document.getElementById('minion-size-slider');
    if (minionSizeSlider) minionSizeSlider.value = baseMinionSize;
    const objectSizeSlider = document.getElementById('object-size-slider');
    if (objectSizeSlider) objectSizeSlider.value = baseObjectSize;

    saveIconSizeSettings();
    applyAutoSize();
    showToast('↺ 아이콘 크기가 기본값으로 초기화되었습니다.');
}

function applyAutoSize() {
    // 확대(zoomLevel > 1.0) 시 사용자 기준 크기에 비례 계수를 곱해 자연스럽게 축소 보정
    const scaleFactor = (isAutoSizeEnabled && zoomLevel > 1.0)
        ? Math.pow(zoomLevel, -0.65)
        : 1.0;

    champIconSize = Math.max(12, Math.round(baseChampSize * scaleFactor));
    minionIconSize = Math.max(16, Math.round(baseMinionSize * scaleFactor));
    objectIconSize = Math.max(12, Math.round(baseObjectSize * scaleFactor));

    // UI 인디케이터 업데이트 (슬라이더는 사용자 기준값을 그대로 유지)
    const sizeIndicator = document.getElementById('size-indicator');
    if (sizeIndicator) sizeIndicator.innerText = champIconSize + "px";

    const minionSizeIndicator = document.getElementById('minion-size-indicator');
    if (minionSizeIndicator) minionSizeIndicator.innerText = minionIconSize + "px";

    const objectSizeIndicator = document.getElementById('object-size-indicator');
    if (objectSizeIndicator) objectSizeIndicator.innerText = objectIconSize + "px";

    renderScene();
}

let isDrawing = false;
let currentDrawingArrow = null;
let currentDrawingStroke = null;
let activeTool = 'pen'; // 'pen', 'arrow', or 'eraser'
let currentPenColor = '#ff5252';
let currentPenWidth = 4;
let erasedSomething = false;

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

function bindZoomAndPanEvents() {
    if (window._zoomAndPanEventsBound) return;
    window._zoomAndPanEventsBound = true;
    
    const mapArea = document.getElementById('map-area');
    
    // 마우스 휠로 줌 조절
    mapArea.addEventListener('wheel', (e) => {
        e.preventDefault();
        const delta = e.deltaY < 0 ? 0.1 : -0.1;
        adjustZoom(delta, e.clientX, e.clientY);
    }, { passive: false });

    // 마우스 드래그 패닝(Panning), 화살표 그리기(Drawing) 및 커스텀 드래그
    let isPanning = false;
    let isPanningReady = false;
    let hasDraggedMoved = false;
    let startX, startY, scrollLeft, scrollTop;

    mapEl.addEventListener('mousedown', (e) => {
        // 커스텀 드래그 대상 식별
        const placedObjEl = e.target.closest('.placed-object');
        const arrowCtrlEl = e.target.closest('.arrow-control');

        // 마우스 왼쪽 클릭 시 (오브젝트 드래그 또는 화살표 그리기)
        if (e.button === 0) {
            if (placedObjEl) {
                e.preventDefault();
                e.stopPropagation();
                clearSelection();
                
                draggedEl = placedObjEl;
                draggedObj = placedObjEl._dataObj;
                dragType = 'object';
                hasDraggedMoved = false;
                
                selectedObjUid = draggedObj.uid;
                draggedEl.classList.add('selected');
                draggedEl.classList.add('dragging');
                
                // transition 제거하여 반응성 향상
                draggedEl.style.transition = 'none';
                const end = document.getElementById(`end_${draggedObj.uid}`);
                if(end) end.style.transition = 'none';
                return;
            }
            
            if (arrowCtrlEl) {
                e.preventDefault();
                e.stopPropagation();
                clearSelection();
                
                draggedEl = arrowCtrlEl;
                draggedObj = arrowCtrlEl._dataObj;
                dragType = arrowCtrlEl.classList.contains('start') ? 'arrow-start' : 'arrow-end';
                hasDraggedMoved = false;
                
                selectedObjUid = draggedObj.uid;
                draggedEl.classList.add('selected');
                draggedEl.classList.add('dragging');
                
                // transition 제거
                draggedEl.style.transition = 'none';
                const line = svgLayer.querySelector(`line[data-uid="${draggedObj.uid}"]`);
                if (line) line.style.transition = 'none';
                const start = document.getElementById(`start_${draggedObj.uid}`);
                if (start) start.style.transition = 'none';
                const end = document.getElementById(`end_${draggedObj.uid}`);
                if (end) end.style.transition = 'none';
                return;
            }

            // 빈 배경이면 그리기 또는 선택 모드 분기
            const isMapBg = e.target === mapArea || e.target === mapEl || e.target === structureLayer || e.target === svgLayer || e.target.tagName === 'path' || e.target.tagName === 'line' || e.target.closest('path') || e.target.closest('line');
            if (isMapBg) {
                if (activeTool === 'select') {
                    const isDrawableEl = e.target.tagName === 'path' || e.target.tagName === 'line' || e.target.closest('path') || e.target.closest('line');
                    if (!isDrawableEl) {
                        clearSelection();
                    }
                    return;
                }

                e.preventDefault();
                e.stopPropagation();
                clearSelection();
                
                const mapRect = mapEl.getBoundingClientRect();
                const borderOffset = 2 * zoomLevel;
                const x = (e.clientX - mapRect.left - borderOffset) / zoomLevel;
                const y = (e.clientY - mapRect.top - borderOffset) / zoomLevel;
                
                if (activeTool === 'eraser') {
                    isDrawing = true;
                    eraseAt(x, y);
                } else if (activeTool === 'arrow') {
                    isDrawing = true;
                    currentDrawingArrow = {
                        type: 'free_arrow',
                        uid: "arrow_temp_" + Date.now() + "_" + Math.random().toString(36).substr(2, 5),
                        x: x,
                        y: y,
                        arrow: { hasArrow: true, dx: 0, dy: 0 }
                    };
                    timelineData[currentStepIndex].push(currentDrawingArrow);
                } else {
                    isDrawing = true;
                    currentDrawingStroke = {
                        type: 'pen_stroke',
                        uid: "stroke_temp_" + Date.now() + "_" + Math.random().toString(36).substr(2, 5),
                        color: currentPenColor,
                        width: currentPenWidth,
                        points: [{ x: x, y: y }]
                    };
                    timelineData[currentStepIndex].push(currentDrawingStroke);
                }
                renderScene();
                return;
            }
        }

        // 마우스 오른쪽 클릭 시 화면 패닝(스크롤) 준비
        if (e.button === 2) {
            isPanningReady = true;
            isPanning = false;
            draggedDistance = 0;
            startX = e.pageX - mapArea.offsetLeft;
            startY = e.pageY - mapArea.offsetTop;
            scrollLeft = mapArea.scrollLeft;
            scrollTop = mapArea.scrollTop;
        }
    });

    // mousemove 이벤트를 window 레벨로 바인딩하여 맵 영역을 벗어나도 부드럽게 보장
    window.addEventListener('mousemove', (e) => {
        // OBS 마우스 위치 송신
        if (typeof isSyncMouseEnabled !== 'undefined' && isSyncMouseEnabled) {
            const mapRect = mapEl.getBoundingClientRect();
            const borderOffset = 2 * zoomLevel;
            const mx = (e.clientX - mapRect.left - borderOffset) / zoomLevel;
            const my = (e.clientY - mapRect.top - borderOffset) / zoomLevel;
            if (e.clientX >= mapRect.left && e.clientX <= mapRect.right &&
                e.clientY >= mapRect.top && e.clientY <= mapRect.bottom) {
                sendToObs({
                    type: 'mouse-move',
                    x: mx,
                    y: my
                });
            } else {
                sendToObs({ type: 'mouse-leave' });
            }
        }
        // 지우개 가이드 링 위치 업데이트
        const guide = document.getElementById('eraser-guide');
        if (activeTool === 'eraser') {
            const mapRect = mapEl.getBoundingClientRect();
            const borderOffset = 2 * zoomLevel;
            const x = (e.clientX - mapRect.left - borderOffset) / zoomLevel;
            const y = (e.clientY - mapRect.top - borderOffset) / zoomLevel;
            
            if (e.clientX >= mapRect.left && e.clientX <= mapRect.right &&
                e.clientY >= mapRect.top && e.clientY <= mapRect.bottom) {
                guide.style.display = 'block';
                guide.style.left = x + 'px';
                guide.style.top = y + 'px';
                guide.style.width = '48px';
                guide.style.height = '48px';
            } else {
                guide.style.display = 'none';
            }
        } else {
            guide.style.display = 'none';
        }

        // 1. 커스텀 드래그가 활성화된 경우 (마우스 왼쪽 클릭 드래그)
        if (draggedObj && draggedEl && dragType) {
            e.preventDefault();
            const mapRect = mapEl.getBoundingClientRect();
            const borderOffset = 2 * zoomLevel;
            const cx = Math.min(MAP_BASE_WIDTH, Math.max(0, (e.clientX - mapRect.left - borderOffset) / zoomLevel));
            const cy = Math.min(MAP_BASE_HEIGHT, Math.max(0, (e.clientY - mapRect.top - borderOffset) / zoomLevel));

            const baseX = dragType === 'arrow-end' ? (draggedObj.x + draggedObj.arrow.dx) : draggedObj.x;
            const baseY = dragType === 'arrow-end' ? (draggedObj.y + draggedObj.arrow.dy) : draggedObj.y;
            if (Math.abs(cx - baseX) > 0.5 || Math.abs(cy - baseY) > 0.5) {
                hasDraggedMoved = true;
            }
            
            if (dragType === 'object') {
                draggedObj.x = cx;
                draggedObj.y = cy;
                draggedEl.style.left = cx + "px";
                draggedEl.style.top = cy + "px";
                updateArrowLine(draggedObj);
                if (draggedObj.type === 'champion') {
                    renderGhosts();
                }
            } else if (dragType === 'arrow-end') {
                draggedObj.arrow.dx = cx - draggedObj.x;
                draggedObj.arrow.dy = cy - draggedObj.y;
                draggedEl.style.left = cx + "px";
                draggedEl.style.top = cy + "px";
                const line = svgLayer.querySelector(`line[data-uid="${draggedObj.uid}"]`);
                if (line) {
                    line.setAttribute("x2", cx);
                    line.setAttribute("y2", cy);
                }
            } else if (dragType === 'arrow-start') {
                // 자유 화살표의 시작점 이동 시 화살표 전체 이동 (dx, dy 유지)
                draggedObj.x = cx;
                draggedObj.y = cy;
                draggedEl.style.left = cx + "px";
                draggedEl.style.top = cy + "px";
                updateArrowLine(draggedObj);
            }
            
            // 드래그 중인 챔피언/오브젝트 위치를 실시간으로 OBS에 전달!
            syncObsScene(true);
            return;
        }

        // 2. 우클릭 드래그 패닝(스크롤) 중인 경우
        if (isPanningReady) {
            e.preventDefault();
            const x = e.pageX - mapArea.offsetLeft;
            const y = e.pageY - mapArea.offsetTop;
            const walkX = (x - startX);
            const walkY = (y - startY);
            
            draggedDistance = Math.sqrt(walkX * walkX + walkY * walkY);
            
            if (draggedDistance > 5) {
                isPanning = true;
                mapArea.classList.add('panning');
                mapArea.scrollLeft = scrollLeft - walkX;
                mapArea.scrollTop = scrollTop - walkY;
                syncObsViewport();
            }
            return;
        }

        // 3. 자유 화살표 그리기 중인 경우
        if (isDrawing && currentDrawingArrow) {
            e.preventDefault();
            const mapRect = mapEl.getBoundingClientRect();
            const borderOffset = 2 * zoomLevel;
            const cx = (e.clientX - mapRect.left - borderOffset) / zoomLevel;
            const cy = (e.clientY - mapRect.top - borderOffset) / zoomLevel;
            
            currentDrawingArrow.arrow.dx = cx - currentDrawingArrow.x;
            currentDrawingArrow.arrow.dy = cy - currentDrawingArrow.y;
            renderScene();
            return;
        }

        // 4. 자유 곡선(펜) 그리기 중인 경우
        if (isDrawing && currentDrawingStroke) {
            e.preventDefault();
            const mapRect = mapEl.getBoundingClientRect();
            const borderOffset = 2 * zoomLevel;
            const cx = (e.clientX - mapRect.left - borderOffset) / zoomLevel;
            const cy = (e.clientY - mapRect.top - borderOffset) / zoomLevel;
            
            const points = currentDrawingStroke.points;
            const lastPoint = points[points.length - 1];
            const dist = Math.sqrt((cx - lastPoint.x)**2 + (cy - lastPoint.y)**2);
            if (dist > 1.5) {
                points.push({ x: cx, y: cy });
                renderScene();
            }
            return;
        }

        // 5. 지우개 문지르기 중인 경우
        if (isDrawing && activeTool === 'eraser') {
            e.preventDefault();
            const mapRect = mapEl.getBoundingClientRect();
            const borderOffset = 2 * zoomLevel;
            const cx = (e.clientX - mapRect.left - borderOffset) / zoomLevel;
            const cy = (e.clientY - mapRect.top - borderOffset) / zoomLevel;
            eraseAt(cx, cy);
            return;
        }
    });

    // 그리기 완료 및 드래그 종료 처리
    window.addEventListener('mouseup', (e) => {
        // 1. 커스텀 드래그가 종료되는 경우
        if (draggedObj && draggedEl && dragType) {
            draggedEl.classList.remove('dragging');
            
            // transition 복구
            draggedEl.style.transition = '';
            const start = document.getElementById(`start_${draggedObj.uid}`);
            if (start) start.style.transition = '';
            const end = document.getElementById(`end_${draggedObj.uid}`);
            if (end) end.style.transition = '';
            const line = svgLayer.querySelector(`line[data-uid="${draggedObj.uid}"]`);
            if (line) line.style.transition = '';
            
            draggedObj = null;
            draggedEl = null;
            dragType = null;
            
            renderScene();
            if (hasDraggedMoved) {
                recordHistory();
                hasDraggedMoved = false;
            }
            return;
        }

        // 2. 우클릭 패닝이 종료되는 경우
        if (e.button === 2) {
            isPanningReady = false;
            if (isPanning) {
                isPanning = false;
                mapArea.classList.remove('panning');
                syncObsViewport();
            }
            return;
        }

        // 3. 자유 화살표 그리기가 끝나는 경우
        if (isDrawing && currentDrawingArrow) {
            isDrawing = false;
            const dx = currentDrawingArrow.arrow.dx;
            const dy = currentDrawingArrow.arrow.dy;
            // 클릭만 하거나 드래그 거리가 너무 짧으면 임시 화살표 삭제
            if (Math.abs(dx) < 5 && Math.abs(dy) < 5) {
                timelineData[currentStepIndex] = timelineData[currentStepIndex].filter(o => o.uid !== currentDrawingArrow.uid);
            } else {
                // 임시 UID를 확정된 정식 UID로 변환
                const finalUid = "arrow_" + Date.now() + "_" + Math.random().toString(36).substr(2, 5);
                
                // 기존 DOM 매칭 충돌 방지를 위해 임시 화살표 제거 후 정식 데이터로 추가
                timelineData[currentStepIndex] = timelineData[currentStepIndex].filter(o => o.uid !== currentDrawingArrow.uid);
                
                timelineData[currentStepIndex].push({
                    type: 'free_arrow',
                    uid: finalUid,
                    x: currentDrawingArrow.x,
                    y: currentDrawingArrow.y,
                    arrow: { hasArrow: true, dx: dx, dy: dy }
                });
                
                selectedObjUid = finalUid; // 생성 직후 바로 선택 상태로 지정하여 조절점 활성화
                recordHistory();
            }
            currentDrawingArrow = null;
            renderScene();
        }

        // 4. 자유 곡선(펜) 그리기가 끝나는 경우
        if (isDrawing && currentDrawingStroke) {
            isDrawing = false;
            const points = currentDrawingStroke.points;
            if (points.length < 2) {
                timelineData[currentStepIndex] = timelineData[currentStepIndex].filter(o => o.uid !== currentDrawingStroke.uid);
            } else {
                const finalUid = "stroke_" + Date.now() + "_" + Math.random().toString(36).substr(2, 5);
                timelineData[currentStepIndex] = timelineData[currentStepIndex].filter(o => o.uid !== currentDrawingStroke.uid);
                timelineData[currentStepIndex].push({
                    type: 'pen_stroke',
                    uid: finalUid,
                    color: currentDrawingStroke.color,
                    width: currentDrawingStroke.width,
                    points: points
                });
                recordHistory();
            }
            currentDrawingStroke = null;
            renderScene();
        }

        // 5. 지우개 문지르기가 끝나는 경우
        if (isDrawing && activeTool === 'eraser') {
            isDrawing = false;
            if (erasedSomething) {
                recordHistory();
                erasedSomething = false;
            }
            renderScene();
        }
    });

    mapArea.addEventListener('mouseleave', () => {
        document.getElementById('eraser-guide').style.display = 'none';
        sendToObs({ type: 'mouse-leave' });
    });

    // 맵 전체 브라우저 기본 우클릭 메뉴 차단
    mapEl.addEventListener('contextmenu', (e) => {
        e.preventDefault();
    });

    // 맵 배경 클릭 시 선택 해제 처리
    mapEl.addEventListener('click', (e) => {
        if (!e.target.closest('.placed-object') && !e.target.closest('.arrow-control') && e.target.tagName !== 'line') {
            clearSelection();
        }
    });
}

// --- Core Logic ---
function recordHistory() {
    if (!timelineData[currentStepIndex]) return;
    if (historyPointer < historyStack.length - 1) {
        historyStack = historyStack.slice(0, historyPointer + 1);
    }
    // Deep Copy: 독립된 상태 저장
    const snapshot = {
        data: JSON.parse(JSON.stringify(timelineData)),
        stepIndex: currentStepIndex
    };
    historyStack.push(snapshot);
    historyPointer++;
    if(historyStack.length > 50) { 
        historyStack.shift();
        historyPointer--;
    }
}

function undo() {
    if (historyPointer > 0) {
        historyPointer--;
        restoreState(historyStack[historyPointer]);
    }
}

function redo() {
    if (historyPointer < historyStack.length - 1) {
        historyPointer++;
        restoreState(historyStack[historyPointer]);
    }
}

function triggerStepAnimation() {
    mapEl.classList.add('animating');
    if (window.animTimer) clearTimeout(window.animTimer);
    window.animTimer = setTimeout(() => {
        mapEl.classList.remove('animating');
    }, 350);
}

function restoreState(snapshot) {
    triggerStepAnimation();
    timelineData = JSON.parse(JSON.stringify(snapshot.data));
    currentStepIndex = Math.max(0, Math.min(snapshot.stepIndex || 0, timelineData.length - 1));
    if (selectedObjUid && !(timelineData[currentStepIndex] || []).some(o => o.uid === selectedObjUid)) {
        selectedObjUid = null;
    }
    renderScene();
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
            
            img.onclick = function() { 
                const nowObjs = timelineData[currentStepIndex];
                const foundIdx = nowObjs.findIndex(o => o.type === 'structure_destroyed' && o.uid === structId);
                if (foundIdx > -1) {
                    nowObjs.splice(foundIdx, 1);
                } else {
                    nowObjs.push({
                        type: 'structure_destroyed',
                        uid: structId
                    });
                }
                renderScene();
                recordHistory();
            };
            structureLayer.appendChild(img);
        }
        img.classList.toggle('destroyed', isDestroyed);
    });
}

const CHOSUNG_LIST = ['ㄱ','ㄲ','ㄴ','ㄷ','ㄸ','ㄹ','ㅁ','ㅂ','ㅃ','ㅅ','ㅆ','ㅇ','ㅈ','ㅉ','ㅊ','ㅋ','ㅌ','ㅍ','ㅎ'];

function getChosung(str) {
    let result = '';
    for (let i = 0; i < str.length; i++) {
        const code = str.charCodeAt(i);
        if (code >= 0xAC00 && code <= 0xD7A3) {
            result += CHOSUNG_LIST[Math.floor((code - 0xAC00) / 588)];
        } else {
            result += str[i];
        }
    }
    return result;
}

function matchesChampionSearch(champName, champKey, filter) {
    if (!filter) return true;
    const cleanFilter = filter.replace(/\s+/g, '').toLowerCase();
    const cleanName = champName.replace(/\s+/g, '').toLowerCase();
    const cleanChosung = getChosung(cleanName);
    return cleanName.includes(cleanFilter) ||
           cleanChosung.includes(cleanFilter) ||
           champKey.toLowerCase().includes(cleanFilter);
}

function addChampToPreset(champKey, team) {
    if (!champKey || !championData[champKey]) return;
    const targetList = team === 'blue' ? bluePreset : redPreset;
    const teamLabel = team === 'blue'
        ? (myTeamSide === 'blue' ? '블루(아군)' : '블루(적군)')
        : (myTeamSide === 'red' ? '레드(아군)' : '레드(적군)');

    if (targetList.includes(champKey)) {
        showToast(`⚠️ 이미 ${teamLabel} 프리셋에 추가된 챔피언입니다.`);
        return;
    }
    if (targetList.length >= 5) {
        showToast("⚠️ 팀당 최대 5명까지 추가할 수 있습니다.");
        return;
    }

    targetList.push(champKey);
    renderPresets();
    showToast(`${championData[champKey].name} → ${teamLabel} 추가`);

    // 선택 해제
    selectedChampKey = null;
    document.querySelectorAll('#champList .icon-item').forEach(el => el.classList.remove('selected'));
    document.getElementById('btn-add-blue').disabled = true;
    document.getElementById('btn-add-red').disabled = true;

    // 검색창 텍스트 비우고 포커스 유지
    const searchInput = document.getElementById('search');
    if (searchInput && searchInput.value.trim() !== '') {
        searchInput.value = '';
        renderLeftSidebar('');
        searchInput.focus();
    }
}

function addSelectedToPreset(role) {
    if (!selectedChampKey) return;
    const targetTeam = role === 'blue'
        ? (myTeamSide === 'blue' ? 'blue' : 'red')
        : (myTeamSide === 'blue' ? 'red' : 'blue');
    addChampToPreset(selectedChampKey, targetTeam);
}

function resolveChampionTeam(obj) {
    if (!obj) return null;
    if (obj.team === 'none') return null;
    if (obj.team === 'blue' || obj.team === 'red') return obj.team;
    if (bluePreset.includes(obj.champId)) return 'blue';
    if (redPreset.includes(obj.champId)) return 'red';
    return null;
}

function renderPresets() {
    renderSinglePreset('blue', bluePreset);
    renderSinglePreset('red', redPreset);
    // 프리셋 변동 시 수동 고정되지 않은 배치 챔피언 테두리도 즉시 갱신
    if (typeof renderObjects === 'function' && timelineData[currentStepIndex]) {
        renderObjects();
        renderGhosts();
        if (typeof syncObsScene === 'function') syncObsScene();
    }
}

function presetDragStart(ev, team) {
    if (ev.target.tagName === 'IMG') {
        return;
    }
    const dragData = { dragType: "preset-team", team: team };
    window.currentDragData = dragData;
    ev.dataTransfer.setData("text/plain", JSON.stringify(dragData));
    ev.dataTransfer.setData("dragType", "preset-team");
    ev.dataTransfer.setData("team", team);
    ev.dataTransfer.setDragImage(new Image(), 0, 0);
}

function renderSinglePreset(team, list) {
    const container = document.getElementById(`${team}PresetList`);
    container.innerHTML = "";
    
    if (list.length === 0) {
        const placeholder = document.createElement('div');
        placeholder.className = 'preset-placeholder';
        placeholder.innerText = "끌어서 맵에 배치";
        container.appendChild(placeholder);
        return;
    }

    list.forEach(key => {
        const champ = championData[key];
        if (!champ) return;
        const img = document.createElement('img');
        img.src = key === "Locke" ? "images/Locke.png" : `https://ddragon.leagueoflegends.com/cdn/${currentVersion}/img/champion/${key}.png`;
        img.className = 'icon-item';
        img.draggable = true;
        img.title = `${champ.name} (클릭 시 프리셋에서 제거)`;
        
        img.addEventListener('mousedown', () => {
            window.currentDragData = { dragType: "new-champion", champId: key, team: team };
        });
        img.addEventListener('dragstart', (e) => {
            e.stopPropagation();
            const dragData = { dragType: "new-champion", champId: key, team: team };
            window.currentDragData = dragData;
            e.dataTransfer.setData("text/plain", JSON.stringify(dragData));
            e.dataTransfer.setData("dragType", "new-champion");
            e.dataTransfer.setData("champId", key);
            e.dataTransfer.setData("team", team);
        });
        
        img.addEventListener('click', () => {
            const idx = list.indexOf(key);
            if (idx > -1) {
                list.splice(idx, 1);
                renderPresets();
            }
        });
        
        container.appendChild(img);
    });
}

function renderLeftSidebar(filter = "") {
    const list = document.getElementById('champList');
    list.innerHTML = "";
    Object.keys(championData).sort().forEach(key => {
        const champ = championData[key];
        if (matchesChampionSearch(champ.name, key, filter)) {
            const img = document.createElement('img');
            img.src = key === "Locke" ? "images/Locke.png" : `https://ddragon.leagueoflegends.com/cdn/${currentVersion}/img/champion/${key}.png`;
            img.className = `icon-item ${selectedChampKey === key ? 'selected' : ''}`;
            img.draggable = true;
            img.title = `${champ.name} (더블클릭: 아군 추가 | 우클릭: 적군 추가 | 드래그: 맵 배치)`;
            img.addEventListener('mousedown', () => {
                window.currentDragData = { dragType: "new-champion", champId: key };
            });
            img.addEventListener('dragstart', (e) => {
                const dragData = { dragType: "new-champion", champId: key };
                window.currentDragData = dragData;
                e.dataTransfer.setData("text/plain", JSON.stringify(dragData));
                e.dataTransfer.setData("dragType", "new-champion");
                e.dataTransfer.setData("champId", key);
            });
            
            img.addEventListener('click', () => {
                const wasSelected = img.classList.contains('selected');
                document.querySelectorAll('#champList .icon-item').forEach(el => el.classList.remove('selected'));
                if (wasSelected) {
                    selectedChampKey = null;
                    document.getElementById('btn-add-blue').disabled = true;
                    document.getElementById('btn-add-red').disabled = true;
                } else {
                    selectedChampKey = key;
                    img.classList.add('selected');
                    document.getElementById('btn-add-blue').disabled = false;
                    document.getElementById('btn-add-red').disabled = false;
                }
            });

            img.addEventListener('dblclick', (e) => {
                e.preventDefault();
                addChampToPreset(key, myTeamSide === 'blue' ? 'blue' : 'red');
            });

            img.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                e.stopPropagation();
                addChampToPreset(key, myTeamSide === 'blue' ? 'red' : 'blue');
            });
            
            list.appendChild(img);
        }
    });
}
document.getElementById('search').addEventListener('input', (e) => renderLeftSidebar(e.target.value));

function renderRightSidebar() {
    // Pings
    const tacticsList = document.getElementById('tacticsList');
    tacticsData.forEach(item => {
        const img = document.createElement('img');
        img.src = item.src;
        img.className = 'icon-item';
        img.draggable = true;
        img.title = item.name;
        img.addEventListener('mousedown', () => {
            window.currentDragData = { dragType: "new-ping", iconSrc: item.src };
        });
        img.addEventListener('dragstart', (e) => {
            const dragData = { dragType: "new-ping", iconSrc: item.src };
            window.currentDragData = dragData;
            e.dataTransfer.setData("text/plain", JSON.stringify(dragData));
            e.dataTransfer.setData("dragType", "new-ping");
            e.dataTransfer.setData("iconSrc", item.src);
        });
        tacticsList.appendChild(img);
    });

    // Epic Monsters
    const epicList = document.getElementById('epicMonstersList');
    epicMonstersData.forEach(item => {
        const img = document.createElement('img');
        img.src = item.src;
        img.className = 'icon-item';
        img.draggable = true;
        img.title = item.name;
        img.addEventListener('mousedown', () => {
            window.currentDragData = { dragType: "new-object", iconSrc: item.src };
        });
        img.addEventListener('dragstart', (e) => {
            const dragData = { dragType: "new-object", iconSrc: item.src };
            window.currentDragData = dragData;
            e.dataTransfer.setData("text/plain", JSON.stringify(dragData));
            e.dataTransfer.setData("dragType", "new-object");
            e.dataTransfer.setData("iconSrc", item.src);
        });
        epicList.appendChild(img);
    });

    // Buffs
    const buffsList = document.getElementById('buffsList');
    buffsData.forEach(item => {
        const img = document.createElement('img');
        img.src = item.src;
        img.className = 'icon-item';
        img.draggable = true;
        img.title = item.name;
        img.addEventListener('mousedown', () => {
            window.currentDragData = { dragType: "new-object", iconSrc: item.src };
        });
        img.addEventListener('dragstart', (e) => {
            const dragData = { dragType: "new-object", iconSrc: item.src };
            window.currentDragData = dragData;
            e.dataTransfer.setData("text/plain", JSON.stringify(dragData));
            e.dataTransfer.setData("dragType", "new-object");
            e.dataTransfer.setData("iconSrc", item.src);
        });
        buffsList.appendChild(img);
    });

    // Minions
    const minionsList = document.getElementById('minionsList');
    minionsData.forEach(item => {
        const img = document.createElement('img');
        img.src = item.src;
        img.className = 'icon-item';
        img.draggable = true;
        img.title = item.name;
        img.addEventListener('mousedown', () => {
            window.currentDragData = { dragType: "new-object", iconSrc: item.src, id: item.id };
        });
        img.addEventListener('dragstart', (e) => {
            const dragData = { dragType: "new-object", iconSrc: item.src, id: item.id };
            window.currentDragData = dragData;
            e.dataTransfer.setData("text/plain", JSON.stringify(dragData));
            e.dataTransfer.setData("dragType", "new-object");
            e.dataTransfer.setData("iconSrc", item.src);
        });
        minionsList.appendChild(img);
    });

    // Utility Objects
    const objectsList = document.getElementById('objectsList');
    objectsData.forEach(item => {
        const img = document.createElement('img');
        img.src = item.src;
        img.className = 'icon-item';
        img.draggable = true;
        img.title = item.name;
        img.addEventListener('mousedown', () => {
            window.currentDragData = { dragType: "new-object", iconSrc: item.src };
        });
        img.addEventListener('dragstart', (e) => {
            const dragData = { dragType: "new-object", iconSrc: item.src };
            window.currentDragData = dragData;
            e.dataTransfer.setData("text/plain", JSON.stringify(dragData));
            e.dataTransfer.setData("dragType", "new-object");
            e.dataTransfer.setData("iconSrc", item.src);
        });
        objectsList.appendChild(img);
    });
}

function switchRightTab(tabId) {
    document.querySelectorAll('#right-panel-wrapper .sidebar-tabs .tab-btn').forEach(btn => {
        btn.classList.remove('active');
        btn.style.borderBottomColor = 'transparent';
        btn.style.color = '#888';
    });
    const activeBtn = document.getElementById(`tab-btn-${tabId}`);
    if (activeBtn) {
        activeBtn.classList.add('active');
        activeBtn.style.borderBottomColor = 'var(--accent-color)';
        activeBtn.style.color = 'var(--accent-color)';
    }
    
    document.getElementById('tab-content-team').style.display = tabId === 'team' ? 'block' : 'none';
    document.getElementById('tab-content-objects').style.display = tabId === 'objects' ? 'block' : 'none';
    document.getElementById('tab-content-obs').style.display = tabId === 'obs' ? 'block' : 'none';
}

// ==========================================================================
// 📋 전술페이지 (Tactics) 저장 / 불러오기(드롭다운) / 수정 / 삭제
// ==========================================================================

function getSavedTacticsFromStorage() {
    const data = localStorage.getItem(TACTICS_STORAGE_KEY);
    if (!data) return [];
    try {
        const parsed = JSON.parse(data);
        return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
        return [];
    }
}

function saveTacticsToStorage(tactics) {
    try {
        localStorage.setItem(TACTICS_STORAGE_KEY, JSON.stringify(tactics));
        return true;
    } catch (e) {
        showToast('⚠️ 브라우저 저장 용량이 부족해 전술을 저장할 수 없습니다.');
        return false;
    }
}

function createCurrentBoardSnapshot() {
    return {
        timelineData: JSON.parse(JSON.stringify(timelineData || [ [] ])),
        currentStepIndex: currentStepIndex,
        myTeamSide: myTeamSide,
        bluePreset: JSON.parse(JSON.stringify(bluePreset || [])),
        redPreset: JSON.parse(JSON.stringify(redPreset || [])),
        currentMode: currentMode,
        selectedScreenshotId: selectedScreenshotId,
        showGhostChampions: showGhostChampions
    };
}

function applyBoardSnapshot(tactic, shouldRecordHistory = true) {
    triggerStepAnimation();
    mapEl.querySelectorAll('.placed-object, .arrow-control').forEach(el => el.remove());
    svgLayer.querySelectorAll('line, path[data-uid]').forEach(l => l.remove());

    timelineData = JSON.parse(JSON.stringify(
        Array.isArray(tactic.timelineData) && tactic.timelineData.length > 0 ? tactic.timelineData : [ [] ]
    ));
    currentStepIndex = Math.max(0, Math.min(tactic.currentStepIndex || 0, timelineData.length - 1));
    bluePreset = JSON.parse(JSON.stringify(tactic.bluePreset || []));
    redPreset = JSON.parse(JSON.stringify(tactic.redPreset || []));
    selectedObjUid = null;

    showGhostChampions = typeof tactic.showGhostChampions === 'boolean' ? tactic.showGhostChampions : true;
    const ghostCb = document.getElementById('show-ghost-checkbox');
    if (ghostCb) ghostCb.checked = showGhostChampions;

    renderPresets();
    setMyTeamSide(tactic.myTeamSide || 'blue');
    selectedScreenshotId = tactic.selectedScreenshotId !== undefined ? tactic.selectedScreenshotId : null;
    setAppMode(tactic.currentMode || 'map');

    renderScene();
    if (shouldRecordHistory) {
        recordHistory();
    }
}

function onTacticSelectChange(tacticId) {
    if (!tacticId) {
        currentTacticId = null;
        renderTacticsUI();
        return;
    }
    loadTactic(tacticId);
}

function loadTactic(tacticId) {
    const tactics = getSavedTacticsFromStorage();
    const tactic = tactics.find(t => t.id === tacticId);
    if (!tactic) {
        showToast('⚠️ 선택한 전술을 찾을 수 없습니다.');
        currentTacticId = null;
        renderTacticsUI();
        return;
    }

    currentTacticId = tactic.id;
    applyBoardSnapshot(tactic);

    renderTacticsUI();
    showToast(`📂 '${tactic.name}' 전술을 불러왔습니다. (${timelineData.length}스텝)`);
}

function saveNewTactic(name) {
    const tactics = getSavedTacticsFromStorage();
    const newTactic = Object.assign({
        id: "tactic_" + Date.now() + "_" + Math.random().toString(36).substr(2, 5),
        name: name,
        updatedAt: Date.now()
    }, createCurrentBoardSnapshot());

    tactics.push(newTactic);
    if (!saveTacticsToStorage(tactics)) return;

    currentTacticId = newTactic.id;

    renderTacticsUI();
    showToast(`💾 '${name}' 전술이 새로 저장되었습니다.`);
}

function saveNewTacticFromToolbar() {
    const tactics = getSavedTacticsFromStorage();
    const defaultName = "전술 " + (tactics.length + 1);
    const inputName = prompt("새로 저장할 전술 이름을 입력하세요:", defaultName);
    if (inputName === null) return;
    const finalName = inputName.trim() || defaultName;
    saveNewTactic(finalName);
}

function updateSelectedTactic(_promptRename = true, targetId = null) {
    const idToUpdate = targetId || currentTacticId;
    if (!idToUpdate) {
        showToast("⚠️ 먼저 드롭다운에서 수정할 전술을 선택해주세요.");
        return;
    }

    const tactics = getSavedTacticsFromStorage();
    const target = tactics.find(t => t.id === idToUpdate);
    if (!target) {
        showToast("⚠️ 수정할 전술을 찾을 수 없습니다.");
        return;
    }

    const newName = prompt("전술 이름을 확인/수정하세요 (현재 보드 상태가 덮어써집니다):", target.name);
    if (newName === null) return;
    target.name = newName.trim() || target.name;

    Object.assign(target, createCurrentBoardSnapshot(), { updatedAt: Date.now() });
    if (!saveTacticsToStorage(tactics)) return;

    currentTacticId = target.id;

    renderTacticsUI();
    showToast(`✅ '${target.name}' 전술이 현재 상태로 수정되었습니다.`);
}

function deleteSelectedTactic(targetId = null) {
    const idToDelete = targetId || currentTacticId;
    if (!idToDelete) {
        showToast("⚠️ 삭제할 전술을 먼저 선택해주세요.");
        return;
    }

    let tactics = getSavedTacticsFromStorage();
    const target = tactics.find(t => t.id === idToDelete);
    if (!target) {
        showToast("⚠️ 삭제할 전술을 찾을 수 없습니다.");
        return;
    }

    if (!confirm(`'${target.name}' 전술을 삭제하시겠습니까?`)) return;

    tactics = tactics.filter(t => t.id !== idToDelete);
    saveTacticsToStorage(tactics);

    if (currentTacticId === idToDelete) {
        currentTacticId = null;
    }

    renderTacticsUI();
    showToast(`🗑️ '${target.name}' 전술이 삭제되었습니다.`);
}

function renderTacticsUI() {
    const tactics = getSavedTacticsFromStorage();
    if (currentTacticId && !tactics.some(t => t.id === currentTacticId)) {
        currentTacticId = null;
    }

    // 1. 우측 사이드바 / 모바일 드롭다운 select 동기화
    const selectConfigs = [
        { id: 'sidebar-tactic-select', emptyLabel: '📋 저장된 전술 선택...' },
        { id: 'mobile-tactic-select', emptyLabel: '📋 전술 선택...' }
    ];
    selectConfigs.forEach(({ id, emptyLabel }) => {
        const sel = document.getElementById(id);
        if (!sel) return;
        sel.innerHTML = '';
        const defaultOpt = document.createElement('option');
        defaultOpt.value = '';
        defaultOpt.innerText = emptyLabel;
        sel.appendChild(defaultOpt);

        tactics.forEach(t => {
            const opt = document.createElement('option');
            opt.value = t.id;
            const stepCount = Array.isArray(t.timelineData) ? t.timelineData.length : 1;
            opt.innerText = `${t.name} (${stepCount}스텝)`;
            sel.appendChild(opt);
        });
        sel.value = currentTacticId || '';
    });

    // 2. 수정/삭제 버튼 활성/비활성 동기화
    const hasActive = Boolean(currentTacticId);
    [
        'sidebar-tactic-update-btn',
        'sidebar-tactic-delete-btn',
        'mobile-tactic-update-btn',
        'mobile-tactic-delete-btn'
    ].forEach(btnId => {
        const btn = document.getElementById(btnId);
        if (btn) btn.disabled = !hasActive;
    });

    const countEl = document.getElementById('saved-tactics-count');
    if (countEl) countEl.innerText = `${tactics.length}개`;
}

function setMyTeamSide(side) {
    myTeamSide = side;
    
    const blueBtn = document.getElementById('team-select-blue');
    const redBtn = document.getElementById('team-select-red');
    
    if (side === 'blue') {
        blueBtn.style.borderColor = 'var(--accent-color)';
        blueBtn.style.boxShadow = '0 0 5px var(--accent-color)';
        blueBtn.style.opacity = '1';
        
        redBtn.style.borderColor = 'transparent';
        redBtn.style.boxShadow = 'none';
        redBtn.style.opacity = '0.6';
    } else {
        redBtn.style.borderColor = 'var(--accent-color)';
        redBtn.style.boxShadow = '0 0 5px var(--accent-color)';
        redBtn.style.opacity = '1';
        
        blueBtn.style.borderColor = 'transparent';
        blueBtn.style.boxShadow = 'none';
        blueBtn.style.opacity = '0.6';
    }

    const blueTitle = document.getElementById('blue-team-title');
    const redTitle = document.getElementById('red-team-title');
    if (blueTitle && redTitle) {
        if (side === 'blue') {
            blueTitle.innerText = "Blue Team (아군)";
            redTitle.innerText = "Red Team (적군)";
        } else {
            blueTitle.innerText = "Blue Team (적군)";
            redTitle.innerText = "Red Team (아군)";
        }
    }
    
    renderScene();
}

function switchLeftTab(tabId) {
    document.querySelectorAll('#sidebar-left .sidebar-tabs .tab-btn').forEach(btn => {
        btn.classList.remove('active');
        btn.style.borderBottomColor = 'transparent';
        btn.style.color = '#888';
    });
    const activeBtn = document.getElementById(`tab-btn-${tabId}`);
    if (activeBtn) {
        activeBtn.classList.add('active');
        activeBtn.style.borderBottomColor = 'var(--accent-color)';
        activeBtn.style.color = 'var(--accent-color)';
    }
    
    document.getElementById('tab-content-champs').style.display = tabId === 'champs' ? 'flex' : 'none';
    document.getElementById('tab-content-presets').style.display = tabId === 'presets' ? 'flex' : 'none';
    document.getElementById('tab-content-screenshots').style.display = tabId === 'screenshots' ? 'flex' : 'none';
    
    if (tabId === 'presets') {
        renderSavedPresets();
    } else if (tabId === 'screenshots') {
        renderScreenshots();
        // 스크린샷 탭을 열면 자동으로 스크린샷 배경 모드로 전환하여 편리함 제공
        if (currentMode !== 'screenshot') {
            setAppMode('screenshot');
        }
    }
}

function getSavedPresetsFromStorage() {
    const data = localStorage.getItem('lol_strategy_user_presets');
    if (data) {
        try {
            const parsed = JSON.parse(data);
            return Array.isArray(parsed) ? parsed : [];
        } catch(e) {
            return [];
        }
    }
    return [];
}

function savePresetsToStorage(presets) {
    try {
        localStorage.setItem('lol_strategy_user_presets', JSON.stringify(presets));
        return true;
    } catch (e) {
        showToast('⚠️ 브라우저 저장 용량이 부족해 프리셋을 저장할 수 없습니다.');
        return false;
    }
}

function saveCurrentPreset() {
    const nameInput = document.getElementById('preset-name-input');
    const name = nameInput.value.trim();
    if (!name) {
        alert("프리셋 이름을 입력해주세요.");
        return;
    }
    
    if (bluePreset.length === 0 && redPreset.length === 0) {
        alert("현재 프리셋 슬롯(아군 또는 적군)이 비어있습니다. 챔피언을 추가 후 저장해 주세요.");
        return;
    }

    const newPreset = {
        id: "user_preset_" + Date.now() + "_" + Math.random().toString(36).substr(2, 5),
        name: name,
        blue: JSON.parse(JSON.stringify(bluePreset)),
        red: JSON.parse(JSON.stringify(redPreset))
    };

    let saved = getSavedPresetsFromStorage();
    saved.push(newPreset);
    savePresetsToStorage(saved);

    nameInput.value = "";
    renderSavedPresets();
}

function renderSavedPresets() {
    const listContainer = document.getElementById('saved-presets-list');
    listContainer.innerHTML = "";
    const presets = getSavedPresetsFromStorage();

    if (presets.length === 0) {
        listContainer.innerHTML = `<div style="color: #666; text-align: center; font-size: 13px; margin-top: 30px; font-weight: bold;">저장된 프리셋이 없습니다.</div>`;
        return;
    }

    presets.forEach(preset => {
        const itemEl = document.createElement('div');
        itemEl.style.background = '#252525';
        itemEl.style.border = '1px solid #333';
        itemEl.style.borderRadius = '6px';
        itemEl.style.padding = '10px';
        itemEl.style.display = 'flex';
        itemEl.style.flexDirection = 'column';
        itemEl.style.gap = '8px';

        // 타이틀 & 액션 버튼 영역
        const headerEl = document.createElement('div');
        headerEl.style.display = 'flex';
        headerEl.style.justifyContent = 'space-between';
        headerEl.style.alignItems = 'center';
        
        const titleEl = document.createElement('span');
        titleEl.innerText = preset.name;
        titleEl.style.fontWeight = 'bold';
        titleEl.style.fontSize = '14px';
        titleEl.style.color = 'var(--accent-color)';
        headerEl.appendChild(titleEl);

        const btnGroup = document.createElement('div');
        btnGroup.style.display = 'flex';
        btnGroup.style.gap = '4px';

        // 적용 버튼
        const applyBtn = document.createElement('button');
        applyBtn.className = 'tool-btn btn-green';
        applyBtn.style.padding = '3px 6px';
        applyBtn.style.fontSize = '11px';
        applyBtn.innerText = '적용';
        applyBtn.onclick = () => loadPreset(preset.id);
        btnGroup.appendChild(applyBtn);

        // 덮어쓰기 버튼
        const updateBtn = document.createElement('button');
        updateBtn.className = 'tool-btn btn-blue';
        updateBtn.style.padding = '3px 6px';
        updateBtn.style.fontSize = '11px';
        updateBtn.innerText = '덮어쓰기';
        updateBtn.onclick = () => overwritePreset(preset.id);
        btnGroup.appendChild(updateBtn);

        // 삭제 버튼
        const delBtn = document.createElement('button');
        delBtn.className = 'tool-btn btn-red';
        delBtn.style.padding = '3px 6px';
        delBtn.style.fontSize = '11px';
        delBtn.innerText = '삭제';
        delBtn.onclick = () => deletePreset(preset.id);
        btnGroup.appendChild(delBtn);

        headerEl.appendChild(btnGroup);
        itemEl.appendChild(headerEl);

        // 챔피언 구성 비주얼 영역 (아이콘 나열)
        const visualEl = document.createElement('div');
        visualEl.style.display = 'flex';
        visualEl.style.flexDirection = 'column';
        visualEl.style.gap = '4px';
        visualEl.style.background = '#1a1a1a';
        visualEl.style.padding = '6px';
        visualEl.style.borderRadius = '4px';

        const createIconsLine = (teamColor, champKeys) => {
            const line = document.createElement('div');
            line.style.display = 'flex';
            line.style.alignItems = 'center';
            line.style.gap = '4px';
            
            const label = document.createElement('span');
            label.innerText = teamColor === 'blue' ? '🔵' : '🔴';
            label.style.fontSize = '11px';
            line.appendChild(label);

            if (champKeys.length === 0) {
                const emptyText = document.createElement('span');
                emptyText.innerText = '없음';
                emptyText.style.color = '#555';
                emptyText.style.fontSize = '11px';
                line.appendChild(emptyText);
            } else {
                champKeys.forEach(key => {
                    const img = document.createElement('img');
                    img.src = key === "Locke" ? "images/Locke.png" : `https://ddragon.leagueoflegends.com/cdn/${currentVersion}/img/champion/${key}.png`;
                    img.style.width = '20px';
                    img.style.height = '20px';
                    img.style.borderRadius = '50%';
                    img.style.border = '1px solid #444';
                    line.appendChild(img);
                });
            }
            return line;
        };

        visualEl.appendChild(createIconsLine('blue', preset.blue || []));
        visualEl.appendChild(createIconsLine('red', preset.red || []));
        itemEl.appendChild(visualEl);

        listContainer.appendChild(itemEl);
    });
}

function loadPreset(presetId) {
    const presets = getSavedPresetsFromStorage();
    const preset = presets.find(p => p.id === presetId);
    if (!preset) return;

    if (confirm(`'${preset.name}' 프리셋을 불러오시겠습니까? 현재 슬롯이 대체됩니다.`)) {
        bluePreset = JSON.parse(JSON.stringify(preset.blue || []));
        redPreset = JSON.parse(JSON.stringify(preset.red || []));
        renderPresets();
    }
}

function overwritePreset(presetId) {
    const presets = getSavedPresetsFromStorage();
    const idx = presets.findIndex(p => p.id === presetId);
    if (idx === -1) return;

    if (bluePreset.length === 0 && redPreset.length === 0) {
        alert("현재 프리셋 슬롯이 비어있어 덮어쓸 수 없습니다.");
        return;
    }

    if (confirm(`현재 아군/적군 프리셋 슬롯으로 '${presets[idx].name}' 프리셋을 덮어쓰시겠습니까?`)) {
        presets[idx].blue = JSON.parse(JSON.stringify(bluePreset));
        presets[idx].red = JSON.parse(JSON.stringify(redPreset));
        savePresetsToStorage(presets);
        renderSavedPresets();
    }
}

function deletePreset(presetId) {
    let presets = getSavedPresetsFromStorage();
    const preset = presets.find(p => p.id === presetId);
    if (!preset) return;

    if (confirm(`'${preset.name}' 프리셋을 삭제하시겠습니까?`)) {
        presets = presets.filter(p => p.id !== presetId);
        savePresetsToStorage(presets);
        renderSavedPresets();
    }
}

function renderScene() {
    if (!timelineData[currentStepIndex]) { timelineData[currentStepIndex] = []; }
    renderObjects();
    renderGhosts();
    renderArrows();
    renderStrokes();
    renderStructures();
    renderTimeline();
    
    if (typeof syncObsScene === 'function') {
        syncObsScene();
    }
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
        let path = svgLayer.querySelector(`path[data-uid="${obj.uid}"]`);
        if (!path) {
            path = document.createElementNS("http://www.w3.org/2000/svg", "path");
            path.setAttribute("data-uid", obj.uid);
            path.setAttribute("fill", "none");
            path.setAttribute("stroke-linecap", "round");
            path.setAttribute("stroke-linejoin", "round");
            path.style.cursor = "pointer";
            path.style.pointerEvents = "visibleStroke";
            
            path.addEventListener('click', (e) => {
                e.stopPropagation();
                clearSelection();
                selectedObjUid = obj.uid;
                renderScene();
            });
            
            path.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                e.stopPropagation();
                showContextMenu(e.clientX, e.clientY, obj.uid);
            });
            
            svgLayer.appendChild(path);
        }
        
        path._dataObj = obj;
        
        const dString = getSvgPathFromPoints(obj.points);
        path.setAttribute("d", dString);
        path.setAttribute("stroke", obj.color);
        path.setAttribute("stroke-width", obj.width);
        
        if (obj.uid === selectedObjUid) {
            path.setAttribute("stroke-width", obj.width + 2);
            path.style.filter = "drop-shadow(0 0 5px var(--accent-color))";
        } else {
            path.style.filter = "none";
        }
    });
}

function setDrawingTool(tool) {
    activeTool = tool;
    document.querySelectorAll('.toolbar-group #tool-select, .toolbar-group #tool-pen, .toolbar-group #tool-arrow, .toolbar-group #tool-eraser').forEach(btn => {
        btn.classList.remove('active');
    });
    const activeBtn = document.getElementById(`tool-${tool}`);
    if (activeBtn) activeBtn.classList.add('active');

    document.querySelectorAll('#mobile-dropdown-menu .mobile-menu-btn[data-tool]').forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('data-tool') === tool);
    });

    mapEl.classList.toggle('select-active', tool === 'select');
    
    if (tool === 'eraser') {
        mapEl.classList.add('eraser-active');
    } else {
        mapEl.classList.remove('eraser-active');
        document.getElementById('eraser-guide').style.display = 'none';
    }
}

function setPenColor(color) {
    currentPenColor = color;
    document.querySelectorAll('.color-picker-group .color-dot').forEach(dot => {
        dot.classList.remove('active');
        if (dot.getAttribute('data-color') === color) {
            dot.classList.add('active');
        }
    });
}

function setPenWidth(width) {
    currentPenWidth = width;
    document.querySelectorAll('.width-picker-group .width-btn').forEach(btn => {
        btn.classList.remove('active');
        if (parseInt(btn.getAttribute('data-width')) === width) {
            btn.classList.add('active');
        }
    });
}

function getDistanceToSegment(x, y, x1, y1, x2, y2) {
    const A = x - x1;
    const B = y - y1;
    const C = x2 - x1;
    const D = y2 - y1;

    const dot = A * C + B * D;
    const lenSq = C * C + D * D;
    let param = -1;
    if (lenSq !== 0) param = dot / lenSq;

    let xx, yy;
    if (param < 0) {
        xx = x1;
        yy = y1;
    } else if (param > 1) {
        xx = x2;
        yy = y2;
    } else {
        xx = x1 + param * C;
        yy = y1 + param * D;
    }

    const dx = x - xx;
    const dy = y - yy;
    return Math.sqrt(dx * dx + dy * dy);
}

function eraseAt(cx, cy) {
    const R = 24; // 지우개 반경
    const currentObjs = timelineData[currentStepIndex] || [];
    let modified = false;

    const nextObjs = [];

    currentObjs.forEach(obj => {
        let shouldDelete = false;

        if (obj.type === 'pen_stroke') {
            shouldDelete = obj.points.some(p => {
                const dist = Math.sqrt((p.x - cx) ** 2 + (p.y - cy) ** 2);
                return dist <= R;
            });
        } else if (obj.type === 'free_arrow') {
            const dist = getDistanceToSegment(cx, cy, obj.x, obj.y, obj.x + obj.arrow.dx, obj.y + obj.arrow.dy);
            shouldDelete = dist <= R;
        } else if (obj.arrow && obj.arrow.hasArrow) {
            const dist = getDistanceToSegment(cx, cy, obj.x, obj.y, obj.x + obj.arrow.dx, obj.y + obj.arrow.dy);
            if (dist <= R) {
                obj.arrow.hasArrow = false;
                modified = true;
            }
        }

        if (shouldDelete) {
            modified = true;
            if (selectedObjUid === obj.uid) {
                selectedObjUid = null;
            }
            
            const el = document.getElementById(obj.uid);
            if (el) el.remove();
            const startEl = document.getElementById(`start_${obj.uid}`);
            if (startEl) startEl.remove();
            const endEl = document.getElementById(`end_${obj.uid}`);
            if (endEl) endEl.remove();
            const pathEl = svgLayer.querySelector(`path[data-uid="${obj.uid}"]`);
            if (pathEl) pathEl.remove();
        } else {
            nextObjs.push(obj);
        }
    });

    if (modified) {
        timelineData[currentStepIndex] = nextObjs;
        erasedSomething = true;
        renderScene();
    }
}

function renderTimeline() {
    const container = document.getElementById('steps-container');
    container.innerHTML = "";
    timelineData.forEach((_, idx) => {
        const btn = document.createElement('button');
        btn.className = `step-btn ${idx === currentStepIndex ? 'active' : ''}`;
        btn.innerHTML = `<span class="step-number">${idx + 1}</span>`;
        btn.onclick = () => { 
            if (currentStepIndex !== idx) {
                triggerStepAnimation();
                currentStepIndex = idx; 
                renderScene(); 
            }
        };
        container.appendChild(btn);
    });
    const activeBtn = container.children[currentStepIndex];
    if(activeBtn) activeBtn.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
}

function addNewStep() {
    triggerStepAnimation();
    const keepLinesEl = document.getElementById('keep-lines-checkbox');
    const keepLines = keepLinesEl ? keepLinesEl.checked : false;
    let nextStepData = JSON.parse(JSON.stringify(timelineData[currentStepIndex] || []));

    if (!keepLines) {
        nextStepData = nextStepData.filter(o => o.type !== 'pen_stroke' && o.type !== 'free_arrow');
        nextStepData.forEach(o => {
            if (o.arrow) {
                o.arrow = { hasArrow: false, dx: 0, dy: 0 };
            }
        });
    }

    timelineData.splice(currentStepIndex + 1, 0, nextStepData);
    currentStepIndex++;
    if (selectedObjUid && !nextStepData.some(o => o.uid === selectedObjUid)) {
        selectedObjUid = null;
    }
    renderScene();
    recordHistory();
}

function toggleGhostView(enabled) {
    showGhostChampions = enabled;
    renderScene();
}

function clearDrawingsInCurrentStep() {
    const currentObjs = timelineData[currentStepIndex] || [];
    const hadDrawings = currentObjs.some(o => o.type === 'pen_stroke' || o.type === 'free_arrow' || (o.arrow && o.arrow.hasArrow));

    if (!hadDrawings) {
        showToast('지울 선이나 화살표가 없습니다.');
        return;
    }

    const nextObjs = currentObjs.filter(o => o.type !== 'pen_stroke' && o.type !== 'free_arrow');
    nextObjs.forEach(o => {
        if (o.arrow) {
            o.arrow = { hasArrow: false, dx: 0, dy: 0 };
        }
    });

    if (selectedObjUid && !nextObjs.some(o => o.uid === selectedObjUid)) {
        selectedObjUid = null;
    }

    timelineData[currentStepIndex] = nextObjs;
    mapEl.querySelectorAll('.arrow-control').forEach(el => el.remove());
    svgLayer.querySelectorAll('line:not(.ghost-line), path[data-uid]').forEach(l => l.remove());
    renderScene();
    recordHistory();
    showToast('🧹 현재 스텝의 선과 화살표를 지웠습니다.');
}

function deleteCurrentStep() {
    if (timelineData.length <= 1) { 
        resetCurrentStep();
        return; 
    }
    triggerStepAnimation();
    timelineData.splice(currentStepIndex, 1);
    if (currentStepIndex >= timelineData.length) {
        currentStepIndex = timelineData.length - 1;
    }
    // 기존 잔여 DOM 요소를 일괄 정리하여 렌더링 충돌 및 잔상 방지
    mapEl.querySelectorAll('.placed-object, .arrow-control').forEach(el => el.remove());
    svgLayer.querySelectorAll('line, path[data-uid]').forEach(l => l.remove());
    
    renderScene();
    recordHistory();
}

function deleteObject(uid) {
    timelineData[currentStepIndex] = timelineData[currentStepIndex].filter(o => o.uid !== uid);
    if (selectedObjUid === uid) {
        selectedObjUid = null;
    }
    const el = document.getElementById(uid);
    if (el) el.remove();
    const startEl = document.getElementById(`start_${uid}`);
    if (startEl) startEl.remove();
    const endEl = document.getElementById(`end_${uid}`);
    if (endEl) endEl.remove();
    
    // Delete path element if it is a stroke
    const pathEl = svgLayer.querySelector(`path[data-uid="${uid}"]`);
    if (pathEl) pathEl.remove();

    renderScene();
    recordHistory();
}

function clearSelection() {
    if (selectedObjUid) {
        const prevEl = document.getElementById(selectedObjUid);
        if (prevEl) prevEl.classList.remove('selected');
        const prevStartEl = document.getElementById(`start_${selectedObjUid}`);
        if (prevStartEl) prevStartEl.classList.remove('selected');
        selectedObjUid = null;
    }
}

function resetCurrentStep() {
    timelineData[currentStepIndex] = []; 
    // 잔여 DOM 강제 정리로 초기화 오작동 원천 차단
    mapEl.querySelectorAll('.placed-object, .arrow-control').forEach(el => el.remove());
    svgLayer.querySelectorAll('line, path[data-uid]').forEach(l => l.remove());
    renderScene(); 
    recordHistory();
}

function prevStep() {
    if (currentStepIndex > 0) {
        triggerStepAnimation();
        currentStepIndex--;
        renderScene();
    }
}

function nextStep() {
    if (currentStepIndex < timelineData.length - 1) {
        triggerStepAnimation();
        currentStepIndex++;
        renderScene();
    }
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
        else if (obj.type === 'ping' || obj.type === 'ward' || obj.type === 'object') renderDOM(obj, 'placed-object placed-icon');
        else if (obj.type === 'free_arrow') renderStartCtrl(obj);
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
        if (obj.champId && obj.champId !== "Poro") {
            const imgUrl = obj.champId === "Locke" ? "images/Locke.png" : `https://ddragon.leagueoflegends.com/cdn/${currentVersion}/img/champion/${obj.champId}.png`;
            ghostEl.style.backgroundImage = `url(${imgUrl})`;
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
    let el = document.getElementById(obj.uid);
    const desiredSrc = obj.type === 'champion'
        ? (obj.champId && obj.champId !== "Poro"
            ? (obj.champId === "Locke"
                ? "images/Locke.png"
                : `https://ddragon.leagueoflegends.com/cdn/${currentVersion || '14.24.1'}/img/champion/${obj.champId}.png`)
            : "__poro__")
        : (obj.src || "");

    if (!el) {
        // DOM 생성
        el = document.createElement(obj.type === 'champion' ? 'div' : 'img');
        el.id = obj.uid;
        el.className = className;
        el.draggable = false;
        // 클릭 이벤트 바인딩
        el.addEventListener('click', (e) => {
            e.stopPropagation();
            clearSelection();
            const targetObj = el._dataObj || obj;
            selectedObjUid = targetObj.uid;
            el.classList.add('selected');
            renderArrows();
        });
        // 더블클릭 시 캠프/오브젝트는 반투명 토글, 챔피언은 테두리 진영 순환(흰색 -> 블루 -> 레드)
        el.addEventListener('dblclick', (e) => {
            e.preventDefault();
            e.stopPropagation();
            const targetObj = el._dataObj;
            if (!targetObj) return;
            if (targetObj.type === 'champion') {
                const cur = resolveChampionTeam(targetObj);
                const next = cur === null ? 'blue' : (cur === 'blue' ? 'red' : 'none');
                targetObj.team = next;
                renderScene();
                recordHistory();
                const label = next === 'blue' ? '🔵 블루 테두리' : (next === 'red' ? '🔴 레드 테두리' : '⚪ 기본(하얀색) 테두리');
                showToast(`테두리 변경: ${label}`);
                return;
            }
            targetObj.dimmed = !targetObj.dimmed;
            renderScene();
            recordHistory();
        });
        // 이벤트 등록 (최초 1회)
        addDragEvents(el); 
        mapEl.appendChild(el);
    }

    if (el.dataset.renderSrc !== desiredSrc) {
        el.dataset.renderSrc = desiredSrc;
        if (obj.type === 'champion') {
            if (desiredSrc !== "__poro__") {
                el.style.backgroundImage = `url(${desiredSrc})`;
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

    // [핵심] DOM 요소에 '현재 스텝의 데이터 객체'를 연결하여 최신 상태 유지
    el._dataObj = obj;

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

    // 선택 상태 클래스 처리
    if (obj.uid === selectedObjUid) {
        el.classList.add('selected');
    } else {
        el.classList.remove('selected');
    }

    el.classList.toggle('dimmed', Boolean(obj.dimmed));

    // 챔피언 / 미니언 / 오브젝트 별 실시간 크기 적용
    const baseSize = obj.type === 'champion'
        ? champIconSize
        : (obj.type === 'minion' ? minionIconSize : objectIconSize);
    el.style.width = baseSize + "px";
    el.style.height = baseSize + "px";

    // 드래그 중이 아니면 위치 업데이트
    if(!el.classList.contains('dragging')) {
        el.style.left = obj.x + "px";
        el.style.top = obj.y + "px";
    }
}

function renderStartCtrl(obj) {
    const id = `start_${obj.uid}`;
    let el = document.getElementById(id);
    if(!el) {
        el = document.createElement('div');
        el.id = id;
        el.className = 'arrow-control start';
        el.draggable = false;
        el.addEventListener('click', (e) => {
            e.stopPropagation();
            clearSelection();
            const targetObj = el._dataObj || obj;
            selectedObjUid = targetObj.uid;
            el.classList.add('selected');
            renderArrows();
        });
        addDragEvents(el);
        mapEl.appendChild(el);
    }
    // [핵심] 최신 데이터 연결
    el._dataObj = obj;

    // 선택 상태 클래스 처리
    if (obj.uid === selectedObjUid) {
        el.classList.add('selected');
        el.classList.add('visible');
    } else {
        el.classList.remove('selected');
        el.classList.remove('visible');
    }

    // 고정 크기 지정
    el.style.width = "14px";
    el.style.height = "14px";

    if(!el.classList.contains('dragging')) {
        el.style.left = obj.x + "px";
        el.style.top = obj.y + "px";
    }
}

function addDragEvents(el) {
    el.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        if (draggedDistance > 5) {
            return;
        }
        const obj = el._dataObj;
        showContextMenu(e.clientX, e.clientY, obj.uid);
    });
}

function allowDrop(ev) { ev.preventDefault(); }

function drop(ev) {
    ev.preventDefault();
    const mapRect = mapEl.getBoundingClientRect();
    const borderOffset = 2 * zoomLevel;
    let x = (ev.clientX - mapRect.left - borderOffset) / zoomLevel;
    let y = (ev.clientY - mapRect.top - borderOffset) / zoomLevel;
    x = Math.max(0, Math.min(x, MAP_BASE_WIDTH));
    y = Math.max(0, Math.min(y, MAP_BASE_HEIGHT));

    let dragData = window.currentDragData;

    if (!dragData) {
        const rawData = ev.dataTransfer.getData("text/plain");
        try {
            if (rawData) {
                dragData = JSON.parse(rawData);
            }
        } catch (e) {
            console.warn("Failed to parse drag data as JSON, falling back to legacy keys.", e);
        }
    }

    // 폴백 처리
    const dragType = (dragData && dragData.dragType) || ev.dataTransfer.getData("dragType");
    const uid = (dragData && dragData.uid) || ev.dataTransfer.getData("uid");
    const champId = (dragData && dragData.champId) || ev.dataTransfer.getData("champId");
    const iconSrc = (dragData && dragData.iconSrc) || ev.dataTransfer.getData("iconSrc");
    const team = (dragData && dragData.team) || ev.dataTransfer.getData("team");

    let modified = false;

    if (dragType === "new-champion") {
        const inferredTeam = team || (bluePreset.includes(champId) ? 'blue' : (redPreset.includes(champId) ? 'red' : undefined));
        timelineData[currentStepIndex].push({
            type: 'champion',
            uid: "champ_" + Date.now() + "_" + Math.random().toString(36).substr(2, 5),
            champId: champId,
            team: inferredTeam,
            x: x, y: y,
            arrow: { hasArrow: false, dx: 0, dy: 0 }
        });
        modified = true;
    } else if (dragType === "new-ping" || dragType === "new-ward" || dragType === "new-object") {
        let type = "ward";
        if (dragType === "new-ping") type = "ping";
        else if (dragType === "new-object") {
            if (champId && champId.startsWith("minion")) {
                type = "minion";
            } else if (iconSrc && (iconSrc.includes("Minion_Melee_Render") || iconSrc.includes("minion"))) {
                type = "minion";
            } else {
                type = "object";
            }
        }
        
        // 미니언 진영 구분
        let minionType = undefined;
        if (type === "minion") {
            if (champId && champId.startsWith("minion")) minionType = champId;
            else if (iconSrc && iconSrc.includes("Chaos_Minion")) minionType = "minion-red";
            else minionType = "minion-blue";
        }
        
        timelineData[currentStepIndex].push({
            type: type,
            uid: type + "_" + Date.now() + "_" + Math.random().toString(36).substr(2, 5),
            src: iconSrc,
            x: x, y: y,
            minionType: minionType,
            arrow: { hasArrow: false, dx: 0, dy: 0 }
        });
        modified = true;

    } else if (dragType === "preset-team") {
        const list = team === 'blue' ? bluePreset : redPreset;
        
        if (list.length === 0) {
            showToast("⚠️ 프리셋에 등록된 챔피언이 없습니다.");
            return;
        }
        
        list.forEach((champKey, idx) => {
            const offsetX = (idx - (list.length - 1) / 2) * 50;
            const targetX = Math.max(0, Math.min(MAP_BASE_WIDTH, x + offsetX));
            const targetY = y;
            
            const champUid = "champ_" + champKey;
            const currentObjs = timelineData[currentStepIndex];
            const existing = currentObjs.find(o =>
                o.uid === champUid ||
                (o.type === 'champion' && o.champId === champKey && resolveChampionTeam(o) === team)
            );
            
            if (existing) {
                existing.x = targetX;
                existing.y = targetY;
                existing.team = team;
            } else {
                currentObjs.push({
                    type: 'champion',
                    uid: champUid,
                    champId: champKey,
                    team: team,
                    x: targetX, y: targetY,
                    arrow: { hasArrow: false, dx: 0, dy: 0 }
                });
            }
        });
        modified = true;
    }

    // 드래그 데이터 초기화
    window.currentDragData = null;

    if (modified) {
        renderScene();
        recordHistory();
    }
}

// --- Arrow Rendering ---
function renderArrows() {
    const currentObjs = timelineData[currentStepIndex];
    const activeUids = currentObjs.filter(o => o.arrow && o.arrow.hasArrow).map(o => o.uid);
    
    svgLayer.querySelectorAll('line:not(.ghost-line)').forEach(l => {
        if(!activeUids.includes(l.getAttribute('data-uid'))) l.remove();
    });
    mapEl.querySelectorAll('.arrow-control.end').forEach(c => {
        const p = c.getAttribute('data-parent');
        const obj = currentObjs.find(o => o.uid === p);
        if(!obj || !obj.arrow.hasArrow) c.remove();
    });

    currentObjs.forEach(obj => {
        if(obj.arrow && obj.arrow.hasArrow) renderSingleArrow(obj);
    });
}

function renderSingleArrow(obj) {
    let line = svgLayer.querySelector(`line[data-uid="${obj.uid}"]`);
    if (!line) {
        line = document.createElementNS("http://www.w3.org/2000/svg", "line");
        line.setAttribute("data-uid", obj.uid);
        line.setAttribute("stroke", "#ff5252");
        line.setAttribute("stroke-width", "3");
        line.setAttribute("stroke-linecap", "butt");
        line.setAttribute("marker-end", "url(#arrowhead)");
        line.style.opacity = "0.8";
        
        // 화살표 선 클릭 이벤트
        line.addEventListener('click', (e) => {
            e.stopPropagation();
            clearSelection();
            selectedObjUid = obj.uid;
            renderScene();
        });

        svgLayer.appendChild(line);
    }
    line.setAttribute("x1", obj.x); line.setAttribute("y1", obj.y);
    line.setAttribute("x2", obj.x + obj.arrow.dx); line.setAttribute("y2", obj.y + obj.arrow.dy);
    line.setAttribute("stroke-width", "3");

    // 선택 표시 동기화
    if (obj.uid === selectedObjUid) {
        line.classList.add('selected');
    } else {
        line.classList.remove('selected');
    }

    let end = document.getElementById(`end_${obj.uid}`);
    if(!end) {
        end = document.createElement('div');
        end.className = 'arrow-control end';
        end.id = `end_${obj.uid}`;
        end.setAttribute('data-parent', obj.uid);
        end.draggable = false;
        
        // 화살표 끝 제어점 클릭 이벤트
        end.addEventListener('click', (e) => {
            e.stopPropagation();
            clearSelection();
            selectedObjUid = obj.uid;
            renderScene();
        });
        
        mapEl.appendChild(end);
    }

    // 최신 데이터 객체를 DOM 엘리먼트에 바인딩
    end._dataObj = obj;
    line._dataObj = obj;

    if (end) {
        if (obj.uid === selectedObjUid) {
            end.classList.add('selected');
            end.classList.add('visible');
        } else {
            end.classList.remove('selected');
            end.classList.remove('visible');
        }
    }

    // 고정 제어점 크기 지정
    end.style.width = "12px";
    end.style.height = "12px";

    if(!end.classList.contains('dragging')) {
        end.style.left = (obj.x + obj.arrow.dx) + "px";
        end.style.top = (obj.y + obj.arrow.dy) + "px";
    }
}

function updateArrowLine(obj) {
    const line = document.querySelector(`line[data-uid="${obj.uid}"]`);
    if(line && obj.arrow) {
        line.setAttribute("x1", obj.x); line.setAttribute("y1", obj.y);
        line.setAttribute("x2", obj.x + obj.arrow.dx); line.setAttribute("y2", obj.y + obj.arrow.dy);
        line.setAttribute("stroke-width", "3");
    }
    const end = document.getElementById(`end_${obj.uid}`);
    if(end && obj.arrow) {
        end.style.left = (obj.x + obj.arrow.dx) + "px";
        end.style.top = (obj.y + obj.arrow.dy) + "px";
    }
}

// --- Context Menu ---
function showContextMenu(x, y, uid) {
    contextTargetUid = uid;
    contextMenu.style.display = 'block';
    contextMenu.style.left = x + 'px';
    contextMenu.style.top = y + 'px';
    const obj = timelineData[currentStepIndex].find(o => o.uid === uid);
    if (!obj) return;
    const teamMenu = document.getElementById('menu-team-group');
    if (teamMenu) {
        teamMenu.style.display = obj.type === 'champion' ? 'flex' : 'none';
    }
    const arrowMenu = document.getElementById('menu-add-arrow');
    if (obj.type === 'free_arrow' || obj.type === 'pen_stroke') {
        arrowMenu.style.display = 'none';
    } else {
        arrowMenu.style.display = 'block';
        arrowMenu.innerText = (obj.arrow && obj.arrow.hasArrow) ? "➤ 화살표 제거" : "➤ 화살표 추가";
    }
}

function setContextChampionTeam(teamVal) {
    if (!contextTargetUid) return;
    const obj = timelineData[currentStepIndex].find(o => o.uid === contextTargetUid);
    if (!obj || obj.type !== 'champion') return;
    obj.team = teamVal;
    contextMenu.style.display = 'none';
    contextTargetUid = null;
    renderScene();
    recordHistory();
}
document.addEventListener('click', () => { contextMenu.style.display = 'none'; contextTargetUid = null; });
document.getElementById('menu-delete').addEventListener('click', () => {
    if (contextTargetUid) {
        deleteObject(contextTargetUid);
    }
});
document.getElementById('menu-add-arrow').addEventListener('click', () => {
    if (contextTargetUid) {
        const obj = timelineData[currentStepIndex].find(o => o.uid === contextTargetUid);
        if (obj && obj.type !== 'free_arrow') {
            if (!obj.arrow) obj.arrow = { hasArrow: false, dx: 0, dy: 0 };
            obj.arrow.hasArrow = !obj.arrow.hasArrow;
            if (obj.arrow.hasArrow) { 
                obj.arrow.dx = 60; 
                obj.arrow.dy = 0; 
                selectedObjUid = obj.uid; // 화살표 추가 시 해당 챔피언을 바로 선택 상태로 지정하여 조절점 활성화
            } else {
                if (selectedObjUid === obj.uid) {
                    selectedObjUid = null;
                }
            }
            renderScene();
            recordHistory();
        }
    }
});

document.addEventListener('keydown', (e) => {
    if (isTutorialActive) {
        if (e.code === 'Escape') {
            e.preventDefault();
            endTutorial();
        } else if (e.code === 'ArrowRight' || e.code === 'Enter') {
            e.preventDefault();
            nextTutorialStep();
        } else if (e.code === 'ArrowLeft') {
            e.preventDefault();
            prevTutorialStep();
        }
        return;
    }

    const ioModal = document.getElementById('io-modal');
    if (ioModal && ioModal.classList.contains('active')) {
        if (e.code === 'Escape') {
            e.preventDefault();
            hideExportImportModal();
        }
        return;
    }

    const helpModal = document.getElementById('help-modal');
    if (helpModal && helpModal.classList.contains('active')) {
        if (e.code === 'Escape') {
            e.preventDefault();
            hideHelpModal();
        }
        return;
    }

    // 텍스트 입력 필드(검색창, 닉네임 입력 등)에서만 단축키를 방지 (range 슬라이더 등은 제외)
    const isTyping = e.target.tagName === 'TEXTAREA' || 
                     (e.target.tagName === 'INPUT' && (e.target.type === 'text' || e.target.type === 'search' || !e.target.type));
    if (isTyping) return;

    // Delete / Backspace 키로 오브젝트 삭제
    if (e.code === 'Delete' || e.code === 'Backspace') {
        if (selectedObjUid) {
            e.preventDefault();
            deleteObject(selectedObjUid);
        }
    }

    // Undo / Redo
    if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ') {
        e.preventDefault();
        if (e.shiftKey) redo(); else undo();
    }
    if ((e.ctrlKey || e.metaKey) && e.code === 'KeyY') {
        e.preventDefault();
        redo();
    }
    // 왼쪽 방향키: 이전 Step 이동
    if (e.code === 'ArrowLeft') {
        e.preventDefault();
        prevStep();
    }
    // 오른쪽 방향키: 다음 Step 이동
    if (e.code === 'ArrowRight') {
        e.preventDefault();
        nextStep();
    }

    // 도구 단축키 (1: 선택, 2: 펜, 3: 화살표, 4: 지우개, C: 선만 지우기)
    if (!e.ctrlKey && !e.metaKey && !e.altKey) {
        if (e.code === 'Digit1') {
            e.preventDefault();
            setDrawingTool('select');
        } else if (e.code === 'Digit2') {
            e.preventDefault();
            setDrawingTool('pen');
        } else if (e.code === 'Digit3') {
            e.preventDefault();
            setDrawingTool('arrow');
        } else if (e.code === 'Digit4') {
            e.preventDefault();
            setDrawingTool('eraser');
        } else if (e.code === 'KeyC') {
            e.preventDefault();
            clearDrawingsInCurrentStep();
        }
    }
});

function showHelpModal() {
    const modal = document.getElementById('help-modal');
    if (modal) modal.classList.add('active');
}

function hideHelpModal() {
    const modal = document.getElementById('help-modal');
    if (modal) modal.classList.remove('active');
}

window.addEventListener('click', (e) => {
    const modal = document.getElementById('help-modal');
    if (modal && e.target === modal) {
        hideHelpModal();
    }
    const ioModal = document.getElementById('io-modal');
    if (ioModal && e.target === ioModal) {
        hideExportImportModal();
    }
});

// 기본 정글 캠프 고정 좌표 (추후 사용자가 저장한 JSON으로 덮어쓸 수 있도록 대비)
let defaultCampPositions = [
    {
        "type": "object",
        "src": "https://raw.communitydragon.org/latest/game/assets/characters/sru_blue/hud/bluesentinel_circle.png",
        "x": 404,
        "y": 317
    },
    {
        "type": "object",
        "src": "https://raw.communitydragon.org/latest/game/assets/characters/sru_red/hud/brambleback_circle.png",
        "x": 615,
        "y": 492
    },
    {
        "type": "object",
        "src": "images/Gromp_Render.png",
        "x": 328,
        "y": 294
    },
    {
        "type": "object",
        "src": "images/Gromp_Render.png",
        "x": 878,
        "y": 386
    },
    {
        "type": "object",
        "src": "images/Greater_Murk_Wolf_Render.png",
        "x": 770,
        "y": 300
    },
    {
        "type": "object",
        "src": "https://raw.communitydragon.org/latest/game/assets/characters/sru_blue/hud/bluesentinel_circle.png",
        "x": 783,
        "y": 353
    },
    {
        "type": "object",
        "src": "https://raw.communitydragon.org/latest/game/assets/characters/sru_red/hud/brambleback_circle.png",
        "x": 569,
        "y": 198
    },
    {
        "type": "object",
        "src": "images/Crimson_Raptor_Render.png",
        "x": 609,
        "y": 252
    },
    {
        "type": "object",
        "src": "images/Ancient_Krug_Render.png",
        "x": 539,
        "y": 153
    },
    {
        "type": "object",
        "src": "images/Crimson_Raptor_Render.png",
        "x": 573,
        "y": 426
    },
    {
        "type": "object",
        "src": "images/Ancient_Krug_Render.png",
        "x": 656,
        "y": 564
    },
    {
        "type": "object",
        "src": "images/Rift_Scuttler_Render.png",
        "x": 768,
        "y": 442
    },
    {
        "type": "object",
        "src": "images/Rift_Scuttler_Render.png",
        "x": 428,
        "y": 246
    },
    {
        "type": "object",
        "src": "images/Greater_Murk_Wolf_Render.png",
        "x": 397,
        "y": 376
    }
];

// localStorage에서 저장된 정글 캠프 좌표 로드
function loadCampPositionsFromStorage() {
    const data = localStorage.getItem('lol_strategy_jungle_camps');
    if (data) {
        try {
            return JSON.parse(data);
        } catch(e) {
            console.error("Failed to load jungle camps from storage", e);
        }
    }
    return defaultCampPositions;
}

// 현재 배치된 정글 몬스터(버프 및 캠프몹) 좌표 저장
function saveCampPositions() {
    const currentObjs = timelineData[currentStepIndex] || [];
    const jungleCamps = currentObjs.filter(o => {
        if (o.type === 'object') {
            const src = o.src ? o.src.toLowerCase() : '';
            return src.includes('gromp') || 
                   src.includes('wolf') || 
                   src.includes('raptor') || 
                   src.includes('krug') || 
                   src.includes('scuttler') || 
                   src.includes('blue') || 
                   src.includes('red');
        }
        return false;
    });

    if (jungleCamps.length === 0) {
        alert("맵 위에 배치된 정글 몬스터(돌거북, 칼날부리, 늑대, 두꺼비, 블루/레드 버프)가 없습니다. 먼저 몬스터를 배치해 주세요.");
        return;
    }

    const campData = jungleCamps.map(o => ({
        type: o.type,
        src: o.src,
        minionType: o.minionType,
        dimmed: Boolean(o.dimmed),
        x: Math.round(o.x),
        y: Math.round(o.y)
    }));

    localStorage.setItem('lol_strategy_jungle_camps', JSON.stringify(campData));
    
    console.log("=== 저장된 정글 캠프 좌표 JSON 데이터 ===");
    console.log(JSON.stringify(campData, null, 4));
    console.log("=====================================");

    navigator.clipboard.writeText(JSON.stringify(campData, null, 4)).then(() => {
        alert(`총 ${campData.length}개의 정글 몬스터 좌표가 브라우저 저장소에 보관되었으며, 클립보드에 JSON 데이터가 복사되었습니다!\n\n개발자 도구(F12) 콘솔 창에서도 확인 및 복사가 가능합니다.`);
    }).catch(err => {
        alert(`총 ${campData.length}개의 정글 몬스터 좌표가 브라우저 저장소에 보관되었습니다. (클립보드 복사는 실패했습니다: ${err})`);
    });
}

// 저장된 모든 캠프 일괄 젠
function spawnAllCamps() {
    const camps = loadCampPositionsFromStorage();
    if (camps.length === 0) {
        alert("저장된 캠프 좌표 데이터가 없습니다. 먼저 정글 몬스터들을 맵에 배치하고 '캠프 배치 저장'을 실행해 주세요.");
        return;
    }

    const nowObjs = timelineData[currentStepIndex] || [];
    const isJungleCampObj = (o) => {
        if (!o || o.type !== 'object') return false;
        const src = o.src ? o.src.toLowerCase() : '';
        return src.includes('gromp') || 
               src.includes('wolf') || 
               src.includes('raptor') || 
               src.includes('krug') || 
               src.includes('scuttler') || 
               src.includes('blue') || 
               src.includes('red');
    };
    
    // 기존 맵 위의 정글 몹 및 잔여 선택/화살표 컨트롤 정리
    const nonJungleObjs = [];
    nowObjs.forEach(o => {
        if (isJungleCampObj(o)) {
            if (selectedObjUid === o.uid) {
                selectedObjUid = null;
            }
            const el = document.getElementById(o.uid);
            if (el) el.remove();
            const startEl = document.getElementById(`start_${o.uid}`);
            if (startEl) startEl.remove();
            const endEl = document.getElementById(`end_${o.uid}`);
            if (endEl) endEl.remove();
            const lineEl = svgLayer.querySelector(`line[data-uid="${o.uid}"]`);
            if (lineEl) lineEl.remove();
        } else {
            nonJungleObjs.push(o);
        }
    });

    const newCamps = camps.map((camp, idx) => ({
        type: camp.type || 'object',
        uid: `monster_camp_${idx}`,
        src: camp.src,
        x: camp.x,
        y: camp.y,
        minionType: camp.minionType,
        dimmed: Boolean(camp.dimmed),
        arrow: { hasArrow: false, dx: 0, dy: 0 }
    }));

    timelineData[currentStepIndex] = [...nonJungleObjs, ...newCamps];
    
    renderScene();
    recordHistory();
    showToast(`🌲 총 ${newCamps.length}개의 정글 몬스터가 일괄 젠되었습니다.`);
}

let isSyncScheduled = false;
let pendingForceBgSync = false;
let lastSyncedScreenshotId = undefined;
let screenshotsCache = null;

function syncObsScene(immediate = false, forceBgSync = false) {
    if (forceBgSync) pendingForceBgSync = true;

    const runSync = () => {
        const shouldForceBg = forceBgSync || pendingForceBgSync;
        pendingForceBgSync = false;

        const mapArea = document.getElementById('map-area');
        let viewportData = null;
        
        if (mapArea) {
            const W = mapArea.clientWidth;
            const H = mapArea.clientHeight;
            const scrollLeft = mapArea.scrollLeft;
            const scrollTop = mapArea.scrollTop;
            
            const mapW = MAP_BASE_WIDTH * zoomLevel;
            const mapH = MAP_BASE_HEIGHT * zoomLevel;
            
            let mapCenterX, mapCenterY;
            
            if (mapW <= W) {
                mapCenterX = MAP_BASE_WIDTH / 2;
            } else {
                mapCenterX = (scrollLeft + W / 2) / zoomLevel;
            }
            
            if (mapH <= H) {
                mapCenterY = MAP_BASE_HEIGHT / 2;
            } else {
                mapCenterY = (scrollTop + H / 2) / zoomLevel;
            }
            
            viewportData = {
                mapCenterX: mapCenterX,
                mapCenterY: mapCenterY
            };
        }

        let activeScreenshotDataUrl = undefined;
        if (shouldForceBg || selectedScreenshotId !== lastSyncedScreenshotId) {
            const list = getScreenshotsFromStorage();
            const activeScr = list.find(s => s.id === selectedScreenshotId);
            activeScreenshotDataUrl = activeScr ? activeScr.dataUrl : null;
            lastSyncedScreenshotId = selectedScreenshotId;
        }
        
        sendToObs({
            type: 'sync-scene',
            timelineData: timelineData,
            currentStepIndex: currentStepIndex,
            myTeamSide: myTeamSide,
            bluePreset: bluePreset,
            redPreset: redPreset,
            zoomLevel: zoomLevel,
            champIconSize: champIconSize,
            minionIconSize: minionIconSize,
            objectIconSize: objectIconSize,
            currentVersion: currentVersion,
            viewport: viewportData,
            currentMode: currentMode,
            selectedScreenshotId: selectedScreenshotId,
            activeScreenshotDataUrl: activeScreenshotDataUrl,
            showGhostChampions: showGhostChampions
        });
    };

    if (immediate) {
        runSync();
    } else {
        if (isSyncScheduled) return;
        isSyncScheduled = true;
        requestAnimationFrame(() => {
            isSyncScheduled = false;
            runSync();
        });
    }
}

function syncObsViewport() {
    const mapArea = document.getElementById('map-area');
    let viewportData = null;
    
    if (mapArea) {
        const W = mapArea.clientWidth;
        const H = mapArea.clientHeight;
        const scrollLeft = mapArea.scrollLeft;
        const scrollTop = mapArea.scrollTop;
        
        const mapW = MAP_BASE_WIDTH * zoomLevel;
        const mapH = MAP_BASE_HEIGHT * zoomLevel;
        
        let mapCenterX, mapCenterY;
        
        if (mapW <= W) {
            mapCenterX = MAP_BASE_WIDTH / 2;
        } else {
            mapCenterX = (scrollLeft + W / 2) / zoomLevel;
        }
        
        if (mapH <= H) {
            mapCenterY = MAP_BASE_HEIGHT / 2;
        } else {
            mapCenterY = (scrollTop + H / 2) / zoomLevel;
        }
        
        viewportData = {
            mapCenterX: mapCenterX,
            mapCenterY: mapCenterY
        };
    }
    
    sendToObs({
        type: 'sync-viewport',
        zoomLevel: zoomLevel,
        viewport: viewportData
    });
}

function openObsWindow() {
    window.open('obs.html', 'LoLStrategyBoardOBS', 'width=1220,height=820,scrollbar=no,status=no,toolbar=no');
}

function copyObsUrl() {
    const url = window.location.origin + '/obs.html';
    navigator.clipboard.writeText(url).then(() => {
        alert("OBS 소스 URL이 클립보드에 복사되었습니다: " + url);
    }).catch(err => {
        alert("클립보드 복사에 실패했습니다. 다음 주소를 수동 복사하세요:\n" + url);
    });
}

// --- 스크린샷 모드 관련 기능 ---
function getScreenshotsFromStorage() {
    if (screenshotsCache !== null) {
        return screenshotsCache;
    }
    const data = localStorage.getItem('lol_strategy_screenshots');
    if (data) {
        try {
            screenshotsCache = JSON.parse(data);
            return screenshotsCache;
        } catch(e) {
            screenshotsCache = [];
            return [];
        }
    }
    screenshotsCache = [];
    return [];
}

function saveScreenshotsToStorage(list) {
    try {
        localStorage.setItem('lol_strategy_screenshots', JSON.stringify(list));
        screenshotsCache = list;
        return true;
    } catch(e) {
        alert("브라우저 저장 용량이 부족하여 스크린샷을 저장할 수 없습니다.\n기존 스크린샷을 삭제한 후 다시 시도해 주세요.");
        return false;
    }
}

function setAppMode(mode) {
    currentMode = mode;
    
    const mapBtn = document.getElementById('mode-select-map');
    const screenshotBtn = document.getElementById('mode-select-screenshot');
    const structureLayer = document.getElementById('structure-layer');
    const placeholder = document.getElementById('screenshot-placeholder');
    const mapEl = document.getElementById('rift-map');
    
    if (mode === 'map') {
        // 맵 모드 활성화 스타일
        if (mapBtn) {
            mapBtn.style.borderColor = 'var(--accent-color)';
            mapBtn.style.boxShadow = '0 0 5px var(--accent-color)';
            mapBtn.style.opacity = '1';
        }
        if (screenshotBtn) {
            screenshotBtn.style.borderColor = 'transparent';
            screenshotBtn.style.boxShadow = 'none';
            screenshotBtn.style.opacity = '0.6';
        }
        
        // 타워 레이어 보이기
        if (structureLayer) structureLayer.style.display = 'block';
        // placeholder 숨기기
        if (placeholder) placeholder.style.display = 'none';
        
        // 배경을 원래 소환사의 협곡 이미지로 복구
        if (mapEl) {
            mapEl.style.backgroundImage = 'url("images/Summoner\'s_Rift_map_s14.png")';
            mapEl.style.backgroundColor = 'transparent';
        }

        // 협곡 모드 복귀 시 스크린샷 탭에 머물러 있다면 챔피언 탭으로 자동 복귀
        const activeTab = document.querySelector('#sidebar-left .sidebar-tabs .tab-btn.active');
        if (activeTab && activeTab.id === 'tab-btn-screenshots') {
            switchLeftTab('champs');
        }
    } else {
        // 스크린샷 모드 활성화 스타일
        if (screenshotBtn) {
            screenshotBtn.style.borderColor = 'var(--accent-color)';
            screenshotBtn.style.boxShadow = '0 0 5px var(--accent-color)';
            screenshotBtn.style.opacity = '1';
        }
        if (mapBtn) {
            mapBtn.style.borderColor = 'transparent';
            mapBtn.style.boxShadow = 'none';
            mapBtn.style.opacity = '0.6';
        }
        
        // 타워 레이어 감추기
        if (structureLayer) structureLayer.style.display = 'none';
        
        const list = getScreenshotsFromStorage();
        // 선택된 스크린샷이 유효한지 확인하고 적용
        const activeScr = list.find(s => s.id === selectedScreenshotId);
        
        if (activeScr && mapEl) {
            if (placeholder) placeholder.style.display = 'none';
            mapEl.style.backgroundImage = `url(${activeScr.dataUrl})`;
            mapEl.style.backgroundColor = '#0f0f0f';
        } else {
            // 선택된 스크린샷이 없거나 비어있는 경우
            if (placeholder) placeholder.style.display = 'block';
            if (mapEl) {
                mapEl.style.backgroundImage = 'none';
                mapEl.style.backgroundColor = '#0f0f0f'; // 검은색 배경
            }
        }
        
        // 스크린샷 모드로 전환 시 사이드바 탭도 스크린샷 탭으로 동기화
        const activeTab = document.querySelector('#sidebar-left .sidebar-tabs .tab-btn.active');
        if (activeTab && activeTab.id !== 'tab-btn-screenshots') {
            switchLeftTab('screenshots');
        }
    }

    if (typeof syncObsScene === 'function') {
        syncObsScene();
    }
}

function handleScreenshotPaste(e) {
    const clipboardData = e.clipboardData || (e.originalEvent && e.originalEvent.clipboardData);
    if (!clipboardData || !clipboardData.items) return;

    const items = clipboardData.items;
    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.kind === 'file' && item.type.indexOf('image') !== -1) {
            const blob = item.getAsFile();
            const reader = new FileReader();
            reader.onload = function(event) {
                const dataUrl = event.target.result;
                addScreenshot(dataUrl);
            };
            reader.readAsDataURL(blob);
            break; // 이미지 하나만 처리
        }
    }
}

function addScreenshot(dataUrl) {
    const list = getScreenshotsFromStorage();
    const newScr = {
        id: "scr_" + Date.now() + "_" + Math.random().toString(36).substr(2, 5),
        name: "스크린샷 " + (list.length + 1),
        dataUrl: dataUrl
    };
    
    list.push(newScr);
    if (saveScreenshotsToStorage(list)) {
        selectedScreenshotId = newScr.id;
        renderScreenshots();
        setAppMode('screenshot');
    }
}

function selectScreenshot(id) {
    selectedScreenshotId = id;
    setAppMode('screenshot');
    renderScreenshots();
}

function deleteScreenshot(id, e) {
    if (e) e.stopPropagation();
    
    if (!confirm("이 스크린샷을 정말 삭제하시겠습니까?")) return;
    
    let list = getScreenshotsFromStorage();
    list = list.filter(s => s.id !== id);
    saveScreenshotsToStorage(list);
    
    if (selectedScreenshotId === id) {
        selectedScreenshotId = list.length > 0 ? list[list.length - 1].id : null;
    }
    
    renderScreenshots();
    setAppMode(currentMode);
}

function renameScreenshot(id, e) {
    if (e) e.stopPropagation();
    
    const list = getScreenshotsFromStorage();
    const item = list.find(s => s.id === id);
    if (!item) return;
    
    const newName = prompt("스크린샷 이름을 입력하세요:", item.name);
    if (newName === null) return;
    
    const trimmed = newName.trim();
    if (!trimmed) {
        alert("이름은 비워둘 수 없습니다.");
        return;
    }
    
    item.name = trimmed;
    saveScreenshotsToStorage(list);
    renderScreenshots();
}

function renderScreenshots() {
    const container = document.getElementById('saved-screenshots-list');
    if (!container) return;
    
    container.innerHTML = "";
    const list = getScreenshotsFromStorage();
    
    if (list.length === 0) {
        container.innerHTML = `<div style="color: #666; text-align: center; font-size: 12px; margin-top: 30px; font-weight: bold; line-height: 1.5; word-break: keep-all;">저장된 스크린샷이 없습니다.<br>스크린샷 모드에서 Ctrl+V를 눌러 붙여넣으세요.</div>`;
        return;
    }
    
    list.forEach(scr => {
        const itemEl = document.createElement('div');
        itemEl.style.background = '#252525';
        itemEl.style.border = scr.id === selectedScreenshotId ? '1.5px solid var(--accent-color)' : '1px solid #333';
        itemEl.style.boxShadow = scr.id === selectedScreenshotId ? '0 0 6px rgba(208, 184, 108, 0.4)' : 'none';
        itemEl.style.borderRadius = '6px';
        itemEl.style.padding = '8px';
        itemEl.style.display = 'flex';
        itemEl.style.alignItems = 'center';
        itemEl.style.gap = '10px';
        itemEl.style.cursor = 'pointer';
        itemEl.onclick = () => selectScreenshot(scr.id);
        
        // 썸네일 이미지
        const thumb = document.createElement('img');
        thumb.src = scr.dataUrl;
        thumb.style.width = '50px';
        thumb.style.height = '33px';
        thumb.style.objectFit = 'cover';
        thumb.style.borderRadius = '3px';
        thumb.style.border = '1px solid #444';
        itemEl.appendChild(thumb);
        
        // 텍스트 정보 (이름)
        const nameEl = document.createElement('span');
        nameEl.innerText = scr.name;
        nameEl.style.flexGrow = '1';
        nameEl.style.fontSize = '12px';
        nameEl.style.fontWeight = scr.id === selectedScreenshotId ? 'bold' : 'normal';
        nameEl.style.color = scr.id === selectedScreenshotId ? 'var(--accent-color)' : '#eee';
        nameEl.style.overflow = 'hidden';
        nameEl.style.textOverflow = 'ellipsis';
        nameEl.style.whiteSpace = 'nowrap';
        itemEl.appendChild(nameEl);
        
        // 관리용 버튼 그룹
        const btnGroup = document.createElement('div');
        btnGroup.style.display = 'flex';
        btnGroup.style.gap = '4px';
        
        // 이름 수정 버튼
        const editBtn = document.createElement('button');
        editBtn.className = 'tool-btn btn-green';
        editBtn.style.padding = '2px 5px';
        editBtn.style.fontSize = '10px';
        editBtn.innerText = '✏️';
        editBtn.title = '이름 변경';
        editBtn.onclick = (e) => renameScreenshot(scr.id, e);
        btnGroup.appendChild(editBtn);
        
        // 삭제 버튼
        const delBtn = document.createElement('button');
        delBtn.className = 'tool-btn btn-red';
        delBtn.style.padding = '2px 5px';
        delBtn.style.fontSize = '10px';
        delBtn.innerText = '✖';
        delBtn.title = '삭제';
        delBtn.onclick = (e) => deleteScreenshot(scr.id, e);
        btnGroup.appendChild(delBtn);
        
        itemEl.appendChild(btnGroup);
        container.appendChild(itemEl);
    });
}

function resolveChampionKey(item) {
    if (!item) return null;
    const rawKey = typeof item === 'string' ? item : item.id;
    const rawName = typeof item === 'string' ? item : item.name;

    if (rawKey && championData[rawKey]) return rawKey;
    if (rawName && championData[rawName]) return rawName;

    const entries = Object.entries(championData);
    if (rawKey != null) {
        const keyStr = String(rawKey);
        const byNumKey = entries.find(([, c]) => String(c.key) === keyStr);
        if (byNumKey) return byNumKey[0];
    }
    if (rawName) {
        const cleanTarget = String(rawName).replace(/\s+/g, '').toLowerCase();
        const byName = entries.find(([k, c]) =>
            k.toLowerCase() === cleanTarget ||
            (c.name && c.name.replace(/\s+/g, '').toLowerCase() === cleanTarget)
        );
        if (byName) return byName[0];
    }
    return null;
}

function checkAndApplyImportedChampions() {
    try {
        const saved = localStorage.getItem('gudo_imported_champions');
        if (!saved) return;
        const imported = JSON.parse(saved);
        const teamChamps = imported.teamChamps || [];

        if (teamChamps.length > 0) {
            bluePreset = teamChamps.slice(0, 5).map(resolveChampionKey).filter(Boolean);
            redPreset = teamChamps.slice(5, 10).map(resolveChampionKey).filter(Boolean);

            if (typeof renderPresetLists === 'function') {
                renderPresetLists();
            }
            if (typeof renderPresets === 'function') {
                renderPresets();
            }
            console.log("⚡ FOW 파싱 10명 챔피언 라인업 전략 보드 세팅 완료:", bluePreset, redPreset);
        }
        localStorage.removeItem('gudo_imported_champions');
    } catch (e) {
        console.warn('Imported strategy champions application error:', e);
    }
}

// 📱 모바일 반응형 사이드바 드로어 제어 함수
function toggleMobileSidebar(side) {
    const leftSidebar = document.getElementById('sidebar-left');
    const rightPanel = document.getElementById('right-panel-wrapper');
    const overlay = document.getElementById('sidebar-overlay');

    const target = side === 'left' ? leftSidebar : rightPanel;
    const other = side === 'left' ? rightPanel : leftSidebar;
    if (!target) return;

    // 드로어를 여닫을 때 햄버거 드롭다운은 항상 닫아 z-index 충돌 방지
    closeMobileDropdown();

    const isOpening = !target.classList.contains('open');
    if (other) other.classList.remove('open');
    target.classList.toggle('open', isOpening);
    if (overlay) overlay.classList.toggle('open', isOpening);
}

function closeMobileSidebars() {
    const leftSidebar = document.getElementById('sidebar-left');
    const rightPanel = document.getElementById('right-panel-wrapper');
    const overlay = document.getElementById('sidebar-overlay');

    if (leftSidebar) leftSidebar.classList.remove('open');
    if (rightPanel) rightPanel.classList.remove('open');
    if (overlay) overlay.classList.remove('open');

    // 오버레이 탭 한 번으로 드롭다운까지 함께 정리
    closeMobileDropdown();
}

// 🍔 모바일 햄버거 슬라이드 다운 드롭다운 메뉴 제어 함수
function toggleMobileDropdown() {
    const dropdown = document.getElementById('mobile-dropdown-menu');
    const btn = document.getElementById('mobile-hamburger-btn');
    if (!dropdown) return;

    const isOpening = !dropdown.classList.contains('open');

    // 드롭다운을 열 때 열려있는 사이드바 드로어와 오버레이를 먼저 정리
    if (isOpening) {
        const leftSidebar = document.getElementById('sidebar-left');
        const rightPanel = document.getElementById('right-panel-wrapper');
        const overlay = document.getElementById('sidebar-overlay');
        if (leftSidebar) leftSidebar.classList.remove('open');
        if (rightPanel) rightPanel.classList.remove('open');
        if (overlay) overlay.classList.remove('open');
    }

    dropdown.classList.toggle('open', isOpening);
    if (btn) btn.classList.toggle('open', isOpening);
}

function closeMobileDropdown() {
    const dropdown = document.getElementById('mobile-dropdown-menu');
    const btn = document.getElementById('mobile-hamburger-btn');
    if (dropdown) dropdown.classList.remove('open');
    if (btn) btn.classList.remove('open');
}

// 🔻 드롭다운 바깥(맵 포함)을 누르면 자동으로 닫기
// 맵의 touchstart 가 preventDefault 를 걸기 전에 처리되도록 pointerdown 캡처 단계에서 감지
document.addEventListener('pointerdown', (e) => {
    const dropdown = document.getElementById('mobile-dropdown-menu');
    if (!dropdown || !dropdown.classList.contains('open')) return;
    const target = e.target;
    if (!target || typeof target.closest !== 'function') return;
    if (target.closest('#mobile-dropdown-menu') || target.closest('#mobile-hamburger-btn')) return;
    closeMobileDropdown();
}, true);

// 📱 모바일 디바이스 접속 시 화면 폭에 맞춘 초기 맵 자동 피팅
function autoFitMobileMap() {
    if (window.innerWidth > 768) return;

    const mapArea = document.getElementById('map-area');
    if (!mapArea) return;

    const availableWidth = mapArea.clientWidth || (window.innerWidth - 10);
    const fitZoom = Math.max(MIN_ZOOM, Math.min(1.0, availableWidth / MAP_BASE_WIDTH));
    zoomLevel = parseFloat(fitZoom.toFixed(2));
    applyZoom();

    // 재맞춤 후 남아있던 스크롤 오프셋 제거 (resetZoom 과 동일 처리)
    mapArea.scrollLeft = 0;
    mapArea.scrollTop = 0;

    if (typeof syncObsViewport === 'function') {
        syncObsViewport();
    }
}

// 📱 터치 디바이스 핀치 줌 & 1손가락 부드러운 패닝 처리
function bindTouchEvents() {
    const mapArea = document.getElementById('map-area');
    const mapEl = document.getElementById('rift-map');
    if (!mapArea || !mapEl) return;

    // 이 이하로 움직이면 탭(선택)으로 간주하여 click 을 대신 발생시킨다
    const TAP_THRESHOLD = 8;

    let initialPinchDist = 0;
    let initialZoom = 1.0;
    let pinchMidX = 0;
    let pinchMidY = 0;
    let isPinching = false;

    let isTouchDragging = false;      // 합성 mousedown 을 실제로 보낸 상태인지
    let isTouchPanning = false;       // 선택 모드에서 배경 1손가락 패닝 중인지
    let touchDragTarget = null;
    let touchStartX = 0;
    let touchStartY = 0;
    let lastPanX = 0;
    let lastPanY = 0;
    let touchMovedDist = 0;
    let suppressUntilRelease = false; // 핀치가 1손가락으로 무너진 뒤 오작동 방지
    let lastTapTime = 0;
    let lastTapTarget = null;

    const dispatchMouse = (type, target, clientX, clientY) => {
        target.dispatchEvent(new MouseEvent(type, {
            clientX: clientX,
            clientY: clientY,
            button: 0,
            bubbles: true,
            cancelable: true
        }));
    };

    // 합성 mousedown 을 보냈을 때만 mouseup 을 짝지어 보낸다 (툴바 등 무관한 터치에는 무반응)
    const endTouchDrag = (clientX, clientY) => {
        if (isTouchPanning) {
            isTouchPanning = false;
            if (touchMovedDist < TAP_THRESHOLD && touchDragTarget) {
                dispatchMouse('click', touchDragTarget, clientX, clientY);
            }
            touchDragTarget = null;
            return;
        }
        if (!isTouchDragging) return;
        isTouchDragging = false;

        dispatchMouse('mouseup', window, clientX, clientY);

        // 거의 움직이지 않았다면 탭 → click(및 300ms 이내 연속 탭 시 dblclick) 발생
        if (touchMovedDist < TAP_THRESHOLD && touchDragTarget) {
            dispatchMouse('click', touchDragTarget, clientX, clientY);
            const now = Date.now();
            if (lastTapTarget === touchDragTarget && (now - lastTapTime) < 320) {
                dispatchMouse('dblclick', touchDragTarget, clientX, clientY);
                lastTapTime = 0;
                lastTapTarget = null;
            } else {
                lastTapTime = now;
                lastTapTarget = touchDragTarget;
            }
        }
        touchDragTarget = null;
    };

    const beginPinch = (touches) => {
        const t1 = touches[0];
        const t2 = touches[1];
        initialPinchDist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
        initialZoom = zoomLevel;
        pinchMidX = (t1.clientX + t2.clientX) / 2;
        pinchMidY = (t1.clientY + t2.clientY) / 2;
        isPinching = true;
    };

    mapEl.addEventListener('touchstart', (e) => {
        if (e.touches.length >= 2) {
            // ✌️ 2손가락: 진행 중이던 1손가락 드래그를 정리한 뒤 핀치 줌/패닝 시작
            const t = e.changedTouches[0];
            endTouchDrag(t ? t.clientX : touchStartX, t ? t.clientY : touchStartY);
            e.preventDefault();
            beginPinch(e.touches);
            return;
        }

        if (isPinching || suppressUntilRelease) return;

        // 👆 1손가락: preventDefault 로 브라우저 호환 마우스 이벤트(중복 실행)와 네이티브 스크롤을 차단
        e.preventDefault();

        const touch = e.touches[0];
        touchStartX = touch.clientX;
        touchStartY = touch.clientY;
        touchMovedDist = 0;
        touchDragTarget = touch.target;

        const isObjOrCtrl = touch.target && typeof touch.target.closest === 'function' &&
            (touch.target.closest('.placed-object') || touch.target.closest('.arrow-control'));

        if (activeTool === 'select' && !isObjOrCtrl) {
            // 선택 모드에서 빈 배경 터치 시 그리기 대신 1손가락 패닝으로 동작
            isTouchPanning = true;
            lastPanX = touch.clientX;
            lastPanY = touch.clientY;
            const isDrawableEl = touch.target && (touch.target.tagName === 'path' || touch.target.tagName === 'line' ||
                (typeof touch.target.closest === 'function' && (touch.target.closest('path') || touch.target.closest('line'))));
            if (!isDrawableEl) {
                clearSelection();
            }
            return;
        }

        isTouchDragging = true;
        dispatchMouse('mousedown', touch.target, touch.clientX, touch.clientY);
    }, { passive: false });

    window.addEventListener('touchmove', (e) => {
        if (isPinching && e.touches.length >= 2 && initialPinchDist > 0) {
            e.preventDefault();

            const t1 = e.touches[0];
            const t2 = e.touches[1];
            const currentDist = Math.hypot(t2.clientX - t1.clientX, t2.clientY - t1.clientY);
            const midX = (t1.clientX + t2.clientX) / 2;
            const midY = (t1.clientY + t2.clientY) / 2;

            // 🖐️ 먼저 2손가락 중점 이동량만큼 맵 패닝
            const movedX = midX - pinchMidX;
            const movedY = midY - pinchMidY;
            mapArea.scrollLeft -= movedX;
            mapArea.scrollTop -= movedY;
            pinchMidX = midX;
            pinchMidY = midY;

            // ✌️ 그 다음 핀치 중점을 앵커로 줌 (zoomToPoint 가 스크롤 보정 + OBS 동기화까지 수행)
            const targetZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, initialZoom * (currentDist / initialPinchDist)));
            if (Math.abs(targetZoom - zoomLevel) > 0.01) {
                zoomToPoint(parseFloat(targetZoom.toFixed(2)), midX, midY);
            } else if ((movedX || movedY) && typeof syncObsViewport === 'function') {
                syncObsViewport();
            }
            return;
        }

        if (isTouchPanning && e.touches.length === 1) {
            e.preventDefault();
            const touch = e.touches[0];
            touchMovedDist = Math.max(
                touchMovedDist,
                Math.hypot(touch.clientX - touchStartX, touch.clientY - touchStartY)
            );
            const movedX = touch.clientX - lastPanX;
            const movedY = touch.clientY - lastPanY;
            mapArea.scrollLeft -= movedX;
            mapArea.scrollTop -= movedY;
            lastPanX = touch.clientX;
            lastPanY = touch.clientY;
            if ((movedX || movedY) && typeof syncObsViewport === 'function') {
                syncObsViewport();
            }
            return;
        }

        if (isTouchDragging && e.touches.length === 1) {
            e.preventDefault();
            const touch = e.touches[0];
            touchMovedDist = Math.max(
                touchMovedDist,
                Math.hypot(touch.clientX - touchStartX, touch.clientY - touchStartY)
            );
            dispatchMouse('mousemove', window, touch.clientX, touch.clientY);
        }
    }, { passive: false });

    // 남은 손가락 수를 확인한 뒤에만 상태를 정리한다
    const handleTouchEnd = (e) => {
        const remaining = e.touches.length;
        const t = e.changedTouches[0];
        const clientX = t ? t.clientX : touchStartX;
        const clientY = t ? t.clientY : touchStartY;

        if (remaining >= 2) {
            // 아직 2손가락 이상이면 기준점만 다시 잡고 핀치를 유지
            if (isPinching) beginPinch(e.touches);
            return;
        }

        if (remaining === 1) {
            if (isPinching) {
                // 핀치 도중 한 손가락만 뗀 경우: 남은 손가락이 오작동하지 않도록 봉인
                isPinching = false;
                initialPinchDist = 0;
                suppressUntilRelease = true;
            }
            return;
        }

        // 모든 손가락이 떨어진 시점에만 드래그 종료 및 전체 상태 초기화
        endTouchDrag(clientX, clientY);
        isPinching = false;
        initialPinchDist = 0;
        suppressUntilRelease = false;
    };

    window.addEventListener('touchend', handleTouchEnd);
    window.addEventListener('touchcancel', handleTouchEnd);

    // 📱 화면 폭이 실제로 바뀐 경우에만 재맞춤한다.
    // 소프트 키보드 오픈 / URL 바 접힘처럼 높이만 변하는 resize 는 무시하여 사용자 줌을 보존
    let lastFitWidth = window.innerWidth;
    let resizeFitTimer = null;
    window.addEventListener('resize', () => {
        if (window.innerWidth === lastFitWidth) return;
        lastFitWidth = window.innerWidth;
        clearTimeout(resizeFitTimer);
        resizeFitTimer = setTimeout(autoFitMobileMap, 150);
    });
}

// ==========================================================================
// 🎓 단계별 인터랙티브 스포트라이트 튜토리얼
// ==========================================================================

let isTutorialActive = false;
let currentTutorialStepIdx = 0;
let tutorialPrevLeftTab = null;
let tutorialPrevRightTab = null;
let tutorialSavedBoardState = null;
let tutorialDemoTimer = null;

function createTutorialDemoSnapshot() {
    if (!currentVersion) {
        currentVersion = '14.24.1';
    }

    const step1 = [
        // 블루팀 5인 (team: 'blue', 리 신/쓰레쉬 이동 화살표 포함)
        { type: 'champion', uid: 'champ_demo_blue_top', champId: 'Gnar', team: 'blue', x: 338, y: 146, arrow: { hasArrow: false, dx: 0, dy: 0 } },
        { type: 'champion', uid: 'champ_demo_blue_jg', champId: 'LeeSin', team: 'blue', x: 678, y: 430, arrow: { hasArrow: true, dx: 48, dy: 28 } },
        { type: 'champion', uid: 'champ_demo_blue_mid', champId: 'Ahri', team: 'blue', x: 562, y: 336, arrow: { hasArrow: false, dx: 0, dy: 0 } },
        { type: 'champion', uid: 'champ_demo_blue_adc', champId: 'Jinx', team: 'blue', x: 838, y: 578, arrow: { hasArrow: false, dx: 0, dy: 0 } },
        { type: 'champion', uid: 'champ_demo_blue_sup', champId: 'Thresh', team: 'blue', x: 775, y: 518, arrow: { hasArrow: true, dx: -26, dy: -40 } },

        // 레드팀 5인 (team: 'red')
        { type: 'champion', uid: 'champ_demo_red_top', champId: 'Renekton', team: 'red', x: 392, y: 112, arrow: { hasArrow: false, dx: 0, dy: 0 } },
        { type: 'champion', uid: 'champ_demo_red_jg', champId: 'Viego', team: 'red', x: 762, y: 398, arrow: { hasArrow: false, dx: 0, dy: 0 } },
        { type: 'champion', uid: 'champ_demo_red_mid', champId: 'Orianna', team: 'red', x: 618, y: 294, arrow: { hasArrow: false, dx: 0, dy: 0 } },
        { type: 'champion', uid: 'champ_demo_red_adc', champId: 'Kaisa', team: 'red', x: 892, y: 526, arrow: { hasArrow: false, dx: 0, dy: 0 } },
        { type: 'champion', uid: 'champ_demo_red_sup', champId: 'Nautilus', team: 'red', x: 832, y: 466, arrow: { hasArrow: false, dx: 0, dy: 0 } },

        // 미지정 테두리(하얀색) 비교 예시 챔피언 (4단계에서 블루/레드/흰색 3종 테두리 확인용)
        { type: 'champion', uid: 'champ_demo_neutral_sylas', champId: 'Sylas', team: 'none', x: 492, y: 244, arrow: { hasArrow: false, dx: 0, dy: 0 } },

        // 정글 캠프 & 카정 반투명 예시 (defaultCampPositions 좌표 기반)
        { type: 'object', uid: 'obj_demo_blue_sentinel', src: 'https://raw.communitydragon.org/latest/game/assets/characters/sru_blue/hud/bluesentinel_circle.png', x: 404, y: 317, dimmed: false, arrow: { hasArrow: false, dx: 0, dy: 0 } },
        { type: 'object', uid: 'obj_demo_blue_bramble', src: 'https://raw.communitydragon.org/latest/game/assets/characters/sru_red/hud/brambleback_circle.png', x: 615, y: 492, dimmed: false, arrow: { hasArrow: false, dx: 0, dy: 0 } },
        { type: 'object', uid: 'obj_demo_red_bramble_dim', src: 'https://raw.communitydragon.org/latest/game/assets/characters/sru_red/hud/brambleback_circle.png', x: 569, y: 198, dimmed: true, arrow: { hasArrow: false, dx: 0, dy: 0 } },
        { type: 'object', uid: 'obj_demo_red_raptor_dim', src: 'images/Crimson_Raptor_Render.png', x: 609, y: 252, dimmed: true, arrow: { hasArrow: false, dx: 0, dy: 0 } },
        { type: 'object', uid: 'obj_demo_red_sentinel', src: 'https://raw.communitydragon.org/latest/game/assets/characters/sru_blue/hud/bluesentinel_circle.png', x: 783, y: 353, dimmed: false, arrow: { hasArrow: false, dx: 0, dy: 0 } },
        { type: 'object', uid: 'obj_demo_scuttler_bot', src: 'images/Rift_Scuttler_Render.png', x: 768, y: 442, dimmed: false, arrow: { hasArrow: false, dx: 0, dy: 0 } },

        // 에픽 몬스터 (드래곤 · 공허 유충)
        { type: 'object', uid: 'obj_demo_dragon', src: 'https://raw.communitydragon.org/latest/game/assets/ux/minimap/icons/dragon.png', x: 742, y: 470, dimmed: false, arrow: { hasArrow: false, dx: 0, dy: 0 } },
        { type: 'object', uid: 'obj_demo_grub', src: 'https://raw.communitydragon.org/latest/game/assets/ux/minimap/icons/grub.png', x: 454, y: 212, dimmed: false, arrow: { hasArrow: false, dx: 0, dy: 0 } },

        // 미드 · 바텀 미니언 웨이브
        { type: 'minion', uid: 'minion_demo_mid_blue', src: 'images/Order_Minion_Melee_Render.png', minionType: 'minion-blue', x: 575, y: 326, arrow: { hasArrow: false, dx: 0, dy: 0 } },
        { type: 'minion', uid: 'minion_demo_mid_red', src: 'images/Chaos_Minion_Melee_Render.png', minionType: 'minion-red', x: 598, y: 310, arrow: { hasArrow: false, dx: 0, dy: 0 } },
        { type: 'minion', uid: 'minion_demo_bot_blue', src: 'images/Order_Minion_Melee_Render.png', minionType: 'minion-blue', x: 856, y: 560, arrow: { hasArrow: false, dx: 0, dy: 0 } },
        { type: 'minion', uid: 'minion_demo_bot_red', src: 'images/Chaos_Minion_Melee_Render.png', minionType: 'minion-red', x: 878, y: 540, arrow: { hasArrow: false, dx: 0, dy: 0 } },

        // 강가 시야 장악 와드 (제어 와드 · 노랑 와드)
        { type: 'ward', uid: 'ward_demo_control', src: 'https://raw.communitydragon.org/latest/game/assets/items/icons2d/2055_class_t1_controlward.png', x: 686, y: 488, arrow: { hasArrow: false, dx: 0, dy: 0 } },
        { type: 'ward', uid: 'ward_demo_yellow', src: 'https://raw.communitydragon.org/latest/game/assets/items/icons2d/3340_class_t1_wardingtotem.png', x: 732, y: 416, arrow: { hasArrow: false, dx: 0, dy: 0 } },

        // 스마트 핑
        { type: 'ping', uid: 'ping_demo_omw', src: 'https://raw.communitydragon.org/latest/game/assets/ux/minimap/pings/on_my_way_new.png', x: 724, y: 466, arrow: { hasArrow: false, dx: 0, dy: 0 } },
        { type: 'ping', uid: 'ping_demo_target', src: 'https://raw.communitydragon.org/latest/game/assets/ux/minimap/pings/target.png', x: 758, y: 474, arrow: { hasArrow: false, dx: 0, dy: 0 } },
        { type: 'ping', uid: 'ping_demo_warded', src: 'https://raw.communitydragon.org/latest/game/assets/ux/minimap/pings/area_is_warded_small_red_new.png', x: 714, y: 404, arrow: { hasArrow: false, dx: 0, dy: 0 } },
        { type: 'ping', uid: 'ping_demo_retreat', src: 'https://raw.communitydragon.org/latest/game/assets/ux/minimap/pings/retreat.png', x: 378, y: 128, arrow: { hasArrow: false, dx: 0, dy: 0 } },

        // 정글 진입 & 미드 로밍 펜 곡선 동선 + 자유 화살표
        {
            type: 'pen_stroke',
            uid: 'stroke_demo_jg_path',
            color: '#00e5ff',
            width: 4,
            points: [
                { x: 590, y: 465 },
                { x: 618, y: 446 },
                { x: 646, y: 432 },
                { x: 672, y: 428 }
            ]
        },
        {
            type: 'pen_stroke',
            uid: 'stroke_demo_mid_roam',
            color: '#ffeb3b',
            width: 4,
            points: [
                { x: 568, y: 344 },
                { x: 615, y: 374 },
                { x: 662, y: 405 },
                { x: 696, y: 432 }
            ]
        },
        {
            type: 'free_arrow',
            uid: 'arrow_demo_engage',
            x: 780,
            y: 500,
            arrow: { hasArrow: true, dx: -36, dy: -28 }
        }
    ];

    // Step 2: 드래곤 둥지 합류 교전 (동일 uid 기반 이동 + 반투명 잔상 & 점선 궤적)
    const step2Positions = {
        champ_demo_blue_top: { x: 418, y: 224 },
        champ_demo_blue_jg: { x: 726, y: 462 },
        champ_demo_blue_mid: { x: 694, y: 424 },
        champ_demo_blue_adc: { x: 768, y: 524 },
        champ_demo_blue_sup: { x: 742, y: 488 },
        champ_demo_red_top: { x: 448, y: 178 },
        champ_demo_red_jg: { x: 754, y: 452 },
        champ_demo_red_mid: { x: 718, y: 376 },
        champ_demo_red_adc: { x: 804, y: 488 },
        champ_demo_red_sup: { x: 776, y: 466 }
    };

    const step2 = step1
        .filter(o => o.type !== 'pen_stroke' && o.type !== 'free_arrow')
        .map(o => {
            const copy = JSON.parse(JSON.stringify(o));
            if (copy.arrow) {
                copy.arrow = { hasArrow: false, dx: 0, dy: 0 };
            }
            if (step2Positions[copy.uid]) {
                copy.x = step2Positions[copy.uid].x;
                copy.y = step2Positions[copy.uid].y;
            }
            return copy;
        });

    return {
        timelineData: [step1, step2],
        currentStepIndex: 0,
        myTeamSide: 'blue',
        bluePreset: ['Gnar', 'LeeSin', 'Ahri', 'Jinx', 'Thresh'],
        redPreset: ['Renekton', 'Viego', 'Orianna', 'Kaisa', 'Nautilus'],
        currentMode: 'map',
        selectedScreenshotId: null,
        showGhostChampions: true
    };
}

function applyTutorialStepDemo(stepIdx) {
    if (tutorialDemoTimer) {
        clearTimeout(tutorialDemoTimer);
        tutorialDemoTimer = null;
    }

    if (!Array.isArray(timelineData) || timelineData.length === 0) return;

    if (stepIdx === 7 && timelineData.length > 1) {
        // 8단계: Step 1 -> Step 2 드래곤 교전 합류 애니메이션 및 잔상/점선 시연
        currentStepIndex = 0;
        selectedObjUid = null;
        renderScene();

        tutorialDemoTimer = setTimeout(() => {
            if (!isTutorialActive || currentTutorialStepIdx !== 7) return;
            showGhostChampions = true;
            const ghostCb = document.getElementById('show-ghost-checkbox');
            if (ghostCb) ghostCb.checked = true;
            nextStep();
        }, 280);
        return;
    }

    if (currentStepIndex !== 0) {
        triggerStepAnimation();
        currentStepIndex = 0;
    }

    // 4단계: 리 신을 선택 강조하여 화살표 핸들 + 블루/레드/흰색 테두리 + 반투명 캠프 시연
    selectedObjUid = stepIdx === 3 ? 'champ_demo_blue_jg' : null;
    renderScene();
}

const TUTORIAL_STEPS = [
    {
        category: '시작하기',
        title: '🗺️ 소환사의 협곡 전략 보드 오리엔테이션',
        target: '#map-area',
        preferCenter: true,
        desc: '소환사의 협곡 맵 위에 <strong>드래곤 교전 실전 예제</strong>가 펼쳐졌습니다. 챔피언·와드·정글 캠프·미니언을 배치하고 펜과 화살표로 동선과 교전 구도를 시각적으로 설계할 수 있습니다.',
        tip: '<strong>핵심 조작</strong>: 마우스 <kbd>휠</kbd>로 확대/축소하고, 배경을 <strong>우클릭 드래그</strong>하여 맵을 자유롭게 이동(패닝)할 수 있습니다. 하단의 <strong>🧪 예제 체험</strong>을 누르면 이 예제를 보드에 남기고 바로 조작해 볼 수 있습니다.'
    },
    {
        category: '좌측 패널',
        title: '👥 챔피언 검색 · 빠른 추가 · 진영/배경 모드',
        target: '#sidebar-left',
        mobileTarget: '#btn-toggle-left-sidebar',
        onEnter: () => {
            if (typeof switchLeftTab === 'function') switchLeftTab('champs');
        },
        desc: '초성 검색(예: <code>ㄹㅅ</code>)으로 챔피언을 빠르게 찾고, <strong>더블클릭 → 아군 추가</strong> / <strong>우클릭 → 적군 추가</strong>로 팀 슬롯을 채우거나 맵으로 직접 드래그하세요. 상단 탭에서 <strong>프리셋</strong>과 <strong>스크린샷 모드</strong>(<kbd>Ctrl+V</kbd>)도 전환할 수 있습니다.',
        tip: '하단에서 <strong>아군(My Team) 진영</strong>(블루/레드)과 <strong>배경 모드</strong>(소환사의 협곡 / 스크린샷)를 언제든 변경할 수 있습니다.'
    },
    {
        category: '상단 툴바',
        title: '✏️ 선택 · 펜 · 화살표 · 지우개 & 캠프젠',
        target: '#top-toolbar',
        desc: '맵의 노란색·하늘색 곡선처럼 자유롭게 동선을 그리고, 숫자키 <kbd>1</kbd> <strong>선택</strong>, <kbd>2</kbd> <strong>펜</strong>, <kbd>3</kbd> <strong>화살표</strong>, <kbd>4</kbd> <strong>지우개</strong>로 도구를 즉시 전환합니다. <kbd>C</kbd> 키는 오브젝트는 유지한 채 선과 화살표만 지우며, <strong>🌲 캠프젠</strong>은 정글 캠프를 일괄 배치합니다.',
        tip: '<strong>팁</strong>: <strong>👆 선택(1)</strong> 모드에서는 실수로 그림이 그려지지 않아 챔피언과 화살표 핸들 위치 조정에 편리합니다. <kbd>Ctrl+Z</kbd> / <kbd>Ctrl+Shift+Z</kbd>로 실행 취소/재실행을 지원합니다.'
    },
    {
        category: '협곡 전술 조작',
        title: '🎯 챔피언 팀 테두리 전환 & 캠프 반투명 토글',
        target: '#rift-map',
        preferCenter: true,
        desc: '맵 중앙의 리 신(블루)·비에고(레드)·사일러스(흰색)처럼 <strong>챔피언을 더블클릭</strong>하면 테두리가 <code>⚪ 흰색 → 🔵 블루 → 🔴 레드</code> 순으로 바뀝니다. 또한 위쪽 <strong>반투명한 적 레드·칼날부리</strong>처럼 <strong>정글 캠프/오브젝트를 더블클릭</strong>하면 처치·카정 표시용 반투명으로 전환됩니다.',
        tip: '<strong>화살표 연결</strong>: 리 신과 쓰레쉬처럼 우클릭 메뉴의 <strong>➤ 화살표 추가/제거</strong>로 이동 방향 화살표 핸들을 붙일 수 있습니다.'
    },
    {
        category: '우측 팀/핑 패널',
        title: '👥 팀 일괄 배치 & 📋 전술 페이지 저장/관리',
        target: '#tab-content-team',
        mobileTarget: '#btn-toggle-right-sidebar',
        onEnter: () => {
            if (typeof switchRightTab === 'function') switchRightTab('team');
        },
        desc: '<strong>Blue Team / Red Team</strong> 상자에 예제로 채워진 5명씩의 조합을 맵으로 통째로 드래그해 배치할 수 있고, <strong>Smart Pings</strong>로 강가의 가는중/타겟/와드경고 핑을 찍을 수 있습니다. 아래 <strong>📋 전술 페이지</strong>에서는 모든 스텝을 저장·불러오기·수정·삭제할 수 있습니다.',
        tip: '<strong>팁</strong>: 기존 전술을 불러온 뒤 맵을 수정했다면 <strong>✏️ 수정</strong> 버튼 한 번으로 현재 상태와 이름을 덮어쓸 수 있습니다.'
    },
    {
        category: '우측 오브젝트 패널',
        title: '👾 에픽 몬스터 · 미니언 · 유틸리티 오브젝트',
        target: '#sidebar-right',
        mobileTarget: '#btn-toggle-right-sidebar',
        onEnter: () => {
            if (typeof switchRightTab === 'function') switchRightTab('objects');
        },
        desc: '<strong>오브젝트 탭</strong>에서는 맵 위의 <strong>드래곤·공허 유충</strong>, 정글 버프/캠프 몹, 미드·바텀 <strong>미니언 웨이브</strong>(웨이브 방향 반전 가능), 삼거리·강가 <strong>와드 · 텔포</strong> 아이콘을 맵에 드래그해 배치할 수 있습니다.',
        tip: '배치된 와드나 미니언 역시 클릭 선택 후 <kbd>Del</kbd> 또는 <kbd>Backspace</kbd> 키로 즉시 삭제할 수 있습니다.'
    },
    {
        category: '아이콘 크기 설정',
        title: '📏 챔피언 · 미니언 · 오브젝트 3종 크기 솔루션',
        target: '#size-control-container',
        mobileTarget: '#btn-toggle-right-sidebar',
        onEnter: () => {
            if (typeof switchRightTab === 'function') switchRightTab('team');
        },
        desc: '<strong>👤 챔피언</strong>(16~72px), <strong>⚔️ 미니언</strong>(20~120px), <strong>👾 오브젝트</strong>(16~80px) 크기를 각각 독립적으로 조절할 수 있습니다. 설정값은 브라우저에 자동 저장되며 <strong>↺ 기본값</strong> 버튼으로 언제든 초기화됩니다.',
        tip: '<strong>배율에 맞춰 자동 스케일</strong>을 켜두면 사용자가 정한 기준 크기를 유지한 채 줌 확대 시 아이콘만 과도하게 커지는 것을 자동으로 완화해 줍니다.'
    },
    {
        category: '타임라인 & 송출',
        title: '🎬 타임라인 스텝(Step) 애니메이션 & OBS 송출',
        target: '#timeline',
        onEnter: () => {
            if (typeof switchRightTab === 'function') switchRightTab('obs');
        },
        desc: '지금 맵에서 <strong>Step 1 ➔ Step 2 드래곤 합류</strong>가 자동 재생되며 출발 자리의 <strong>반투명 잔상과 이동 점선 궤적</strong>이 함께 표시됩니다. <kbd>←</kbd> / <kbd>→</kbd> 키나 <strong>+ Step 추가</strong>로 전개 장면을 이어갈 수 있습니다.',
        tip: '<strong>OBS 방송 연동</strong>: 우측 <strong>📹 OBS</strong> 탭에서 투명 배경 오버레이 창을 열어 방송 화면 위에 전술 보드를 실시간으로 송출할 수 있습니다.'
    }
];

function getActiveTabId(containerSelector, fallbackId) {
    const activeBtn = document.querySelector(`${containerSelector} .sidebar-tabs .tab-btn.active`);
    if (!activeBtn || !activeBtn.id) return fallbackId;
    return activeBtn.id.replace(/^tab-btn-/, '');
}

function startTutorial(stepIndex = 0) {
    const overlay = document.getElementById('tutorial-overlay');
    if (!overlay) return;

    if (tutorialDemoTimer) {
        clearTimeout(tutorialDemoTimer);
        tutorialDemoTimer = null;
    }

    if (typeof hideHelpModal === 'function') hideHelpModal();
    if (typeof closeMobileSidebars === 'function') closeMobileSidebars();
    if (typeof closeMobileDropdown === 'function') closeMobileDropdown();

    if (!isTutorialActive) {
        tutorialPrevLeftTab = getActiveTabId('#sidebar-left', 'champs');
        tutorialPrevRightTab = getActiveTabId('#right-panel-wrapper', 'team');
        tutorialSavedBoardState = {
            snapshot: createCurrentBoardSnapshot(),
            selectedObjUid: selectedObjUid,
            currentTacticId: currentTacticId,
            showGhostChampions: showGhostChampions,
            historyStack: JSON.parse(JSON.stringify(historyStack || [])),
            historyPointer: historyPointer
        };
    }

    // 최초 진입 및 재실행 모두 데모 보드·히스토리를 멱등하게 초기화
    historyStack = [];
    historyPointer = -1;
    currentTacticId = null;
    renderTacticsUI();
    applyBoardSnapshot(createTutorialDemoSnapshot(), true);

    isTutorialActive = true;
    overlay.classList.add('active');
    overlay.setAttribute('aria-hidden', 'false');
    goToTutorialStep(stepIndex);
}

function endTutorial(restoreOriginal = true) {
    const overlay = document.getElementById('tutorial-overlay');
    if (tutorialDemoTimer) {
        clearTimeout(tutorialDemoTimer);
        tutorialDemoTimer = null;
    }
    if (!isTutorialActive && (!overlay || !overlay.classList.contains('active'))) return;

    isTutorialActive = false;
    if (overlay) {
        overlay.classList.remove('active');
        overlay.setAttribute('aria-hidden', 'true');
    }

    if (restoreOriginal && tutorialSavedBoardState) {
        const saved = tutorialSavedBoardState;
        applyBoardSnapshot(saved.snapshot, false);
        selectedObjUid = saved.selectedObjUid;
        currentTacticId = saved.currentTacticId;
        showGhostChampions = saved.showGhostChampions;
        const ghostCb = document.getElementById('show-ghost-checkbox');
        if (ghostCb) ghostCb.checked = showGhostChampions;
        historyStack = JSON.parse(JSON.stringify(saved.historyStack || []));
        historyPointer = saved.historyPointer;
        renderTacticsUI();
        renderScene();
    }
    tutorialSavedBoardState = null;

    // 예제 체험 종료 시 이전 탭이 스크린샷이었다면 협곡 모드를 덮어쓰지 않도록 챔피언 탭으로 복귀
    const nextLeftTab = (!restoreOriginal && tutorialPrevLeftTab === 'screenshots')
        ? 'champs'
        : tutorialPrevLeftTab;
    if (nextLeftTab && typeof switchLeftTab === 'function') {
        switchLeftTab(nextLeftTab);
    }
    if (tutorialPrevRightTab && typeof switchRightTab === 'function') {
        switchRightTab(tutorialPrevRightTab);
    }
    tutorialPrevLeftTab = null;
    tutorialPrevRightTab = null;
}

function keepTutorialDemoAndClose() {
    endTutorial(false);
    showToast('🧪 튜토리얼 예제를 보드에 남겼습니다. 자유롭게 조작해 보세요!');
}

function nextTutorialStep() {
    if (!isTutorialActive) return;
    if (currentTutorialStepIdx >= TUTORIAL_STEPS.length - 1) {
        endTutorial(true);
        return;
    }
    goToTutorialStep(currentTutorialStepIdx + 1);
}

function prevTutorialStep() {
    if (!isTutorialActive || currentTutorialStepIdx <= 0) return;
    goToTutorialStep(currentTutorialStepIdx - 1);
}

function goToTutorialStep(idx) {
    const clampedIdx = Math.max(0, Math.min(TUTORIAL_STEPS.length - 1, idx));
    currentTutorialStepIdx = clampedIdx;
    const step = TUTORIAL_STEPS[clampedIdx];

    applyTutorialStepDemo(clampedIdx);

    if (typeof step.onEnter === 'function') {
        step.onEnter();
    }

    const stepBadge = document.getElementById('tutorial-step-badge');
    const categoryEl = document.getElementById('tutorial-category');
    const titleEl = document.getElementById('tutorial-title');
    const descEl = document.getElementById('tutorial-desc');
    const tipEl = document.getElementById('tutorial-tip');
    const dotsEl = document.getElementById('tutorial-dots');
    const prevBtn = document.getElementById('tutorial-prev-btn');
    const nextBtn = document.getElementById('tutorial-next-btn');

    if (stepBadge) stepBadge.innerText = `STEP ${clampedIdx + 1} / ${TUTORIAL_STEPS.length}`;
    if (categoryEl) categoryEl.innerText = step.category || '';
    if (titleEl) titleEl.innerText = step.title || '';
    if (descEl) descEl.innerHTML = step.desc || '';
    if (tipEl) {
        if (step.tip) {
            tipEl.style.display = 'block';
            tipEl.innerHTML = step.tip;
        } else {
            tipEl.style.display = 'none';
            tipEl.innerHTML = '';
        }
    }

    if (dotsEl) {
        dotsEl.innerHTML = '';
        TUTORIAL_STEPS.forEach((s, i) => {
            const dot = document.createElement('button');
            dot.type = 'button';
            dot.className = 'tutorial-dot' + (i === clampedIdx ? ' active' : '');
            dot.title = `${i + 1}. ${s.category}`;
            dot.onclick = () => goToTutorialStep(i);
            dotsEl.appendChild(dot);
        });
    }

    if (prevBtn) prevBtn.disabled = clampedIdx === 0;
    if (nextBtn) {
        nextBtn.innerText = clampedIdx === TUTORIAL_STEPS.length - 1 ? '✔ 완료' : '다음 ▶';
    }

    requestAnimationFrame(() => {
        positionTutorialElements();
    });
}

function getTutorialTargetRect(step) {
    const isMobile = window.innerWidth <= 768;
    const selector = (isMobile && step.mobileTarget) ? step.mobileTarget : step.target;
    const targetEl = selector ? document.querySelector(selector) : null;
    if (!targetEl) return null;

    const raw = targetEl.getBoundingClientRect();
    if (!raw || raw.width <= 0 || raw.height <= 0) return null;

    // #rift-map 처럼 확대되어 #map-area 뷰포트보다 큰 경우 보이는 교집합 영역으로 클램프
    if (step.target === '#rift-map') {
        const mapArea = document.getElementById('map-area');
        if (mapArea) {
            const areaRect = mapArea.getBoundingClientRect();
            const left = Math.max(raw.left, areaRect.left + 4);
            const top = Math.max(raw.top, areaRect.top + 4);
            const right = Math.min(raw.right, areaRect.right - 4);
            const bottom = Math.min(raw.bottom, areaRect.bottom - 4);
            if (right > left && bottom > top) {
                return { left, top, right, bottom, width: right - left, height: bottom - top };
            }
        }
    }

    return raw;
}

function positionTutorialElements() {
    if (!isTutorialActive) return;

    const spotlight = document.getElementById('tutorial-spotlight');
    const card = document.getElementById('tutorial-card');
    if (!spotlight || !card) return;

    const step = TUTORIAL_STEPS[currentTutorialStepIdx];
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const margin = 16;
    const pad = 6;

    const rect = getTutorialTargetRect(step);
    const cardRect = card.getBoundingClientRect();
    const cw = cardRect.width || Math.min(280, vw - 24);
    const ch = cardRect.height || 260;

    const clampLeft = (val) => Math.max(margin, Math.min(val, vw - cw - margin));
    const clampTop = (val) => Math.max(margin, Math.min(val, vh - ch - margin));

    // #map-area 좌측 여백(1번) / 우측 여백(2번) 좌표 계산
    const mapAreaEl = document.getElementById('map-area');
    const riftMapEl = document.getElementById('rift-map');
    const areaRect = mapAreaEl ? mapAreaEl.getBoundingClientRect() : null;
    const riftRect = riftMapEl ? riftMapEl.getBoundingClientRect() : null;

    let pos1Left = clampLeft(margin);
    let pos2Left = clampLeft(vw - cw - margin);
    let posTop = clampTop(Math.round((vh - ch) * 0.42));

    if (areaRect && areaRect.width > 0 && areaRect.height > 0) {
        if (riftRect && riftRect.width > 0) {
            const leftGap = Math.max(0, riftRect.left - areaRect.left);
            const rightGap = Math.max(0, areaRect.right - riftRect.right);
            pos1Left = clampLeft(
                leftGap >= cw + 16
                    ? areaRect.left + (leftGap - cw) / 2
                    : areaRect.left + 14
            );
            pos2Left = clampLeft(
                rightGap >= cw + 16
                    ? riftRect.right + (rightGap - cw) / 2
                    : areaRect.right - cw - 14
            );
        } else {
            pos1Left = clampLeft(areaRect.left + 14);
            pos2Left = clampLeft(areaRect.right - cw - 14);
        }
        posTop = clampTop(Math.round(areaRect.top + (areaRect.height - ch) * 0.42));
    }

    if (!rect || rect.right < 0 || rect.left > vw || rect.bottom < 0 || rect.top > vh) {
        spotlight.style.opacity = '0';
        spotlight.style.left = `${vw / 2}px`;
        spotlight.style.top = `${vh / 2}px`;
        spotlight.style.width = '0px';
        spotlight.style.height = '0px';

        card.style.left = `${pos1Left}px`;
        card.style.top = `${posTop}px`;
        return;
    }

    const spotLeft = Math.max(4, rect.left - pad);
    const spotTop = Math.max(4, rect.top - pad);
    const spotRight = Math.min(vw - 4, rect.right + pad);
    const spotBottom = Math.min(vh - 4, rect.bottom + pad);
    const spotW = Math.max(24, spotRight - spotLeft);
    const spotH = Math.max(24, spotBottom - spotTop);

    spotlight.style.opacity = '1';
    spotlight.style.left = `${spotLeft}px`;
    spotlight.style.top = `${spotTop}px`;
    spotlight.style.width = `${spotW}px`;
    spotlight.style.height = `${spotH}px`;

    const spotCenterX = spotLeft + spotW / 2;
    const cardLeft = spotCenterX > vw * 0.65 ? pos2Left : pos1Left;
    const cardTop = step.target === '#top-toolbar'
        ? clampTop(Math.max(posTop, spotBottom + 14))
        : posTop;

    card.style.left = `${cardLeft}px`;
    card.style.top = `${cardTop}px`;
}

window.addEventListener('resize', () => {
    if (isTutorialActive) {
        positionTutorialElements();
    }
});

// ==========================================================================
// 📦 3단계 고압축 내보내기 / 불러오기 및 2슬롯 백업 시스템 (GUDO1 Deflate Codec)
// ==========================================================================

const BACKUP_SLOTS_STORAGE_KEY = 'lol_strategy_backup_slots';
const MAX_BACKUP_SLOTS = 2;
const PEN_COLOR_DICT = ['#ffeb3b', '#00e5ff', '#ff5252', '#69f0ae', '#ff4081'];

let activeIoTab = 'tactics';
let currentExportCode = '';
let currentExportScope = 'tactics';
let ioRenderToken = 0;

function getAssetDict() {
    const dict = [];
    const seen = new Set();
    const pushUrl = (u) => {
        if (u && typeof u === 'string' && !seen.has(u)) {
            seen.add(u);
            dict.push(u);
        }
    };
    if (typeof tacticsData !== 'undefined') tacticsData.forEach(d => pushUrl(d.src));
    if (typeof epicMonstersData !== 'undefined') epicMonstersData.forEach(d => pushUrl(d.src));
    if (typeof buffsData !== 'undefined') buffsData.forEach(d => pushUrl(d.src));
    if (typeof minionsData !== 'undefined') minionsData.forEach(d => pushUrl(d.src));
    if (typeof objectsData !== 'undefined') objectsData.forEach(d => pushUrl(d.src));
    if (typeof defaultCampPositions !== 'undefined') defaultCampPositions.forEach(d => pushUrl(d.src));
    return dict;
}

function encodeAssetSrc(src, dict) {
    if (!src) return '';
    const idx = dict.indexOf(src);
    return idx >= 0 ? idx : src;
}

function decodeAssetSrc(val, dict) {
    if (typeof val === 'number') return dict[val] || '';
    if (typeof val === 'string' && val.startsWith('@')) {
        const idx = parseInt(val.slice(1), 10);
        return Number.isFinite(idx) ? (dict[idx] || val) : val;
    }
    return val || '';
}

function encodeStrokePoints(points) {
    if (!Array.isArray(points) || points.length === 0) return [];
    const firstX = Math.round(points[0].x || 0);
    const firstY = Math.round(points[0].y || 0);
    const deltas = [firstX, firstY];
    let prevX = firstX;
    let prevY = firstY;
    for (let i = 1; i < points.length; i++) {
        const rx = Math.round(points[i].x || 0);
        const ry = Math.round(points[i].y || 0);
        if (rx === prevX && ry === prevY) continue;
        deltas.push(rx - prevX, ry - prevY);
        prevX = rx;
        prevY = ry;
    }
    return deltas;
}

function decodeStrokePoints(deltas) {
    if (!Array.isArray(deltas) || deltas.length < 2) return [];
    let cx = Number(deltas[0]) || 0;
    let cy = Number(deltas[1]) || 0;
    const points = [{ x: cx, y: cy }];
    for (let i = 2; i + 1 < deltas.length; i += 2) {
        cx += Number(deltas[i]) || 0;
        cy += Number(deltas[i + 1]) || 0;
        points.push({ x: cx, y: cy });
    }
    return points;
}

function trimTrailingDefaults(tuple, minLength) {
    while (tuple.length > minLength) {
        const tail = tuple[tuple.length - 1];
        if (tail === null || tail === undefined || tail === 0 || tail === '') {
            tuple.pop();
        } else {
            break;
        }
    }
    return tuple;
}

function packTimelineData(steps, dict) {
    const uidMap = new Map();
    let uidCounter = 0;
    const getShortUid = (rawUid) => {
        if (!rawUid) return uidCounter++;
        if (uidMap.has(rawUid)) return uidMap.get(rawUid);
        const shortId = uidCounter++;
        uidMap.set(rawUid, shortId);
        return shortId;
    };

    return (Array.isArray(steps) ? steps : [[]]).map(stepObjs => {
        if (!Array.isArray(stepObjs)) return [];
        const packed = [];
        stepObjs.forEach(o => {
            if (!o || !o.type) return;
            const arrowArr = (o.arrow && o.arrow.hasArrow)
                ? [Math.round(o.arrow.dx || 0), Math.round(o.arrow.dy || 0)]
                : null;
            const dimFlag = o.dimmed ? 1 : 0;

            if (o.type === 'champion') {
                const cid = o.champId || 'Poro';
                const tCode = o.team === 'blue' ? 'b' : (o.team === 'red' ? 'r' : (o.team === 'none' ? 'n' : ''));
                const uCode = o.uid === `champ_${cid}` ? '$' : getShortUid(o.uid);
                const tuple = ['c', uCode, cid, Math.round(o.x || 0), Math.round(o.y || 0), tCode, dimFlag, arrowArr];
                packed.push(trimTrailingDefaults(tuple, 5));
            } else if (o.type === 'minion') {
                const mCode = o.minionType === 'minion-red' ? 'r' : 'b';
                const tuple = ['m', getShortUid(o.uid), encodeAssetSrc(o.src, dict), Math.round(o.x || 0), Math.round(o.y || 0), mCode, dimFlag, arrowArr];
                packed.push(trimTrailingDefaults(tuple, 6));
            } else if (o.type === 'object' || o.type === 'ward' || o.type === 'ping') {
                const tag = o.type === 'ward' ? 'w' : (o.type === 'ping' ? 'p' : 'o');
                const tuple = [tag, getShortUid(o.uid), encodeAssetSrc(o.src, dict), Math.round(o.x || 0), Math.round(o.y || 0), dimFlag, arrowArr];
                packed.push(trimTrailingDefaults(tuple, 5));
            } else if (o.type === 'pen_stroke') {
                const colorIdx = PEN_COLOR_DICT.indexOf(o.color);
                const cCode = colorIdx >= 0 ? colorIdx : (o.color || '#ff5252');
                packed.push(['s', getShortUid(o.uid), cCode, o.width || 4, encodeStrokePoints(o.points)]);
            } else if (o.type === 'free_arrow') {
                const dx = o.arrow ? Math.round(o.arrow.dx || 0) : 0;
                const dy = o.arrow ? Math.round(o.arrow.dy || 0) : 0;
                packed.push(['a', getShortUid(o.uid), Math.round(o.x || 0), Math.round(o.y || 0), dx, dy]);
            } else if (o.type === 'structure_destroyed') {
                packed.push(['d', o.uid]);
            }
        });
        return packed;
    });
}

function unpackTimelineData(packedSteps, dict) {
    if (!Array.isArray(packedSteps) || packedSteps.length === 0) return [[]];
    const uidPrefix = 'imp_' + Date.now().toString(36) + '_' + Math.random().toString(36).substr(2, 4);
    const resolvedUids = new Map();
    const resolveUid = (uCode, typePrefix) => {
        const key = String(uCode);
        if (resolvedUids.has(key)) return resolvedUids.get(key);
        const uid = `${typePrefix}_${uidPrefix}_${key}`;
        resolvedUids.set(key, uid);
        return uid;
    };

    return packedSteps.map(stepArr => {
        if (!Array.isArray(stepArr)) return [];
        const objs = [];
        stepArr.forEach(item => {
            if (!Array.isArray(item) || item.length === 0) return;
            const tag = item[0];

            if (tag === 'c') {
                const tCode = item[5];
                const team = tCode === 'b' ? 'blue' : (tCode === 'r' ? 'red' : (tCode === 'n' ? 'none' : undefined));
                const champId = item[2] || 'Poro';
                const uid = item[1] === '$' ? `champ_${champId}` : resolveUid(item[1], 'champ');
                const obj = {
                    type: 'champion',
                    uid: uid,
                    champId: champId,
                    x: Number(item[3]) || 0,
                    y: Number(item[4]) || 0,
                    arrow: Array.isArray(item[7]) ? { hasArrow: true, dx: Number(item[7][0]) || 0, dy: Number(item[7][1]) || 0 } : { hasArrow: false, dx: 0, dy: 0 }
                };
                if (team !== undefined) obj.team = team;
                if (item[6]) obj.dimmed = true;
                objs.push(obj);
            } else if (tag === 'm') {
                const obj = {
                    type: 'minion',
                    uid: resolveUid(item[1], 'minion'),
                    src: decodeAssetSrc(item[2], dict),
                    x: Number(item[3]) || 0,
                    y: Number(item[4]) || 0,
                    minionType: item[5] === 'r' ? 'minion-red' : 'minion-blue',
                    arrow: Array.isArray(item[7]) ? { hasArrow: true, dx: Number(item[7][0]) || 0, dy: Number(item[7][1]) || 0 } : { hasArrow: false, dx: 0, dy: 0 }
                };
                if (item[6]) obj.dimmed = true;
                objs.push(obj);
            } else if (tag === 'o' || tag === 'w' || tag === 'p') {
                const typeName = tag === 'w' ? 'ward' : (tag === 'p' ? 'ping' : 'object');
                const obj = {
                    type: typeName,
                    uid: resolveUid(item[1], typeName),
                    src: decodeAssetSrc(item[2], dict),
                    x: Number(item[3]) || 0,
                    y: Number(item[4]) || 0,
                    arrow: Array.isArray(item[6]) ? { hasArrow: true, dx: Number(item[6][0]) || 0, dy: Number(item[6][1]) || 0 } : { hasArrow: false, dx: 0, dy: 0 }
                };
                if (item[5]) obj.dimmed = true;
                objs.push(obj);
            } else if (tag === 's') {
                const cCode = item[2];
                const color = typeof cCode === 'number' ? (PEN_COLOR_DICT[cCode] || '#ff5252') : (cCode || '#ff5252');
                objs.push({
                    type: 'pen_stroke',
                    uid: resolveUid(item[1], 'stroke'),
                    color: color,
                    width: Number(item[3]) || 4,
                    points: decodeStrokePoints(item[4])
                });
            } else if (tag === 'a') {
                objs.push({
                    type: 'free_arrow',
                    uid: resolveUid(item[1], 'arrow'),
                    x: Number(item[2]) || 0,
                    y: Number(item[3]) || 0,
                    arrow: { hasArrow: true, dx: Number(item[4]) || 0, dy: Number(item[5]) || 0 }
                });
            } else if (tag === 'd') {
                objs.push({
                    type: 'structure_destroyed',
                    uid: item[1]
                });
            }
        });
        return objs;
    });
}

function packBoardSnapshot(snap, dict) {
    return [
        snap.currentStepIndex || 0,
        snap.myTeamSide === 'red' ? 'r' : 'b',
        snap.bluePreset || [],
        snap.redPreset || [],
        snap.currentMode === 'screenshot' ? 's' : 'm',
        snap.showGhostChampions === false ? 0 : 1,
        packTimelineData(snap.timelineData || [[]], dict)
    ];
}

function unpackBoardSnapshot(packedSnap, dict, preservedScreenshotId = null) {
    if (!Array.isArray(packedSnap)) return null;
    const rawMode = packedSnap[4] === 's' ? 'screenshot' : 'map';
    const hasLocalScreenshot = rawMode === 'screenshot' && preservedScreenshotId &&
        typeof getScreenshotsFromStorage === 'function' &&
        getScreenshotsFromStorage().some(s => s.id === preservedScreenshotId);
    return {
        currentStepIndex: Number(packedSnap[0]) || 0,
        myTeamSide: packedSnap[1] === 'r' ? 'red' : 'blue',
        bluePreset: Array.isArray(packedSnap[2]) ? packedSnap[2].slice(0, 5) : [],
        redPreset: Array.isArray(packedSnap[3]) ? packedSnap[3].slice(0, 5) : [],
        currentMode: hasLocalScreenshot ? 'screenshot' : 'map',
        selectedScreenshotId: hasLocalScreenshot ? preservedScreenshotId : null,
        showGhostChampions: packedSnap[5] !== 0,
        timelineData: unpackTimelineData(packedSnap[6], dict)
    };
}

function sanitizeSnapshotScreenshotMode(snap) {
    if (!snap || typeof snap !== 'object') return snap;
    const copy = JSON.parse(JSON.stringify(snap));
    if (copy.currentMode === 'screenshot') {
        const scrId = copy.selectedScreenshotId;
        const hasLocal = Boolean(
            scrId &&
            typeof getScreenshotsFromStorage === 'function' &&
            getScreenshotsFromStorage().some(s => s.id === scrId)
        );
        if (!hasLocal) {
            copy.currentMode = 'map';
            copy.selectedScreenshotId = null;
        }
    }
    return copy;
}

function getBoardLayoutSignature(snap, dict) {
    if (!snap) return '';
    return JSON.stringify([
        snap.myTeamSide === 'red' ? 'r' : 'b',
        Array.isArray(snap.bluePreset) ? snap.bluePreset : [],
        Array.isArray(snap.redPreset) ? snap.redPreset : [],
        packTimelineData(snap.timelineData || [[]], dict)
    ]);
}

function getTacticContentSignature(tactic, dict) {
    if (!tactic) return '';
    return JSON.stringify([
        tactic.name || '',
        getBoardLayoutSignature(tactic, dict)
    ]);
}

function uint8ToBase64Url(bytes) {
    let binary = '';
    const chunkSize = 0x8000;
    for (let i = 0; i < bytes.length; i += chunkSize) {
        binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
    }
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToUint8(str) {
    let b64 = str.replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}

async function compressToGudoString(payloadObj) {
    const rawJson = JSON.stringify(payloadObj);
    const rawBytes = new TextEncoder().encode(rawJson);

    if (typeof CompressionStream === 'function') {
        try {
            const cs = new CompressionStream('deflate-raw');
            const outPromise = new Response(cs.readable).arrayBuffer();
            const writer = cs.writable.getWriter();
            writer.write(rawBytes).catch(() => {});
            writer.close().catch(() => {});
            const compressedBuf = await outPromise;
            const compressedBytes = new Uint8Array(compressedBuf);
            return {
                code: 'GUDO1:' + uint8ToBase64Url(compressedBytes),
                packedBytes: rawBytes.length,
                compressedBytes: compressedBytes.length,
                method: 'GUDO1 Deflate'
            };
        } catch (e) {
            console.warn('deflate-raw 압축 실패, 무압축 폴백 사용:', e);
        }
    }

    return {
        code: 'GUDO0:' + uint8ToBase64Url(rawBytes),
        packedBytes: rawBytes.length,
        compressedBytes: rawBytes.length,
        method: 'GUDO0 Base64URL'
    };
}

async function decompressFromGudoString(inputStr) {
    const trimmed = String(inputStr || '').trim();
    if (!trimmed) throw new Error('입력된 데이터가 비어 있습니다.');

    if (trimmed.startsWith('GUDO1:')) {
        if (typeof DecompressionStream !== 'function') {
            throw new Error('현재 브라우저가 GUDO1(Deflate) 해제를 지원하지 않습니다.');
        }
        const bytes = base64UrlToUint8(trimmed.slice(6));
        const ds = new DecompressionStream('deflate-raw');
        const outPromise = new Response(ds.readable).arrayBuffer();
        const writer = ds.writable.getWriter();
        writer.write(bytes).catch(() => {});
        writer.close().catch(() => {});
        const outBuf = await outPromise;
        const jsonText = new TextDecoder().decode(outBuf);
        return JSON.parse(jsonText);
    }

    if (trimmed.startsWith('GUDO0:')) {
        const bytes = base64UrlToUint8(trimmed.slice(6));
        const jsonText = new TextDecoder().decode(bytes);
        return JSON.parse(jsonText);
    }

    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        return JSON.parse(trimmed);
    }

    throw new Error('올바른 GUDO 압축 코드(GUDO1:...) 또는 JSON 형식이 아닙니다.');
}

async function buildCompressedExport(scope) {
    const dict = getAssetDict();
    const savedTactics = getSavedTacticsFromStorage();
    const currentSnap = createCurrentBoardSnapshot();

    const packedTactics = savedTactics.map(t => [
        t.name || '전술',
        packBoardSnapshot(t, dict)
    ]);
    const packedCurrentBoard = packBoardSnapshot(currentSnap, dict);

    const payload = {
        v: 1,
        s: scope === 'all' ? 'a' : 't',
        t: packedTactics,
        c: packedCurrentBoard
    };

    const baselineObj = {
        tactics: savedTactics,
        currentBoard: currentSnap
    };

    let savedPresets = [];
    let customCamps = null;
    if (scope === 'all') {
        savedPresets = getSavedPresetsFromStorage();
        payload.p = savedPresets.map(p => [
            p.name || '프리셋',
            Array.isArray(p.blue) ? p.blue : [],
            Array.isArray(p.red) ? p.red : []
        ]);
        payload.sz = [baseChampSize, baseMinionSize, baseObjectSize, isAutoSizeEnabled ? 1 : 0];

        const rawCamps = localStorage.getItem('lol_strategy_jungle_camps');
        if (rawCamps) {
            try {
                const parsedCamps = JSON.parse(rawCamps);
                if (Array.isArray(parsedCamps) && parsedCamps.length > 0) {
                    customCamps = parsedCamps;
                    payload.cp = parsedCamps.map(camp => {
                        const tup = [encodeAssetSrc(camp.src, dict), Math.round(camp.x || 0), Math.round(camp.y || 0), camp.dimmed ? 1 : 0];
                        return trimTrailingDefaults(tup, 3);
                    });
                }
            } catch (e) {}
        }

        baselineObj.presets = savedPresets;
        baselineObj.iconSizes = { champ: baseChampSize, minion: baseMinionSize, object: baseObjectSize, auto: isAutoSizeEnabled };
        if (customCamps) baselineObj.customCamps = customCamps;
    }

    const plainBytes = new TextEncoder().encode(JSON.stringify(baselineObj)).length;
    const compressed = await compressToGudoString(payload);
    const codeBytes = compressed.code.length;
    const savedPct = plainBytes > 0 ? Math.max(0, Math.round((1 - codeBytes / plainBytes) * 100)) : 0;

    return {
        code: compressed.code,
        method: compressed.method,
        plainBytes: plainBytes,
        codeBytes: codeBytes,
        savedPct: savedPct,
        counts: {
            tactics: savedTactics.length,
            presets: savedPresets.length,
            currentObjs: (currentSnap.timelineData[currentSnap.currentStepIndex] || []).length,
            currentSteps: currentSnap.timelineData.length,
            hasCustomCamps: Boolean(customCamps)
        }
    };
}

function decodeImportedPayload(raw) {
    const dict = getAssetDict();

    // v:1 고압축 포맷
    if (raw && raw.v === 1 && (raw.s === 't' || raw.s === 'a')) {
        const now = Date.now();
        const tactics = Array.isArray(raw.t)
            ? raw.t.map((entry, idx) => {
                if (!Array.isArray(entry) || !Array.isArray(entry[1])) return null;
                const snap = unpackBoardSnapshot(entry[1], dict);
                if (!snap) return null;
                return Object.assign({
                    id: `tactic_${now}_${idx}_${Math.random().toString(36).substr(2, 4)}`,
                    name: entry[0] || `불러온 전술 ${idx + 1}`,
                    updatedAt: now
                }, snap);
            }).filter(Boolean)
            : [];

        const presets = Array.isArray(raw.p)
            ? raw.p.map((entry, idx) => {
                if (!Array.isArray(entry)) return null;
                return {
                    id: `user_preset_${now}_${idx}_${Math.random().toString(36).substr(2, 4)}`,
                    name: entry[0] || `불러온 프리셋 ${idx + 1}`,
                    blue: Array.isArray(entry[1]) ? entry[1].slice(0, 5) : [],
                    red: Array.isArray(entry[2]) ? entry[2].slice(0, 5) : []
                };
            }).filter(Boolean)
            : null;

        const currentBoard = raw.c ? unpackBoardSnapshot(raw.c, dict) : null;

        let iconSizes = null;
        if (Array.isArray(raw.sz) && raw.sz.length >= 3) {
            iconSizes = {
                champ: Math.max(16, Math.min(72, Number(raw.sz[0]) || 40)),
                minion: Math.max(20, Math.min(120, Number(raw.sz[1]) || 60)),
                object: Math.max(16, Math.min(80, Number(raw.sz[2]) || 32)),
                auto: raw.sz[3] !== 0
            };
        }

        let customCamps = null;
        if (Array.isArray(raw.cp)) {
            customCamps = raw.cp.map(tup => ({
                type: 'object',
                src: decodeAssetSrc(tup[0], dict),
                dimmed: Boolean(tup[3]),
                x: Number(tup[1]) || 0,
                y: Number(tup[2]) || 0
            }));
        }

        return {
            scope: raw.s === 'a' ? 'all' : 'tactics',
            tactics: tactics,
            presets: presets,
            currentBoard: currentBoard,
            iconSizes: iconSizes,
            customCamps: customCamps
        };
    }

    // 일반 JSON 호환 포맷 지원
    if (raw && Array.isArray(raw.timelineData)) {
        return {
            scope: 'tactics',
            tactics: [],
            presets: null,
            currentBoard: sanitizeSnapshotScreenshotMode(raw),
            iconSizes: null,
            customCamps: null
        };
    }

    if (raw && (Array.isArray(raw.tactics) || Array.isArray(raw.presets))) {
        const now = Date.now();
        const rawBoard = raw.currentBoard || raw.board || null;
        return {
            scope: Array.isArray(raw.presets) ? 'all' : 'tactics',
            tactics: Array.isArray(raw.tactics)
                ? raw.tactics.filter(t => t && typeof t === 'object').map(sanitizeSnapshotScreenshotMode)
                : [],
            presets: Array.isArray(raw.presets)
                ? raw.presets.filter(p => p && typeof p === 'object').map((p, idx) => ({
                    id: p.id || `user_preset_json_${now}_${idx}`,
                    name: p.name || `불러온 프리셋 ${idx + 1}`,
                    blue: Array.isArray(p.blue) ? p.blue.slice(0, 5) : [],
                    red: Array.isArray(p.red) ? p.red.slice(0, 5) : []
                }))
                : null,
            currentBoard: (rawBoard && typeof rawBoard === 'object') ? sanitizeSnapshotScreenshotMode(rawBoard) : null,
            iconSizes: (raw.iconSizes && typeof raw.iconSizes === 'object') ? raw.iconSizes : null,
            customCamps: Array.isArray(raw.customCamps) ? raw.customCamps : null
        };
    }

    throw new Error('지원하지 않는 데이터 구조입니다.');
}

// --- 2슬롯 롤링 백업 시스템 (최대 2개 저장) ---
function getBackupSlotsFromStorage() {
    const raw = localStorage.getItem(BACKUP_SLOTS_STORAGE_KEY);
    if (!raw) return [];
    try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed.slice(0, MAX_BACKUP_SLOTS) : [];
    } catch (e) {
        return [];
    }
}

function saveBackupSlotsToStorage(slots) {
    const trimmed = (Array.isArray(slots) ? slots : []).slice(0, MAX_BACKUP_SLOTS);
    try {
        localStorage.setItem(BACKUP_SLOTS_STORAGE_KEY, JSON.stringify(trimmed));
        return true;
    } catch (e) {
        if (trimmed.length > 1) {
            try {
                localStorage.setItem(BACKUP_SLOTS_STORAGE_KEY, JSON.stringify(trimmed.slice(0, 1)));
                return true;
            } catch (e2) {}
        }
        return false;
    }
}

function buildBackupSummaryLabel(prefix = '백업') {
    const presetsCount = getSavedPresetsFromStorage().length;
    const tacticsCount = getSavedTacticsFromStorage().length;
    const d = new Date();
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    const ss = String(d.getSeconds()).padStart(2, '0');
    return `${prefix} (${hh}:${mm}:${ss}) - 프리셋 ${presetsCount} · 전술 ${tacticsCount}`;
}

function getBackupEntrySignature(entry) {
    if (!entry) return '';
    return JSON.stringify([
        entry.v || 0,
        entry.board || null,
        entry.boardScrId || null,
        entry.tactics || [],
        entry.presets || [],
        entry.iconSizes || null,
        entry.cp !== undefined ? entry.cp : (entry.customCampsRaw || null)
    ]);
}

function findMatchingSavedTacticId(boardSnap, tacticsList = null, dict = null) {
    if (!boardSnap) return null;
    const d = dict || getAssetDict();
    const list = Array.isArray(tacticsList) ? tacticsList : getSavedTacticsFromStorage();
    if (!list.length) return null;
    const sig = getBoardLayoutSignature(boardSnap, d);
    const match = list.find(t => getBoardLayoutSignature(t, d) === sig);
    return match ? match.id : null;
}

function createEmptyBoardSnapshot() {
    return {
        timelineData: [[]],
        currentStepIndex: 0,
        myTeamSide: 'blue',
        bluePreset: [],
        redPreset: [],
        currentMode: 'map',
        selectedScreenshotId: null,
        showGhostChampions: true
    };
}

function buildBackupEntry(customPrefix = '수동 백업', dict = null) {
    const d = dict || getAssetDict();
    const savedTactics = getSavedTacticsFromStorage();
    const savedPresets = getSavedPresetsFromStorage();

    let packedCamps = null;
    const rawCamps = localStorage.getItem('lol_strategy_jungle_camps');
    if (rawCamps) {
        try {
            const parsedCamps = JSON.parse(rawCamps);
            if (Array.isArray(parsedCamps) && parsedCamps.length > 0) {
                packedCamps = parsedCamps.map(camp => {
                    const tup = [encodeAssetSrc(camp.src, d), Math.round(camp.x || 0), Math.round(camp.y || 0), camp.dimmed ? 1 : 0];
                    return trimTrailingDefaults(tup, 3);
                });
            }
        } catch (e) {}
    }

    return {
        id: 'bk_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
        v: 1,
        savedAt: Date.now(),
        label: buildBackupSummaryLabel(customPrefix),
        board: packBoardSnapshot(createCurrentBoardSnapshot(), d),
        boardScrId: selectedScreenshotId || null,
        tactics: savedTactics.map(t => [
            t.name || '전술',
            packBoardSnapshot(t, d),
            t.id || null,
            t.selectedScreenshotId || null
        ]),
        presets: savedPresets.map(p => [
            p.name || '프리셋',
            Array.isArray(p.blue) ? p.blue : [],
            Array.isArray(p.red) ? p.red : [],
            p.id || null
        ]),
        iconSizes: [baseChampSize, baseMinionSize, baseObjectSize, isAutoSizeEnabled ? 1 : 0],
        cp: packedCamps
    };
}

function saveCurrentToBackupSlot(showFeedback = false, customPrefix = '수동 백업', prebuiltEntry = null) {
    if (isTutorialActive) return false;
    const slots = getBackupSlotsFromStorage();
    const entry = prebuiltEntry || buildBackupEntry(customPrefix);

    const entrySig = getBackupEntrySignature(entry);
    const existingIdx = slots.findIndex(s => getBackupEntrySignature(s) === entrySig);
    if (existingIdx >= 0) {
        slots[existingIdx].savedAt = entry.savedAt;
        slots[existingIdx].label = entry.label;
    } else {
        slots.unshift(entry);
    }

    const saved = saveBackupSlotsToStorage(slots.slice(0, MAX_BACKUP_SLOTS));
    renderBackupSlotsUI();

    if (showFeedback) {
        if (!saved) {
            showToast('⚠️ 브라우저 저장 용량 부족으로 백업을 저장하지 못했습니다.');
        } else if (existingIdx >= 0) {
            showToast(`🛡️ 동일한 상태가 이미 백업 슬롯(${existingIdx + 1}번)에 보관되어 있어 시간만 갱신했습니다.`);
        } else {
            showToast('🛡️ 현재 프리셋·전술 상태를 백업 슬롯(최대 2개)에 저장했습니다.');
        }
    }
    return saved;
}

function renderBackupSlotsUI() {
    const sel = document.getElementById('io-backup-slot-select');
    const restoreBtn = document.getElementById('io-restore-backup-btn');
    if (!sel) return;

    const slots = getBackupSlotsFromStorage();
    sel.innerHTML = '';

    if (slots.length === 0) {
        const opt = document.createElement('option');
        opt.value = '';
        opt.innerText = '보관된 이전 프리셋/전술 백업 없음 (최대 2개)';
        sel.appendChild(opt);
        if (restoreBtn) restoreBtn.disabled = true;
        return;
    }

    slots.forEach((slot, idx) => {
        const opt = document.createElement('option');
        opt.value = slot.id;
        opt.innerText = `[슬롯 ${idx + 1}] ${slot.label || '이전 상태'}`;
        sel.appendChild(opt);
    });
    if (restoreBtn) restoreBtn.disabled = false;
}

function applyIconSizeConfig(iconSizes) {
    if (!iconSizes) return;
    if (typeof iconSizes.champ === 'number') baseChampSize = Math.max(16, Math.min(72, iconSizes.champ));
    if (typeof iconSizes.minion === 'number') baseMinionSize = Math.max(20, Math.min(120, iconSizes.minion));
    if (typeof iconSizes.object === 'number') baseObjectSize = Math.max(16, Math.min(80, iconSizes.object));
    if (typeof iconSizes.auto === 'boolean') isAutoSizeEnabled = iconSizes.auto;

    const sizeSlider = document.getElementById('size-slider');
    if (sizeSlider) sizeSlider.value = baseChampSize;
    const minionSizeSlider = document.getElementById('minion-size-slider');
    if (minionSizeSlider) minionSizeSlider.value = baseMinionSize;
    const objectSizeSlider = document.getElementById('object-size-slider');
    if (objectSizeSlider) objectSizeSlider.value = baseObjectSize;
    const autoCb = document.getElementById('auto-size-checkbox');
    if (autoCb) autoCb.checked = isAutoSizeEnabled;

    saveIconSizeSettings();
    applyAutoSize();
}

function restoreSelectedBackupSlot() {
    const sel = document.getElementById('io-backup-slot-select');
    if (!sel || !sel.value) return;

    const slots = getBackupSlotsFromStorage();
    const target = slots.find(s => s.id === sel.value);
    if (!target) {
        showToast('⚠️ 선택한 백업 슬롯을 찾을 수 없습니다.');
        return;
    }

    const dict = getAssetDict();
    // 복원 직전 현재 작업 상태가 선택한 슬롯과 다르면 2슬롯 백업에 자동 보관
    const currentEntry = buildBackupEntry('슬롯 복원 전 백업', dict);
    if (getBackupEntrySignature(currentEntry) !== getBackupEntrySignature(target)) {
        saveCurrentToBackupSlot(false, '슬롯 복원 전 백업', currentEntry);
    }

    let restoredTactics = target.tactics;
    let restoredPresets = target.presets;
    let restoredBoard = target.board;
    let restoredIconSizes = target.iconSizes;
    let restoredCustomCampsRaw = target.customCampsRaw;

    if (target.v === 1) {
        restoredTactics = Array.isArray(target.tactics)
            ? target.tactics.map((entry, idx) => {
                if (!Array.isArray(entry) || !Array.isArray(entry[1])) return null;
                const snap = unpackBoardSnapshot(entry[1], dict, entry[3] || null);
                if (!snap) return null;
                return Object.assign({
                    id: entry[2] || `tactic_bk_${Date.now()}_${idx}`,
                    name: entry[0] || `백업 전술 ${idx + 1}`,
                    updatedAt: target.savedAt || Date.now()
                }, snap);
            }).filter(Boolean)
            : [];

        restoredPresets = Array.isArray(target.presets)
            ? target.presets.map((entry, idx) => {
                if (!Array.isArray(entry)) return null;
                return {
                    id: entry[3] || `user_preset_bk_${Date.now()}_${idx}`,
                    name: entry[0] || `백업 프리셋 ${idx + 1}`,
                    blue: Array.isArray(entry[1]) ? entry[1].slice(0, 5) : [],
                    red: Array.isArray(entry[2]) ? entry[2].slice(0, 5) : []
                };
            }).filter(Boolean)
            : [];

        restoredBoard = Array.isArray(target.board)
            ? unpackBoardSnapshot(target.board, dict, target.boardScrId || null)
            : null;

        if (Array.isArray(target.iconSizes) && target.iconSizes.length >= 3) {
            restoredIconSizes = {
                champ: Number(target.iconSizes[0]) || 40,
                minion: Number(target.iconSizes[1]) || 60,
                object: Number(target.iconSizes[2]) || 32,
                auto: target.iconSizes[3] !== 0
            };
        }

        if (Array.isArray(target.cp)) {
            restoredCustomCampsRaw = JSON.stringify(target.cp.map(tup => ({
                type: 'object',
                src: decodeAssetSrc(tup[0], dict),
                dimmed: Boolean(tup[3]),
                x: Number(tup[1]) || 0,
                y: Number(tup[2]) || 0
            })));
        } else {
            restoredCustomCampsRaw = null;
        }
    }

    if (Array.isArray(restoredTactics)) {
        saveTacticsToStorage(restoredTactics);
    }
    if (Array.isArray(restoredPresets)) {
        savePresetsToStorage(restoredPresets);
    }
    if (restoredCustomCampsRaw) {
        localStorage.setItem('lol_strategy_jungle_camps', restoredCustomCampsRaw);
    } else {
        localStorage.removeItem('lol_strategy_jungle_camps');
    }

    applyIconSizeConfig(restoredIconSizes);
    if (restoredBoard) {
        applyBoardSnapshot(restoredBoard, true);
        currentTacticId = findMatchingSavedTacticId(restoredBoard, restoredTactics, dict);
    } else {
        applyBoardSnapshot(createEmptyBoardSnapshot(), true);
        currentTacticId = null;
    }
    renderTacticsUI();
    renderSavedPresets();
    renderBackupSlotsUI();

    hideExportImportModal();
    showToast(`⏪ '${target.label}' 상태로 복원했습니다.`);
}

function applyImportedPackage(pkg, mode = 'merge') {
    // 불러오기 직전 현재 프리셋·전술 상태를 2슬롯 백업에 자동 보관
    saveCurrentToBackupSlot(false, '불러오기 전 자동 백업');

    const dict = getAssetDict();
    let addedTactics = 0;
    let addedPresets = 0;
    let appliedBoard = false;
    let filledLivePresets = false;
    let appliedCustomCamps = false;

    if (mode === 'overwrite') {
        saveTacticsToStorage(pkg.tactics || []);
        addedTactics = (pkg.tactics || []).length;

        if (pkg.scope === 'all' || Array.isArray(pkg.presets)) {
            savePresetsToStorage(pkg.presets || []);
            addedPresets = (pkg.presets || []).length;
        }
        if (pkg.iconSizes) {
            applyIconSizeConfig(pkg.iconSizes);
        }
        if (Array.isArray(pkg.customCamps)) {
            localStorage.setItem('lol_strategy_jungle_camps', JSON.stringify(pkg.customCamps));
            appliedCustomCamps = true;
        } else if (pkg.scope === 'all') {
            localStorage.removeItem('lol_strategy_jungle_camps');
        }

        currentTacticId = null;
        if (pkg.currentBoard) {
            applyBoardSnapshot(pkg.currentBoard, true);
            currentTacticId = findMatchingSavedTacticId(pkg.currentBoard, pkg.tactics || [], dict);
            appliedBoard = true;
        } else if ((pkg.tactics || []).length > 0) {
            currentTacticId = pkg.tactics[0].id;
            applyBoardSnapshot(pkg.tactics[0], true);
            appliedBoard = true;
        } else {
            applyBoardSnapshot(createEmptyBoardSnapshot(), true);
        }
    } else {
        // 병합(merge) 모드: 난수 UID가 아닌 정규화 콘텐츠 시그니처 기준으로 중복 제거
        const existingTactics = getSavedTacticsFromStorage();
        const usedTacticIds = new Set(existingTactics.map(t => t.id));
        const seenTacticSigs = new Set(existingTactics.map(t => getTacticContentSignature(t, dict)));
        const incomingTactics = Array.isArray(pkg.tactics) ? pkg.tactics : [];

        incomingTactics.forEach(t => {
            const sig = getTacticContentSignature(t, dict);
            if (seenTacticSigs.has(sig)) return;
            seenTacticSigs.add(sig);

            const copy = JSON.parse(JSON.stringify(t));
            while (!copy.id || usedTacticIds.has(copy.id)) {
                copy.id = 'tactic_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
            }
            usedTacticIds.add(copy.id);
            existingTactics.push(copy);
            addedTactics++;
        });
        if (addedTactics > 0) {
            saveTacticsToStorage(existingTactics);
        }

        if (Array.isArray(pkg.presets)) {
            const existingPresets = getSavedPresetsFromStorage();
            const usedPresetIds = new Set(existingPresets.map(p => p.id));
            pkg.presets.forEach(p => {
                const isDup = existingPresets.some(ex =>
                    ex.name === p.name &&
                    JSON.stringify(ex.blue) === JSON.stringify(p.blue) &&
                    JSON.stringify(ex.red) === JSON.stringify(p.red)
                );
                if (isDup) return;
                const copy = JSON.parse(JSON.stringify(p));
                while (!copy.id || usedPresetIds.has(copy.id)) {
                    copy.id = 'user_preset_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
                }
                usedPresetIds.add(copy.id);
                existingPresets.push(copy);
                addedPresets++;
            });
            if (addedPresets > 0) {
                savePresetsToStorage(existingPresets);
            }
        }

        if (Array.isArray(pkg.customCamps) && pkg.customCamps.length > 0 && !localStorage.getItem('lol_strategy_jungle_camps')) {
            localStorage.setItem('lol_strategy_jungle_camps', JSON.stringify(pkg.customCamps));
            appliedCustomCamps = true;
        }

        const isCurrentBoardEmpty =
            (!timelineData || (timelineData.length <= 1 && (!timelineData[0] || timelineData[0].length === 0))) &&
            bluePreset.length === 0 &&
            redPreset.length === 0;

        if (pkg.currentBoard) {
            const boardHasContent =
                (Array.isArray(pkg.currentBoard.timelineData) && pkg.currentBoard.timelineData.some(s => s && s.length > 0)) ||
                (pkg.currentBoard.bluePreset && pkg.currentBoard.bluePreset.length > 0) ||
                (pkg.currentBoard.redPreset && pkg.currentBoard.redPreset.length > 0);

            const boardSig = boardHasContent ? getBoardLayoutSignature(pkg.currentBoard, dict) : '';
            const currentBoardSig = (!isCurrentBoardEmpty && boardHasContent) ? getBoardLayoutSignature(createCurrentBoardSnapshot(), dict) : '';
            const matchesExistingTactic = boardHasContent && existingTactics.some(ex => getBoardLayoutSignature(ex, dict) === boardSig);
            const matchesLiveBoard = !isCurrentBoardEmpty && boardHasContent && boardSig === currentBoardSig;

            // 미저장 currentBoard는 빈 보드에서 전술 목록과 함께 들어온 경우에도 저장 목록에 보존해 전환 시 유실 방지
            if (boardHasContent && !matchesExistingTactic && !matchesLiveBoard && (!isCurrentBoardEmpty || incomingTactics.length > 0)) {
                const d = new Date();
                const label = `가져온 전술 (${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')})`;
                let newId = 'tactic_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
                while (usedTacticIds.has(newId)) {
                    newId = 'tactic_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
                }
                usedTacticIds.add(newId);
                const extraTactic = Object.assign({}, pkg.currentBoard, {
                    id: newId,
                    name: label,
                    updatedAt: Date.now()
                });
                existingTactics.push(extraTactic);
                saveTacticsToStorage(existingTactics);
                addedTactics++;
            }

            if (isCurrentBoardEmpty && boardHasContent) {
                applyBoardSnapshot(pkg.currentBoard, true);
                currentTacticId = findMatchingSavedTacticId(pkg.currentBoard, existingTactics, dict);
                appliedBoard = true;
            }

            if (!appliedBoard && pkg.scope === 'all' && bluePreset.length === 0 && redPreset.length === 0 &&
                ((pkg.currentBoard.bluePreset && pkg.currentBoard.bluePreset.length > 0) || (pkg.currentBoard.redPreset && pkg.currentBoard.redPreset.length > 0))) {
                bluePreset = JSON.parse(JSON.stringify(pkg.currentBoard.bluePreset || []));
                redPreset = JSON.parse(JSON.stringify(pkg.currentBoard.redPreset || []));
                renderPresets();
                filledLivePresets = true;
            }
        }

        if (!appliedBoard && isCurrentBoardEmpty && existingTactics.length > 0) {
            currentTacticId = existingTactics[0].id;
            applyBoardSnapshot(existingTactics[0], true);
            appliedBoard = true;
        }
    }

    renderTacticsUI();
    renderSavedPresets();
    renderBackupSlotsUI();

    const parts = [];
    if (addedTactics > 0) parts.push(`전술 ${addedTactics}개`);
    if (addedPresets > 0) parts.push(`프리셋 ${addedPresets}개`);
    if (appliedBoard) parts.push('현재 보드');
    if (!appliedBoard && filledLivePresets) parts.push('현재 슬롯');
    if (appliedCustomCamps) parts.push('캠프 좌표');
    const summaryText = parts.length > 0 ? parts.join(' · ') : '변경사항 없음(중복 항목 제외)';

    hideExportImportModal();
    showToast(`📥 ${mode === 'overwrite' ? '덮어쓰기' : '병합'} 완료: ${summaryText}`);
}

function getSelectedImportMode() {
    const checked = document.querySelector('input[name="io-import-mode"]:checked');
    return checked ? checked.value : 'merge';
}

async function processImportText(rawText) {
    try {
        const rawObj = await decompressFromGudoString(rawText);
        const pkg = decodeImportedPayload(rawObj);
        applyImportedPackage(pkg, getSelectedImportMode());
        return true;
    } catch (e) {
        console.error('Import error:', e);
        showToast(`⚠️ 불러오기 실패: ${e.message || '잘못된 데이터 형식입니다.'}`);
        return false;
    }
}

function handleImportFileSelect(event) {
    const input = event.target;
    const file = input && input.files ? input.files[0] : null;
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
        const content = e.target && e.target.result ? String(e.target.result) : '';
        processImportText(content);
        input.value = '';
    };
    reader.onerror = () => {
        showToast('⚠️ 파일을 읽는 중 오류가 발생했습니다.');
        input.value = '';
    };
    reader.readAsText(file, 'utf-8');
}

async function importFromCodeInput() {
    const textarea = document.getElementById('io-import-code');
    if (!textarea || !textarea.value.trim()) {
        showToast('⚠️ 붙여넣은 압축 코드가 없습니다.');
        return;
    }
    const ok = await processImportText(textarea.value);
    if (ok) {
        textarea.value = '';
    }
}

function openExportImportModal(tab = 'tactics') {
    const modal = document.getElementById('io-modal');
    if (!modal) return;
    if (typeof hideHelpModal === 'function') hideHelpModal();
    if (typeof closeMobileSidebars === 'function') closeMobileSidebars();
    if (typeof closeMobileDropdown === 'function') closeMobileDropdown();
    const importTextarea = document.getElementById('io-import-code');
    if (importTextarea) importTextarea.value = '';
    modal.classList.add('active');
    switchIoTab(tab);
}

function hideExportImportModal() {
    const modal = document.getElementById('io-modal');
    if (modal) modal.classList.remove('active');
}

async function switchIoTab(tab) {
    activeIoTab = tab;
    const token = ++ioRenderToken;

    ['tactics', 'all', 'import'].forEach(t => {
        const btn = document.getElementById(`io-tab-${t}`);
        if (btn) btn.classList.toggle('active', t === tab);
    });

    const exportView = document.getElementById('io-view-export');
    const importView = document.getElementById('io-view-import');

    if (tab === 'import') {
        if (exportView) exportView.style.display = 'none';
        if (importView) importView.style.display = 'flex';
        renderBackupSlotsUI();
        return;
    }

    if (exportView) exportView.style.display = 'flex';
    if (importView) importView.style.display = 'none';

    const scope = tab === 'all' ? 'all' : 'tactics';
    currentExportScope = scope;
    currentExportCode = '';

    const summaryEl = document.getElementById('io-export-summary');
    const statsEl = document.getElementById('io-compression-stats');
    const codeEl = document.getElementById('io-export-code');

    if (statsEl) statsEl.innerText = '압축 코드 생성 중...';
    if (codeEl) codeEl.value = '';

    const result = await buildCompressedExport(scope);
    if (token !== ioRenderToken) return;

    currentExportCode = result.code;
    if (codeEl) codeEl.value = result.code;

    if (summaryEl) {
        if (scope === 'all') {
            summaryEl.innerHTML =
                `<strong>📦 전부 내보내기</strong> — 저장된 프리셋 <strong>${result.counts.presets}개</strong>, 전술 페이지 <strong>${result.counts.tactics}개</strong>, 현재 보드/슬롯(${result.counts.currentSteps}스텝) 및 3종 아이콘 크기${result.counts.hasCustomCamps ? '·커스텀 캠프 좌표' : ''}가 포함됩니다.`;
        } else {
            summaryEl.innerHTML =
                `<strong>📤 전술 내보내기</strong> — 저장된 전술 페이지 <strong>${result.counts.tactics}개</strong>와 현재 보드(${result.counts.currentSteps}스텝, 객체 ${result.counts.currentObjs}개)를 내보냅니다.`;
        }
    }

    if (statsEl) {
        const kbRaw = (result.plainBytes / 1024).toFixed(2);
        const kbComp = (result.codeBytes / 1024).toFixed(2);
        statsEl.innerText = `원본 JSON ${kbRaw} KB ➔ 압축 코드 ${kbComp} KB (${result.savedPct}% 절감 · ${result.method})`;
    }
}

function copyExportCode() {
    const codeEl = document.getElementById('io-export-code');
    const text = currentExportCode || (codeEl ? codeEl.value : '');
    if (!text) {
        showToast('⚠️ 복사할 압축 코드가 없습니다.');
        return;
    }

    const fallbackCopy = () => {
        if (codeEl) {
            codeEl.select();
            codeEl.setSelectionRange(0, text.length);
            try {
                document.execCommand('copy');
                showToast('📋 압축 코드가 클립보드에 복사되었습니다.');
                return true;
            } catch (e) {}
        }
        return false;
    };

    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(() => {
            showToast('📋 압축 코드가 클립보드에 복사되었습니다.');
        }).catch(() => {
            if (!fallbackCopy()) showToast('⚠️ 복사에 실패했습니다. 텍스트를 직접 복사해 주세요.');
        });
    } else if (!fallbackCopy()) {
        showToast('⚠️ 복사에 실패했습니다. 텍스트를 직접 복사해 주세요.');
    }
}

function downloadExportFile() {
    const text = currentExportCode;
    if (!text) {
        showToast('⚠️ 저장할 내보내기 데이터가 없습니다.');
        return;
    }
    const d = new Date();
    const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
    const filename = `lol-strategy-${currentExportScope}-${stamp}.gudo`;

    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast(`💾 '${filename}' 파일로 저장되었습니다.`);
}

function copyPageLink() {
    const url = window.location.href.split('#')[0];
    const fallbackCopy = () => {
        const ta = document.createElement('textarea');
        ta.value = url;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        ta.setSelectionRange(0, url.length);
        let ok = false;
        try {
            ok = document.execCommand('copy');
        } catch (e) {
            ok = false;
        } finally {
            ta.remove();
        }
        return ok;
    };

    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(() => {
            showToast('🔗 전략 보드 페이지 링크가 클립보드에 복사되었습니다.');
        }).catch(() => {
            if (fallbackCopy()) {
                showToast('🔗 전략 보드 페이지 링크가 클립보드에 복사되었습니다.');
            } else {
                showToast('⚠️ 링크 복사에 실패했습니다.');
            }
        });
    } else if (fallbackCopy()) {
        showToast('🔗 전략 보드 페이지 링크가 클립보드에 복사되었습니다.');
    } else {
        showToast('⚠️ 링크 복사에 실패했습니다.');
    }
}

init();
bindTouchEvents();
setTimeout(() => {
    autoFitMobileMap();
}, 200);

