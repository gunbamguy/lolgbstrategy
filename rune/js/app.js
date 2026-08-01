// ==========================================
// 🚀 LoL Exporter 통합 메인 애플리케이션 (App Module)
// ==========================================

const appState = {
    selectedMainTreeIndex: null,
    selectedSubTreeIndex: null,
    selectedMainRunes: [],
    selectedSubRunes: [],
    selectedSubRuneCount: 0,
    allRunes: [],
    allStatMods: [],
    selectedShardSlots: [null, null, null],
    customLogoImg: null,
    layoutParams: { ...window.APP_CONFIG.DEFAULT_LAYOUT_PARAMS }
};

// 탭 스위칭 제어
function switchAppMode(mode) {
    const tabRune = document.getElementById('tabRuneMode');
    const tabItem = document.getElementById('tabItemMode');
    const btnSwitchRune = document.getElementById('btnSwitchRune');
    const btnSwitchItem = document.getElementById('btnSwitchItem');

    const runeView = document.getElementById('runeAppView');
    const itemView = document.getElementById('itemAppView');
    const appTitle = document.getElementById('appTitle');
    const appSubtitle = document.getElementById('appSubtitle');

    if (mode === 'item') {
        if (tabRune) tabRune.classList.remove('active');
        if (tabItem) tabItem.classList.add('active');
        if (btnSwitchRune) btnSwitchRune.classList.remove('active');
        if (btnSwitchItem) btnSwitchItem.classList.add('active');

        if (runeView) runeView.classList.add('hidden');
        if (itemView) itemView.classList.remove('hidden');

        if (appTitle) appTitle.textContent = '아이템 빌드 엑스포터';
        if (appSubtitle) appSubtitle.textContent = '나만의 리그 오브 레전드 아이템 빌드 세팅을 구성하고 이미지(PNG/JPG)로 내보내세요';
    } else {
        if (tabItem) tabItem.classList.remove('active');
        if (tabRune) tabRune.classList.add('active');
        if (btnSwitchItem) btnSwitchItem.classList.remove('active');
        if (btnSwitchRune) btnSwitchRune.classList.add('active');

        if (itemView) itemView.classList.add('hidden');
        if (runeView) runeView.classList.remove('hidden');

        if (appTitle) appTitle.textContent = '룬 빌드 엑스포터';
        if (appSubtitle) appSubtitle.textContent = '나만의 리그 오브 레전드 룬 페이지를 구성하고 이미지(PNG)로 내보내세요';
    }
}

// 버전 정보
async function getCurrentVersion() {
    try {
        const response = await fetch(window.APP_CONFIG.VERSION_URL);
        if (!response.ok) throw new Error(`Version fetch failed`);
        const versions = await response.json();
        return versions[0];
    } catch (error) {
        console.error('버전 정보를 불러오는데 실패했습니다.', error);
        return '14.1.1';
    }
}

// 룬 정보 불러오기
async function getRunesData(version) {
    const response = await fetch(`https://ddragon.leagueoflegends.com/cdn/${version}/data/ko_KR/runesReforged.json`);
    if (!response.ok) throw new Error(`Runes data fetch failed`);
    return await response.json();
}

// 실시간 룬 카드 미리보기 동기화
async function updateLivePreview() {
    const modalPreviewCanvas = document.getElementById('modalPreviewCanvas');
    if (modalPreviewCanvas) {
        await window.CANVAS_ENGINE.renderCanvasToTarget(modalPreviewCanvas, 'both', appState);
    }
}

// 룬 카드 PNG 저장
async function exportRunes(type) {
    const canvas = document.getElementById('exportCanvas');
    if (!canvas) return;

    const hasMainRunes = document.querySelectorAll('#mainSecondaryRuneImages img.selected').length > 0;
    const hasSubRunes = document.querySelectorAll('#subSecondaryRuneImages img.selected').length > 0;

    if (type === 'main' && !hasMainRunes) {
        alert('주 빌드에서 선택된 룬이 없습니다.');
        return;
    }
    if (type === 'sub' && !hasSubRunes) {
        alert('보조 빌드에서 선택된 룬이 없습니다.');
        return;
    }
    if ((type === 'both' || type === 'transparent') && !hasMainRunes && !hasSubRunes) {
        alert('내보낼 룬이 선택되지 않았습니다.');
        return;
    }

    await window.CANVAS_ENGINE.renderCanvasToTarget(canvas, type, appState);

    const imgData = canvas.toDataURL('image/png');
    const link = document.createElement('a');
    link.href = imgData;
    link.download = `lol_runes_${type}_${Date.now()}.png`;
    link.click();
}

