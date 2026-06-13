const MAP_BASE_WIDTH = 1203.3;
const MAP_BASE_HEIGHT = 800;

window.currentDragData = null;
let myTeamSide = 'blue';

let currentMode = 'map';
let selectedScreenshotId = null;

let currentVersion = "";
let championData = {};
let champIconSize = 40;
let isAutoSizeEnabled = true;

const obsChannel = new BroadcastChannel('lol_board_obs');
let isSyncMouseEnabled = true;
let wsConnection = null;
let wsRetryCount = 0;
const MAX_WS_RETRIES = 5;

function initWebSocket() {
    if (wsRetryCount >= MAX_WS_RETRIES) {
        console.warn(`[안내] WebSocket 연결 시도를 ${MAX_WS_RETRIES}회 실패하여 재연결을 중단합니다. 정적 웹페이지(GitHub Pages 등) 환경에서는 동일 브라우저 내 탭 간 동기화(BroadcastChannel)만 원활히 작동합니다.`);
        return;
    }

    const wsProto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${wsProto}//${window.location.host}`;
    wsConnection = new WebSocket(wsUrl);
    
    wsConnection.onopen = () => {
        console.log("WebSocket 연결 성공");
        wsRetryCount = 0;
        syncObsScene();
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
}

function sendToObs(message) {
    console.log("[sendToObs] 보냄:", message.type, message);
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
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 4.0;

function adjustZoom(delta, clientX, clientY) {
    const mapArea = document.getElementById('map-area');
    const rect = mapArea.getBoundingClientRect();
    
    // 마우스 상대 위치 계산 (지정되지 않은 경우 뷰포트 중앙 기준)
    const mouseX = clientX !== undefined ? (clientX - rect.left) : (rect.width / 2);
    const mouseY = clientY !== undefined ? (clientY - rect.top) : (rect.height / 2);
    
    // 줌 전의 맵 기준 마우스 절대 위치 (1:1 비율)
    const mapX = (mouseX + mapArea.scrollLeft) / zoomLevel;
    const mapY = (mouseY + mapArea.scrollTop) / zoomLevel;
    
    const nextZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoomLevel + delta));
    if (nextZoom === zoomLevel) return;
    
    zoomLevel = nextZoom;
    applyZoom();
    
    // 줌 후의 새로운 스크롤 위치 보정
    mapArea.scrollLeft = mapX * zoomLevel - mouseX;
    mapArea.scrollTop = mapY * zoomLevel - mouseY;
    
    if (typeof syncObsViewport === 'function') {
        syncObsViewport();
    }
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
        initWebSocket();

        // 맵 스크롤(패닝)이 발생할 때 실시간 뷰포트 동기화 송신
        document.getElementById('map-area').addEventListener('scroll', () => {
            syncObsViewport();
        });

        // 챔피언 크기 슬라이더 이벤트 바인딩
        document.getElementById('size-slider').addEventListener('input', (e) => {
            champIconSize = parseInt(e.target.value);
            document.getElementById('size-indicator').innerText = champIconSize + "px";
            renderScene();
        });

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

        // 자동 조절 체크박스 이벤트 바인딩 및 초기화
        const autoSizeCheckbox = document.getElementById('auto-size-checkbox');
        const sizeSlider = document.getElementById('size-slider');
        
        // 기본값 반영 및 초기화
        sizeSlider.disabled = isAutoSizeEnabled;
        if (isAutoSizeEnabled) {
            applyAutoSize();
        }
        
        autoSizeCheckbox.addEventListener('change', (e) => {
            isAutoSizeEnabled = e.target.checked;
            sizeSlider.disabled = isAutoSizeEnabled;
            if (isAutoSizeEnabled) {
                applyAutoSize();
            }
        });

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
        renderScreenshots();
        setAppMode('map'); // 기본 앱 모드는 맵 모드
    } catch (e) { console.error(e); }
}

function applyAutoSize() {
    if (!isAutoSizeEnabled) return;
    // 비율 계산: 120% (1.2) -> 40px, 400% (4.0) -> 15px
    // 수식: 40 - (25 / 2.8) * (zoomLevel - 1.2)
    let calculatedSize = Math.round(40 - (25 / 2.8) * (zoomLevel - 1.2));
    calculatedSize = Math.max(15, Math.min(70, calculatedSize));
    
    champIconSize = calculatedSize;
    
    // UI 업데이트
    const sizeSlider = document.getElementById('size-slider');
    sizeSlider.value = calculatedSize;
    document.getElementById('size-indicator').innerText = calculatedSize + "px";
    
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

            // 빈 배경이면 그리기 시작
            const isMapBg = e.target === mapArea || e.target === mapEl || e.target === structureLayer || e.target === svgLayer || e.target.tagName === 'path' || e.target.tagName === 'line' || e.target.closest('path') || e.target.closest('line');
            if (isMapBg) {
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
            
            if (dragType === 'object') {
                draggedObj.x = cx;
                draggedObj.y = cy;
                draggedEl.style.left = cx + "px";
                draggedEl.style.top = cy + "px";
                updateArrowLine(draggedObj);
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
            const cy = (e.clientY - mapRect.top) / zoomLevel;
            
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
            recordHistory();
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
    currentStepIndex = snapshot.stepIndex;
    renderScene();
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
    });
}

function addSelectedToPreset(team) {
    if (!selectedChampKey) return;
    const targetList = team === 'blue' ? bluePreset : redPreset;
    
    if (targetList.includes(selectedChampKey)) {
        alert("이미 프리셋에 추가된 챔피언입니다.");
        return;
    }
    if (targetList.length >= 5) {
        alert("팀당 최대 5명까지 추가할 수 있습니다.");
        return;
    }
    
    targetList.push(selectedChampKey);
    renderPresets();
    
    // 선택 해제
    selectedChampKey = null;
    document.querySelectorAll('#champList .icon-item').forEach(el => el.classList.remove('selected'));
    document.getElementById('btn-add-blue').disabled = true;
    document.getElementById('btn-add-red').disabled = true;
}

function renderPresets() {
    renderSinglePreset('blue', bluePreset);
    renderSinglePreset('red', redPreset);
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
            window.currentDragData = { dragType: "new-champion", champId: key };
        });
        img.addEventListener('dragstart', (e) => {
            e.stopPropagation();
            const dragData = { dragType: "new-champion", champId: key };
            window.currentDragData = dragData;
            e.dataTransfer.setData("text/plain", JSON.stringify(dragData));
            e.dataTransfer.setData("dragType", "new-champion");
            e.dataTransfer.setData("champId", key);
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
        if (champ.name.includes(filter) || key.toLowerCase().includes(filter.toLowerCase())) {
            const img = document.createElement('img');
            img.src = key === "Locke" ? "images/Locke.png" : `https://ddragon.leagueoflegends.com/cdn/${currentVersion}/img/champion/${key}.png`;
            img.className = `icon-item ${selectedChampKey === key ? 'selected' : ''}`;
            img.draggable = true;
            img.title = champ.name;
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
    document.querySelectorAll('.sidebar-tabs .tab-btn').forEach(btn => {
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
            return JSON.parse(data);
        } catch(e) {
            return [];
        }
    }
    return [];
}

function savePresetsToStorage(presets) {
    localStorage.setItem('lol_strategy_user_presets', JSON.stringify(presets));
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
    document.querySelectorAll('.toolbar-group #tool-pen, .toolbar-group #tool-arrow, .toolbar-group #tool-eraser').forEach(btn => {
        btn.classList.remove('active');
    });
    const activeBtn = document.getElementById(`tool-${tool}`);
    if (activeBtn) activeBtn.classList.add('active');
    
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
    const currentData = JSON.parse(JSON.stringify(timelineData[currentStepIndex] || []));
    timelineData.splice(currentStepIndex + 1, 0, currentData);
    currentStepIndex++;
    renderScene();
    recordHistory();
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
    svgLayer.querySelectorAll('line, path').forEach(l => l.remove());
    
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
    svgLayer.querySelectorAll('line, path').forEach(l => l.remove());
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
        else if (obj.type === 'ping' || obj.type === 'ward' || obj.type === 'object') renderDOM(obj, 'placed-object placed-icon');
        else if (obj.type === 'free_arrow') renderStartCtrl(obj);
    });
}