function renderRuneTreeImages(runeTree, containerId, isMainPage = true) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = '';

    runeTree.forEach((tree, treeIndex) => {
        const img = document.createElement('img');
        img.src = `https://ddragon.leagueoflegends.com/cdn/img/${tree.icon}`;
        img.alt = tree.name;
        img.title = tree.name;
        img.crossOrigin = "anonymous";

        img.onclick = () => {
            if (isMainPage) {
                appState.selectedMainTreeIndex = treeIndex;
                selectMainRune(tree, 'mainSecondaryRuneImages');
            } else {
                appState.selectedSubTreeIndex = treeIndex;
                selectSubRune(tree, 'subSecondaryRuneImages');
            }
            const siblings = container.querySelectorAll('img');
            siblings.forEach(sibling => {
                if (sibling === img) {
                    sibling.classList.add('selected');
                    sibling.classList.remove('dimmed');
                } else {
                    sibling.classList.remove('selected');
                    sibling.classList.add('dimmed');
                }
            });
            window.APP_STORAGE.saveStateToLocalStorage(appState);
            updateLivePreview();
        };
        container.appendChild(img);
    });
}

function selectMainRune(runeData, containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = '';
    appState.selectedMainRunes = [];

    runeData.slots.forEach((slot, slotIndex) => {
        const slotDiv = document.createElement('div');
        slotDiv.classList.add('rune-slot');
        appState.selectedMainRunes[slotIndex] = null;

        slot.runes.forEach(rune => {
            const img = document.createElement('img');
            img.src = `https://ddragon.leagueoflegends.com/cdn/img/${rune.icon}`;
            img.alt = rune.name;
            img.title = rune.name;
            img.dataset.id = rune.id;
            img.crossOrigin = "anonymous";

            img.onclick = () => {
                const currentSlotImgs = slotDiv.querySelectorAll('img');
                currentSlotImgs.forEach(image => {
                    if (image === img) {
                        image.classList.add('selected');
                        image.classList.remove('dimmed');
                    } else {
                        image.classList.remove('selected');
                        image.classList.add('dimmed');
                    }
                });
                appState.selectedMainRunes[slotIndex] = img;
                window.APP_STORAGE.saveStateToLocalStorage(appState);
                updateLivePreview();
            };
            slotDiv.appendChild(img);
        });
        container.appendChild(slotDiv);
    });
}

function selectSubRune(runeData, containerId) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = '';
    appState.selectedSubRunes = [];
    appState.selectedSubRuneCount = 0;

    runeData.slots.forEach((slot, slotIndex) => {
        if (slotIndex === 0) return;

        const slotDiv = document.createElement('div');
        slotDiv.classList.add('rune-slot');

        slot.runes.forEach(rune => {
            const img = document.createElement('img');
            img.src = `https://ddragon.leagueoflegends.com/cdn/img/${rune.icon}`;
            img.alt = rune.name;
            img.title = rune.name;
            img.dataset.id = rune.id;
            img.crossOrigin = "anonymous";

            img.onclick = () => {
                const currentSelectedInSlot = slotDiv.querySelector('img.selected');

                if (img.classList.contains('selected')) {
                    // 클릭한 룬이 이미 선택된 룬이면 해제 (토글 OFF)
                    img.classList.remove('selected');
                    appState.selectedSubRunes = appState.selectedSubRunes.filter(i => i !== img);
                    appState.selectedSubRuneCount--;
                } else {
                    if (currentSelectedInSlot) {
                        // 같은 슬롯 내 다른 룬이 선택되어 있었던 경우 -> 슬롯 내 교체 (카운트 유지)
                        currentSelectedInSlot.classList.remove('selected');
                        appState.selectedSubRunes = appState.selectedSubRunes.filter(i => i !== currentSelectedInSlot);
                        img.classList.add('selected');
                        appState.selectedSubRunes.push(img);
                    } else {
                        // 슬롯에 기존 선택된 룬이 없었던 경우
                        if (appState.selectedSubRuneCount >= 2) {
                            // 이미 2개가 채워져 있으면 가장 오래전에 선택된 룬을 밀어내고 스마트 교체 (3번 슬롯도 자유롭게 선택 가능)
                            const oldestSelected = appState.selectedSubRunes.shift();
                            if (oldestSelected) {
                                oldestSelected.classList.remove('selected');
                            }
                            img.classList.add('selected');
                            appState.selectedSubRunes.push(img);
                        } else {
                            img.classList.add('selected');
                            appState.selectedSubRunes.push(img);
                            appState.selectedSubRuneCount++;
                        }
                    }
                }
                updateSubRuneDimming();
                window.APP_STORAGE.saveStateToLocalStorage(appState);
                updateLivePreview();
            };
            slotDiv.appendChild(img);
        });
        container.appendChild(slotDiv);
    });
}

function updateSubRuneDimming() {
    const slots = document.querySelectorAll('#subSecondaryRuneImages .rune-slot');
    slots.forEach(slotDiv => {
        slotDiv.querySelectorAll('img').forEach(img => {
            if (img.classList.contains('selected')) {
                img.classList.remove('dimmed');
            } else {
                if (appState.selectedSubRuneCount >= 2) {
                    img.classList.add('dimmed');
                } else {
                    img.classList.remove('dimmed');
                }
            }
        });
    });
}

function renderRuneShardImages(statMods) {
    const shardSlotIds = ['runeShardSlot1', 'runeShardSlot2', 'runeShardSlot3'];
    shardSlotIds.forEach((slotId, slotIndex) => {
        const container = document.getElementById(slotId);
        if (!container) return;
        container.innerHTML = '';

        statMods[slotIndex].forEach((statMod, statIndex) => {
            const img = document.createElement('img');
            img.src = statMod.icon;
            img.alt = statMod.name;
            img.title = statMod.name;
            img.crossOrigin = "anonymous";

            if (statIndex === 0) {
                img.classList.add('selected');
                appState.selectedShardSlots[slotIndex] = statMod;
            } else {
                img.classList.add('hidden');
            }

            img.onclick = () => {
                if (!img.classList.contains('selected')) {
                    container.querySelectorAll('img').forEach(image => {
                        image.classList.remove('selected');
                        image.classList.add('hidden');
                    });
                    img.classList.add('selected');
                    img.classList.remove('hidden');
                    appState.selectedShardSlots[slotIndex] = statMod;
                } else {
                    container.querySelectorAll('img').forEach(image => {
                        image.classList.remove('hidden');
                    });
                }
                window.APP_STORAGE.saveStateToLocalStorage(appState);
                updateLivePreview();
            };
            container.appendChild(img);
        });
    });
}

function resetAllRunes() {
    document.querySelectorAll('.rune-images img, .rune-shard-slot img').forEach(img => {
        img.classList.remove('selected', 'dimmed', 'hidden');
    });

    appState.selectedMainTreeIndex = null;
    appState.selectedSubTreeIndex = null;
    appState.selectedMainRunes = [];
    appState.selectedSubRunes = [];
    appState.selectedSubRuneCount = 0;
    appState.selectedShardSlots = [null, null, null];

    document.getElementById('mainSecondaryRuneImages').innerHTML = '';
    document.getElementById('subSecondaryRuneImages').innerHTML = '';

    renderRuneShardImages(appState.allStatMods);
    localStorage.removeItem(window.APP_CONFIG.LOCAL_STORAGE_KEY);
    updateLivePreview();
}