function renderDOM(obj, className) {
    let el = document.getElementById(obj.uid);
    
    if (!el) {
        // DOM 생성
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
        // 클릭 이벤트 바인딩
        el.addEventListener('click', (e) => {
            e.stopPropagation();
            clearSelection();
            selectedObjUid = obj.uid;
            el.classList.add('selected');
        });
        // 이벤트 등록 (최초 1회)
        addDragEvents(el); 
        mapEl.appendChild(el);
    }

    // [핵심] DOM 요소에 '현재 스텝의 데이터 객체'를 연결하여 최신 상태 유지
    el._dataObj = obj;

    // 선택 상태 클래스 처리
    if (obj.uid === selectedObjUid) {
        el.classList.add('selected');
    } else {
        el.classList.remove('selected');
    }

    // 고정 크기 복원
    const baseSize = obj.type === 'champion' ? champIconSize : (obj.type === 'minion' ? 44 : 32);
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
            selectedObjUid = obj.uid;
            el.classList.add('selected');
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
        timelineData[currentStepIndex].push({
            type: 'champion',
            uid: "champ_" + Date.now() + "_" + Math.random().toString(36).substr(2, 5),
            champId: champId,
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
            alert("프리셋에 등록된 챔피언이 없습니다.");
            return;
        }
        
        list.forEach((champKey, idx) => {
            const offsetX = (idx - (list.length - 1) / 2) * 50;
            const targetX = Math.max(0, Math.min(MAP_BASE_WIDTH, x + offsetX));
            const targetY = y;
            
            const champUid = "champ_" + champKey;
            const currentObjs = timelineData[currentStepIndex];
            const existing = currentObjs.find(o => o.uid === champUid);
            
            if (existing) {
                existing.x = targetX;
                existing.y = targetY;
            } else {
                currentObjs.push({
                    type: 'champion',
                    uid: champUid,
                    champId: champKey,
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
    
    svgLayer.querySelectorAll('line').forEach(l => {
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
    const arrowMenu = document.getElementById('menu-add-arrow');
    if (obj.type === 'free_arrow' || obj.type === 'pen_stroke') {
        arrowMenu.style.display = 'none';
    } else {
        arrowMenu.style.display = 'block';
        arrowMenu.innerText = (obj.arrow && obj.arrow.hasArrow) ? "➤ 화살표 제거" : "➤ 화살표 추가";
    }
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
    
    // 기존 맵 위의 정글 몹 필터링 및 제거
    const nonJungleObjs = nowObjs.filter(o => {
        if (o.type === 'object') {
            const src = o.src ? o.src.toLowerCase() : '';
            return !(src.includes('gromp') || 
                     src.includes('wolf') || 
                     src.includes('raptor') || 
                     src.includes('krug') || 
                     src.includes('scuttler') || 
                     src.includes('blue') || 
                     src.includes('red'));
        }
        return true;
    });

    const newCamps = camps.map((camp, idx) => ({
        type: camp.type,
        uid: "monster_camp_" + Date.now() + "_" + Math.random().toString(36).substr(2, 5) + "_" + idx,
        src: camp.src,
        x: camp.x,
        y: camp.y,
        minionType: camp.minionType,
        arrow: { hasArrow: false, dx: 0, dy: 0 }
    }));

    timelineData[currentStepIndex] = [...nonJungleObjs, ...newCamps];
    
    renderScene();
    recordHistory();
    alert(`총 ${newCamps.length}개의 정글 몬스터가 일괄 젠되었습니다!`);
}

let isSyncScheduled = false;

function syncObsScene(immediate = false) {
    const runSync = () => {
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
            type: 'sync-scene',
            timelineData: timelineData,
            currentStepIndex: currentStepIndex,
            myTeamSide: myTeamSide,
            zoomLevel: zoomLevel,
            champIconSize: champIconSize,
            currentVersion: currentVersion,
            viewport: viewportData,
            currentMode: currentMode,
            selectedScreenshotId: selectedScreenshotId,
            screenshots: getScreenshotsFromStorage()
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
    console.log("[syncObsViewport] 호출됨, zoomLevel:", zoomLevel);
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
    const data = localStorage.getItem('lol_strategy_screenshots');
    if (data) {
        try {
            return JSON.parse(data);
        } catch(e) {
            return [];
        }
    }
    return [];
}

function saveScreenshotsToStorage(list) {
    try {
        localStorage.setItem('lol_strategy_screenshots', JSON.stringify(list));
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
            mapEl.style.backgroundImage = "url(images/Summoner's_Rift_map_s14.png)";
            mapEl.style.backgroundColor = 'transparent';
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
}

function handleScreenshotPaste(e) {
    if (currentMode !== 'screenshot') return;
    
    const items = (e.clipboardData || e.originalEvent.clipboardData).items;
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

init();