function updateModalSliderValues() {
    document.getElementById('modalCanvasScaleRange').value = appState.layoutParams.canvasScale || 100;
    document.getElementById('modalCanvasScaleVal').textContent = appState.layoutParams.canvasScale || 100;

    document.getElementById('modalLogoSizeRange').value = appState.layoutParams.logoSize || 44;
    document.getElementById('modalLogoSizeVal').textContent = appState.layoutParams.logoSize || 44;

    document.getElementById('modalColGapRange').value = appState.layoutParams.colGap;
    document.getElementById('modalColGapVal').textContent = appState.layoutParams.colGap;

    document.getElementById('modalRuneSizeRange').value = appState.layoutParams.runeIconSize;
    document.getElementById('modalRuneSizeVal').textContent = appState.layoutParams.runeIconSize;

    document.getElementById('modalSlotGapYRange').value = appState.layoutParams.slotGapY;
    document.getElementById('modalSlotGapYVal').textContent = appState.layoutParams.slotGapY;

    document.getElementById('modalPaddingRange').value = appState.layoutParams.padding;
    document.getElementById('modalPaddingVal').textContent = appState.layoutParams.padding;

    document.getElementById('modalLogoOffsetYRange').value = appState.layoutParams.logoOffsetY;
    document.getElementById('modalLogoOffsetYVal').textContent = appState.layoutParams.logoOffsetY;
}

function setCustomLogoFile(file) {
    if (!file || !file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
            appState.customLogoImg = img;
            const previewImg = document.getElementById('customLogoImgPreview');
            const previewArea = document.getElementById('customLogoPreviewArea');
            if (previewImg && previewArea) {
                previewImg.src = e.target.result;
                previewArea.classList.remove('hidden');
            }
            window.APP_STORAGE.saveStateToLocalStorage(appState);
            updateLivePreview();
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
}

function removeCustomLogo() {
    appState.customLogoImg = null;
    const previewImg = document.getElementById('customLogoImgPreview');
    const previewArea = document.getElementById('customLogoPreviewArea');
    const logoFileInput = document.getElementById('logoFileInput');
    if (previewImg) previewImg.src = '';
    if (previewArea) previewArea.classList.add('hidden');
    if (logoFileInput) logoFileInput.value = '';
    window.APP_STORAGE.saveStateToLocalStorage(appState);
    updateLivePreview();
}

function initUIEvents() {
    const textInput = document.getElementById('textInput');
    const fontSizeRange = document.getElementById('fontSizeRange');
    const textColor = document.getElementById('textColor');
    const opacityRange = document.getElementById('opacityRange');
    const cornerRadiusRange = document.getElementById('cornerRadiusRange');
    const showLogoCheck = document.getElementById('showLogoCheck');
    const textDisplay = document.getElementById('textDisplay');
    const logoFileInput = document.getElementById('logoFileInput');
    const btnRemoveCustomLogo = document.getElementById('btnRemoveCustomLogo');
    const logoDropZone = document.getElementById('logoDropZone');

    const layoutModal = document.getElementById('layoutModal');
    const btnOpenLayoutModal = document.getElementById('btnOpenLayoutModal');
    const btnCloseModal = document.getElementById('btnCloseModal');
    const btnSaveModalLayout = document.getElementById('btnSaveModalLayout');
    const btnResetModalLayout = document.getElementById('btnResetModalLayout');

    const tabRuneMode = document.getElementById('tabRuneMode');
    const tabItemMode = document.getElementById('tabItemMode');
    const btnSwitchRune = document.getElementById('btnSwitchRune');
    const btnSwitchItem = document.getElementById('btnSwitchItem');

    if (tabRuneMode) tabRuneMode.addEventListener('click', () => switchAppMode('rune'));
    if (tabItemMode) tabItemMode.addEventListener('click', () => switchAppMode('item'));
    if (btnSwitchRune) btnSwitchRune.addEventListener('click', () => switchAppMode('rune'));
    if (btnSwitchItem) btnSwitchItem.addEventListener('click', () => switchAppMode('item'));

    const updateUIPreview = () => {
        if (textDisplay) {
            textDisplay.textContent = textInput.value;
            textDisplay.style.fontSize = `${fontSizeRange.value}px`;
            textDisplay.style.color = textColor.value;
        }
        document.getElementById('fontSizeValue').textContent = `${fontSizeRange.value}px`;
        document.getElementById('opacityValue').textContent = opacityRange.value;
        document.getElementById('cornerRadiusValue').textContent = `${cornerRadiusRange.value}`;
        window.APP_STORAGE.saveStateToLocalStorage(appState);
        updateLivePreview();
    };

    textInput.addEventListener('input', updateUIPreview);
    fontSizeRange.addEventListener('input', updateUIPreview);
    textColor.addEventListener('input', updateUIPreview);
    opacityRange.addEventListener('input', updateUIPreview);
    cornerRadiusRange.addEventListener('input', updateUIPreview);
    showLogoCheck.addEventListener('change', updateUIPreview);

    document.getElementById('modalCanvasScaleRange').addEventListener('input', (e) => {
        document.getElementById('modalCanvasScaleVal').textContent = e.target.value;
        appState.layoutParams.canvasScale = parseInt(e.target.value, 10);
        updateLivePreview();
    });

    document.getElementById('modalLogoSizeRange').addEventListener('input', (e) => {
        document.getElementById('modalLogoSizeVal').textContent = e.target.value;
        appState.layoutParams.logoSize = parseInt(e.target.value, 10);
        updateLivePreview();
    });

    document.getElementById('modalColGapRange').addEventListener('input', (e) => {
        document.getElementById('modalColGapVal').textContent = e.target.value;
        appState.layoutParams.colGap = parseInt(e.target.value, 10);
        updateLivePreview();
    });

    document.getElementById('modalRuneSizeRange').addEventListener('input', (e) => {
        document.getElementById('modalRuneSizeVal').textContent = e.target.value;
        appState.layoutParams.runeIconSize = parseInt(e.target.value, 10);
        updateLivePreview();
    });

    document.getElementById('modalSlotGapYRange').addEventListener('input', (e) => {
        document.getElementById('modalSlotGapYVal').textContent = e.target.value;
        appState.layoutParams.slotGapY = parseInt(e.target.value, 10);
        updateLivePreview();
    });

    document.getElementById('modalPaddingRange').addEventListener('input', (e) => {
        document.getElementById('modalPaddingVal').textContent = e.target.value;
        appState.layoutParams.padding = parseInt(e.target.value, 10);
        updateLivePreview();
    });

    document.getElementById('modalLogoOffsetYRange').addEventListener('input', (e) => {
        document.getElementById('modalLogoOffsetYVal').textContent = e.target.value;
        appState.layoutParams.logoOffsetY = parseInt(e.target.value, 10);
        updateLivePreview();
    });

    if (btnOpenLayoutModal && layoutModal) {
        btnOpenLayoutModal.addEventListener('click', () => {
            updateModalSliderValues();
            layoutModal.classList.remove('hidden');
            updateLivePreview();
        });
    }

    if (btnCloseModal && layoutModal) {
        btnCloseModal.addEventListener('click', () => {
            layoutModal.classList.add('hidden');
        });
    }

    if (btnSaveModalLayout && layoutModal) {
        btnSaveModalLayout.addEventListener('click', () => {
            window.APP_STORAGE.saveStateToLocalStorage(appState);
            layoutModal.classList.add('hidden');
        });
    }

    if (btnResetModalLayout) {
        btnResetModalLayout.addEventListener('click', () => {
            appState.layoutParams = { ...window.APP_CONFIG.DEFAULT_LAYOUT_PARAMS };
            updateModalSliderValues();
            window.APP_STORAGE.saveStateToLocalStorage(appState);
            updateLivePreview();
        });
    }

    if (logoFileInput) {
        logoFileInput.addEventListener('change', (e) => {
            if (e.target.files && e.target.files[0]) {
                setCustomLogoFile(e.target.files[0]);
            }
        });
    }

    if (btnRemoveCustomLogo) {
        btnRemoveCustomLogo.addEventListener('click', removeCustomLogo);
    }

    document.addEventListener('paste', (e) => {
        const items = e.clipboardData && e.clipboardData.items;
        if (!items) return;
        for (let item of items) {
            if (item.type.indexOf('image') !== -1) {
                const file = item.getAsFile();
                setCustomLogoFile(file);
                break;
            }
        }
    });

    if (logoDropZone) {
        logoDropZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            logoDropZone.classList.add('dragover');
        });
        logoDropZone.addEventListener('dragleave', () => {
            logoDropZone.classList.remove('dragover');
        });
        logoDropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            logoDropZone.classList.remove('dragover');
            if (e.dataTransfer.files && e.dataTransfer.files[0]) {
                setCustomLogoFile(e.dataTransfer.files[0]);
            }
        });
    }

    document.getElementById('btnExportBoth').addEventListener('click', () => exportRunes('both'));
    document.getElementById('btnExportMain').addEventListener('click', () => exportRunes('main'));
    document.getElementById('btnExportSub').addEventListener('click', () => exportRunes('sub'));
    document.getElementById('btnExportTransparent').addEventListener('click', () => exportRunes('transparent'));
    document.getElementById('btnReset').addEventListener('click', resetAllRunes);
}

// FOW 전적 파싱 룬 자동 세팅 수신함수
// [Fail 11~13 대응] DOM .click() 비동기 엇갈림 근본 차단
// 방법: 주 빌드는 .click() + data-id 정확 매칭, 보조 빌드는 주 빌드 완전 정착 후 실행
function checkAndApplyImportedRune(runesData) {
    try {
        const savedImport = localStorage.getItem('gudo_imported_rune');
        if (!savedImport) return;

        const imported = JSON.parse(savedImport);
        const targetMainId = parseInt(imported.mainRuneId, 10);
        const targetSubId = parseInt(imported.subTreeId, 10);

        if (!targetMainId) return;

        console.log('[FOW Import] 시작 - mainRuneId:', targetMainId, 'subTreeId:', targetSubId);

        // 유틸: ms만큼 지연
        function delay(ms) {
            return new Promise(resolve => setTimeout(resolve, ms));
        }

        // 1. 주 룬이 속한 계열(tree) 인덱스 탐색
        let mainTreeIdx = -1;
        runesData.forEach((tree, idx) => {
            tree.slots.forEach(slot => {
                if (slot.runes.some(r => r.id === targetMainId)) {
                    mainTreeIdx = idx;
                }
            });
        });

        // 2. 보조 계열 인덱스 탐색
        let subTreeIdx = runesData.findIndex(t => t.id === targetSubId);

        console.log('[FOW Import] mainTreeIdx:', mainTreeIdx, 'subTreeIdx:', subTreeIdx);

        // 순차 실행 체인
        (async function applyRuneSequence() {
            // === STEP 1: 주 빌드 계열 클릭 ===
            if (mainTreeIdx !== -1) {
                const mainImgs = document.querySelectorAll('#mainRuneImages img');
                console.log('[FOW Import] STEP1 주계열 img 개수:', mainImgs.length, '클릭 인덱스:', mainTreeIdx);
                if (mainImgs[mainTreeIdx]) {
                    mainImgs[mainTreeIdx].click();
                }
                await delay(200);

                // === STEP 2: 주 빌드 키스톤 data-id 정확 선택 ===
                const targetRuneImg = document.querySelector(`#mainSecondaryRuneImages img[data-id="${targetMainId}"]`);
                console.log('[FOW Import] STEP2 키스톤 찾기 data-id=' + targetMainId + ':', targetRuneImg ? '발견' : '미발견');
                if (targetRuneImg) {
                    targetRuneImg.click();
                }
                await delay(100);

                // === STEP 3: 주 빌드 나머지 슬롯 첫번째 룬 자동 채우기 ===
                const mainSlots = document.querySelectorAll('#mainSecondaryRuneImages .rune-slot');
                mainSlots.forEach((slot, i) => {
                    if (!slot.querySelector('img.selected')) {
                        const firstImg = slot.querySelector('img');
                        if (firstImg) {
                            console.log('[FOW Import] STEP3 주빌드 슬롯', i, '자동 채움');
                            firstImg.click();
                        }
                    }
                });
                await delay(200);
            }

            // === STEP 4: 보조 빌드 계열 선택 ===
            if (subTreeIdx !== -1 && subTreeIdx !== mainTreeIdx) {
                const subImgs = document.querySelectorAll('#subRuneImages img');
                console.log('[FOW Import] STEP4 보조계열 img 개수:', subImgs.length, '클릭 인덱스:', subTreeIdx);
                if (subImgs[subTreeIdx]) {
                    subImgs[subTreeIdx].click();
                }
                await delay(300); // 보조 빌드 UI 렌더링 완전 대기 (넉넉하게)

                // === STEP 5: 보조 빌드 룬 2개 자동 선택 ===
                const subSlots = document.querySelectorAll('#subSecondaryRuneImages .rune-slot');
                console.log('[FOW Import] STEP5 보조 슬롯 개수:', subSlots.length);
                // 영감(8300) 계열인 경우 대표 조합인 2번 슬롯(신발/외상) + 3번 슬롯(우주적 통찰 등) 선택
                const slotsToPick = (targetSubId === 8300 && subSlots.length >= 3) ? [1, 2] : [0, 1];
                let subSelectedCount = 0;

                for (const slotIdx of slotsToPick) {
                    if (subSlots[slotIdx]) {
                        const img = subSlots[slotIdx].querySelector('img');
                        if (img) {
                            console.log('[FOW Import] STEP5 보조룬 슬롯', slotIdx, '클릭:', img.alt);
                            img.click();
                            subSelectedCount++;
                            await delay(100);
                        }
                    }
                }
                console.log('[FOW Import] STEP5 보조룬 선택 완료 count:', subSelectedCount);
                await delay(100);
            } else {
                console.warn('[FOW Import] 보조 계열 건너뜀 - subTreeIdx:', subTreeIdx, 'mainTreeIdx:', mainTreeIdx);
            }

            // === STEP 6: adr 능력치 파편 3개 선택 ===
            ['runeShardSlot1', 'runeShardSlot2', 'runeShardSlot3'].forEach(slotId => {
                const container = document.getElementById(slotId);
                if (container && !container.querySelector('img.selected')) {
                    const firstShard = container.querySelector('img');
                    if (firstShard) firstShard.click();
                }
            });

            // === STEP 7: 텍스트 라벨 설정 및 정리 ===
            if (imported.mainChamp) {
                const textInput = document.getElementById('textInput');
                if (textInput) textInput.value = `${imported.mainChamp} FOW 룬 세팅`;
            }

            localStorage.removeItem('gudo_imported_rune');
            window.APP_STORAGE.saveStateToLocalStorage(appState);
            updateLivePreview();
            console.log('[FOW Import] 완료 - 최종 appState subTreeIndex:', appState.selectedSubTreeIndex, 'subRunes:', appState.selectedSubRunes.length);
        })();

    } catch (e) {
        console.warn('Imported rune application error:', e);
    }
}

// 메인 초기화 실행
document.addEventListener('DOMContentLoaded', async () => {
    initUIEvents();

    if (window.ITEM_ENGINE) {
        await window.ITEM_ENGINE.init();
    }

    try {
        const version = await getCurrentVersion();
        const runesData = await getRunesData(version);
        const statModsData = window.APP_CONFIG.getStatModsData();

        appState.allRunes = runesData;
        appState.allStatMods = statModsData;

        renderRuneTreeImages(runesData, 'mainRuneImages', true);
        renderRuneTreeImages(runesData, 'subRuneImages', false);
        renderRuneShardImages(statModsData);

        // FOW 파싱 룬 import 데이터가 있으면 기존 상태 복원을 건너뜀
        // [Fail 11~13 대응] restoreState의 setTimeout .click()이 import 세팅을 덮어쓰는 것을 방지
        const hasImportedRune = localStorage.getItem('gudo_imported_rune');

        if (!hasImportedRune) {
            // 기존 저장 상태 복원 (import 데이터 없을 때만)
            window.APP_STORAGE.restoreStateFromLocalStorage(runesData, appState, {
                updateModalSliders: updateModalSliderValues,
                updateUIPreview: () => {
                    const textInput = document.getElementById('textInput');
                    const textDisplay = document.getElementById('textDisplay');
                    const fontSizeRange = document.getElementById('fontSizeRange');
                    const textColor = document.getElementById('textColor');
                    if (textDisplay) {
                        textDisplay.textContent = textInput.value;
                        textDisplay.style.fontSize = `${fontSizeRange.value}px`;
                        textDisplay.style.color = textColor.value;
                    }
                }
            });
        } else {
            // FOW import 시: 이전 저장 상태를 제거하고 새로 세팅
            localStorage.removeItem(window.APP_CONFIG.LOCAL_STORAGE_KEY);
        }

        // FOW 파싱 룬 자동 세팅 수신 (import 데이터 있을 때만 실제 동작)
        checkAndApplyImportedRune(runesData);

        updateLivePreview();
    } catch (error) {
        console.error('초기 데이터 로딩 중 에러가 발생했습니다.', error);
    }

    // URL 해시 기반 자동 탭 전환 (#item → 아이템 모드)
    if (window.location.hash === '#item') {
        switchAppMode('item');
    }
});

