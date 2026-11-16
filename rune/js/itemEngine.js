// ==========================================
// ⚔️ 아이템 익스포터 엔진 모듈 (Item Engine + Preset System)
// ==========================================

let itemVersion = '';
let itemMap = {};
let selectedItemSlot = null;
let currentCategory = null;
let activeSectorEl = null;

// 📦 커스텀 프리셋 시스템 전용 변수
let presets = [];
let activePresetId = null;
let editingPreset = null;
let isSelectingForPreset = false;

const tagTranslations = {
    "Boots": "신발",
    "ManaRegen": "마나 재생",
    "HealthRegen": "체력 재생",
    "Health": "체력",
    "CriticalStrike": "치명타",
    "SpellDamage": "주문력",
    "Mana": "마나",
    "Armor": "방어력",
    "SpellBlock": "마법 저항력",
    "LifeSteal": "생명력 흡수",
    "SpellVamp": "주문 흡혈",
    "Jungle": "정글",
    "Damage": "데미지",
    "Lane": "라인",
    "AttackSpeed": "공격 속도",
    "OnHit": "적중 효과",
    "Trinket": "장신구",
    "Active": "사용 효과",
    "Consumable": "소모품",
    "CooldownReduction": "스킬 가속",
    "AbilityHaste": "스킬 가속",
    "Stealth": "은신",
    "Vision": "시야",
    "NonbootsMovement": "이동 속도 (신발 제외)",
    "Tenacity": "강인함",
    "MagicPenetration": "마법 관통",
    "Aura": "오라",
    "Slow": "둔화",
    "MagicResist": "마법 저항",
    "GoldPer": "골드 획득"
};

// 🔤 한글 초성 추출 유틸리티 (예: "메자이" -> "ㅁㅈㅇ")
function getChosung(str) {
    const chosungList = [
        'ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ',
        'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'
    ];
    let result = '';
    for (let i = 0; i < str.length; i++) {
        const code = str.charCodeAt(i) - 44032;
        if (code >= 0 && code <= 11172) {
            result += chosungList[Math.floor(code / 588)];
        } else {
            result += str.charAt(i);
        }
    }
    return result;
}

// 🎯 아이템 검색 매칭 (이름, 라이엇 내장 별칭/초성, 직접 추출한 초성)
function matchItem(item, query) {
    if (!query) return true;
    const cleanQuery = query.trim().toLowerCase();
    if (!cleanQuery) return true;

    const itemName = (item.name || '').toLowerCase();
    if (itemName.includes(cleanQuery)) return true;

    const colloq = (item.colloq || '').toLowerCase();
    if (colloq.includes(cleanQuery)) return true;

    const itemChosung = getChosung(itemName);
    if (itemChosung.includes(cleanQuery)) return true;

    return false;
}

// 🔤 Base64 UTF-8 안전 인코딩 / 디코딩 유틸리티 (다른 PC 프리셋 호환)
function toBase64(str) {
    try {
        return btoa(encodeURIComponent(str).replace(/%([0-9A-F]{2})/g, (match, p1) => String.fromCharCode('0x' + p1)));
    } catch (e) {
        return '';
    }
}

function fromBase64(str) {
    try {
        return decodeURIComponent(Array.prototype.map.call(atob(str.trim()), (c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join(''));
    } catch (e) {
        return null;
    }
}

// 🛡️ 불러온 데이터 검증 유틸리티 (XSS / 속성 탈출 / 외부 URL 차단)
const SAFE_IMG_HOSTS = ['ddragon.leagueoflegends.com', 'raw.communitydragon.org', 'z.fow.lol'];

function sanitizeImgSrc(src) {
    if (typeof src !== 'string') return '';
    const s = src.trim();
    if (/^data:image\/(png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(s)) return s;
    try {
        const u = new URL(s);
        if (u.protocol === 'https:' && SAFE_IMG_HOSTS.includes(u.hostname)) return u.href;
    } catch (e) {}
    return '';
}

function sanitizeText(value, maxLen) {
    return String(value == null ? '' : value).replace(/[\u0000-\u001f\u007f]/g, '').slice(0, maxLen || 60);
}

function sanitizeItemIdList(list) {
    if (!Array.isArray(list)) return [];
    return list.map(v => String(v)).filter(v => /^\d{1,6}$/.test(v)).slice(0, 100);
}

function sanitizeImportedPreset(p, fallbackName) {
    if (!p || typeof p !== 'object') return null;
    return {
        id: 'preset_' + Date.now() + '_' + Math.floor(Math.random() * 100000),
        name: sanitizeText(p.name, 60) || fallbackName || '불러온 프리셋',
        items: sanitizeItemIdList(p.items)
    };
}

function createSafeItemImg(item) {
    const img = document.createElement('img');
    const safeSrc = sanitizeImgSrc(item && item.src);
    if (safeSrc) img.src = safeSrc;
    const name = sanitizeText(item && item.name, 80);
    img.alt = name;
    img.title = name;
    img.setAttribute('data-id', sanitizeText(item && item.id, 20));
    return img;
}

// 🖐️ 모달 헤더 드래그 이동 유틸리티 함수
function makeModalDraggable(modalEl, handleEl) {
    if (!modalEl || !handleEl) return;
    let isDragging = false;
    let startX = 0, startY = 0, initialLeft = 0, initialTop = 0;

    handleEl.addEventListener('mousedown', (e) => {
        isDragging = true;
        startX = e.clientX;
        startY = e.clientY;

        const rect = modalEl.getBoundingClientRect();
        initialLeft = rect.left;
        initialTop = rect.top;

        modalEl.style.transform = 'none';
        modalEl.style.left = `${initialLeft}px`;
        modalEl.style.top = `${initialTop}px`;
        modalEl.style.margin = '0';

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
    });

    function onMouseMove(e) {
        if (!isDragging) return;
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;
        modalEl.style.left = `${initialLeft + dx}px`;
        modalEl.style.top = `${initialTop + dy}px`;
    }

    function onMouseUp() {
        isDragging = false;
        document.removeEventListener('mousemove', onMouseMove);
        document.removeEventListener('mouseup', onMouseUp);
    }
}

window.ITEM_ENGINE = {
    init: async function() {
        try {
            const verRes = await fetch(window.APP_CONFIG.VERSION_URL);
            const versions = await verRes.json();
            itemVersion = versions[0] || '14.1.1';

            const itemRes = await fetch(`https://ddragon.leagueoflegends.com/cdn/${itemVersion}/data/ko_KR/item.json`);
            const itemData = await itemRes.json();
            itemMap = itemData.data || {};
        } catch (e) {
            console.error('아이템 데이터 로딩 실패:', e);
        }

        this.bindEvents();
        this.loadPresetsFromStorage();
        this.checkAndApplyImportedItems();
    },

    checkAndApplyImportedItems: function() {
        try {
            const saved = localStorage.getItem('gudo_imported_items');
            if (!saved) return;
            const imported = JSON.parse(saved);
            const mainItems = imported.mainItems || [];
            const wardItem = imported.wardItem || null;

            // 1. 메인 에디터 슬롯 초기화 및 1~3, 4(와드), 5~7 슬롯 매핑
            this.clearSlots();

            mainItems.slice(0, 3).forEach((item, idx) => {
                const slot = document.querySelector(`#item-container .item-slot[data-slot="${idx + 1}"]`);
                if (slot && item) {
                    slot.innerHTML = '';
                    slot.appendChild(createSafeItemImg(item));
                }
            });

            if (wardItem) {
                const wardSlot = document.querySelector('#item-container .item-slot[data-slot="4"]');
                if (wardSlot) {
                    wardSlot.innerHTML = '';
                    wardSlot.appendChild(createSafeItemImg(wardItem));
                }
            }

            mainItems.slice(3, 6).forEach((item, idx) => {
                const slot = document.querySelector(`#item-container .item-slot[data-slot="${idx + 5}"]`);
                if (slot && item) {
                    slot.innerHTML = '';
                    slot.appendChild(createSafeItemImg(item));
                }
            });

            // 2. 1단계 ~ N단계 (시간 순서 누적 템트리 라인) 섹터들 생성
            const captureContainer = document.getElementById('capture-container');
            if (captureContainer) {
                let rowContainer = captureContainer.querySelector('.capture-row');
                if (!rowContainer) {
                    rowContainer = document.createElement('div');
                    rowContainer.classList.add('capture-row');
                    captureContainer.appendChild(rowContainer);
                } else {
                    rowContainer.innerHTML = ''; // 기존 섹터 초기화
                }

                // 1개부터 mainItems.length 까지 누적 단계 생성
                for (let step = 1; step <= mainItems.length; step++) {
                    const currentStageItems = mainItems.slice(0, step);

                    if (rowContainer.children.length > 0) {
                        const arrow = document.createElement('div');
                        arrow.classList.add('arrow-connector');
                        arrow.textContent = '➔';
                        rowContainer.appendChild(arrow);
                    }

                    const captureSector = document.createElement('div');
                    captureSector.classList.add('capture-sector');
                    captureSector.title = `${step}단계 아이템 빌드`;

                    const btnDelete = document.createElement('button');
                    btnDelete.type = 'button';
                    btnDelete.classList.add('btn-sector-mini-delete');
                    btnDelete.setAttribute('data-html2canvas-ignore', 'true');
                    btnDelete.textContent = '✖';
                    captureSector.appendChild(btnDelete);

                    let gridContainer = document.createElement('div');
                    gridContainer.classList.add('mini-grid-container');

                    // 슬롯 1~3, 4(와드), 5~7에 맞게 mini-slot 배치
                    for (let sIdx = 1; sIdx <= 7; sIdx++) {
                        const capturedSlot = document.createElement('div');
                        capturedSlot.classList.add('mini-slot');
                        if (sIdx === 4) {
                            capturedSlot.classList.add('ward-slot');
                            if (wardItem) {
                                const img = document.createElement('img');
                                const safeWardSrc = sanitizeImgSrc(wardItem.src);
                                if (safeWardSrc) img.src = safeWardSrc;
                                img.alt = sanitizeText(wardItem.name, 80);
                                capturedSlot.appendChild(img);
                            }
                        } else {
                            const mainIdx = sIdx < 4 ? sIdx - 1 : sIdx - 2;
                            if (mainIdx < currentStageItems.length) {
                                const it = currentStageItems[mainIdx];
                                const img = document.createElement('img');
                                const safeItemSrc = sanitizeImgSrc(it.src);
                                if (safeItemSrc) img.src = safeItemSrc;
                                img.alt = sanitizeText(it.name, 80);
                                capturedSlot.appendChild(img);
                            }
                        }
                        gridContainer.appendChild(capturedSlot);
                    }

                    captureSector.appendChild(gridContainer);

                    captureSector.addEventListener('click', () => {
                        this.setActiveSector(captureSector);
                        this.loadSectorToMainSlots(captureSector);
                    });

                    btnDelete.addEventListener('click', (e) => {
                        e.stopPropagation();
                        let prev = captureSector.previousElementSibling;
                        let next = captureSector.nextElementSibling;
                        if (prev && prev.classList.contains('arrow-connector')) prev.remove();
                        else if (next && next.classList.contains('arrow-connector')) next.remove();
                        captureSector.remove();
                    });

                    rowContainer.appendChild(captureSector);
                }
            }

            localStorage.removeItem('gudo_imported_items');
            console.log("⚔️ FOW 파싱 1~6단계 누적 아이템 빌드 트리 생성 완료!");
        } catch (e) {
            console.warn('Imported items application error:', e);
        }
    },



    setActiveSlot: function(slot) {
        document.querySelectorAll('#item-container .item-slot').forEach(s => s.classList.remove('active-slot'));
        if (slot) {
            slot.classList.add('active-slot');
            selectedItemSlot = slot;
        }
    },

    bindEvents: function() {
        const self = this;

        // 🖐️ 모달 윗줄 전용 구획 드래그 이동 영역 연결 (#item-modal-drag-handle)
        const itemPopup = document.getElementById('item-popup');
        const itemPopupDragZone = document.getElementById('item-modal-drag-handle');
        if (itemPopup && itemPopupDragZone) {
            makeModalDraggable(itemPopup, itemPopupDragZone);
        }
        document.querySelectorAll('#item-container .item-slot').forEach(slot => {
            // ❌ Ctrl + 클릭 (또는 Cmd + 클릭) 시 슬롯 아이템 즉시 제거
            slot.addEventListener('click', (event) => {
                event.stopPropagation();
                if (event.ctrlKey || event.metaKey) {
                    slot.innerHTML = '';
                    slot.classList.remove('active-slot');
                    return;
                }
                self.setActiveSlot(slot);
                self.handleSlotClick();
            });

            // 🖱️ 우클릭(contextmenu) 시 기본 컨텍스트 메뉴 차단 후 아이템 제거
            slot.addEventListener('contextmenu', (event) => {
                event.preventDefault();
                event.stopPropagation();
                slot.innerHTML = '';
                slot.classList.remove('active-slot');
            });
        });

        const closeCategory = document.getElementById('close-popup');
        if (closeCategory) {
            closeCategory.addEventListener('click', () => {
                document.getElementById('category-popup').classList.add('hidden');
            });
        }

        const closeItem = document.getElementById('close-item-popup');
        const closeItemTop = document.getElementById('close-item-popup-top');
        const closeHandler = () => {
            document.getElementById('item-popup').classList.add('hidden');
            document.querySelectorAll('#item-container .item-slot').forEach(s => s.classList.remove('active-slot'));
            isSelectingForPreset = false;
        };
        if (closeItem) closeItem.addEventListener('click', closeHandler);
        if (closeItemTop) closeItemTop.addEventListener('click', closeHandler);

        // 🔍 검색창 실시간 입력 이벤트 핸들러
        const searchInput = document.getElementById('item-search-input');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                self.renderItemList(currentCategory, e.target.value);
            });
        }

        const btnSelect = document.getElementById('select-button');
        if (btnSelect) btnSelect.addEventListener('click', () => self.addNewSector());

        const btnCancel = document.getElementById('cancel-last-button');
        if (btnCancel) btnCancel.addEventListener('click', () => self.cancelLastSector());

        const btnClear = document.getElementById('clear-button');
        if (btnClear) btnClear.addEventListener('click', () => self.clearSlots());

        // ✏️ 모달 내부 [템트리 라인 수정] 버튼 이벤트 -> 선택된 섹터 수정 갱신
        const modalAddTreeBtn = document.getElementById('modal-add-tree-btn');
        if (modalAddTreeBtn) {
            modalAddTreeBtn.addEventListener('click', () => self.updateSelectedSector());
        }

        // 📦 프리셋 관리 버튼 바인딩
        const btnCreatePreset = document.getElementById('btn-create-preset');
        if (btnCreatePreset) {
            btnCreatePreset.addEventListener('click', () => self.openPresetModal());
        }

        const btnImportCode = document.getElementById('btn-import-preset-code');
        if (btnImportCode) {
            btnImportCode.addEventListener('click', () => self.importPresetCode());
        }

        // 💾 TXT 전체 내보내기 & 📂 TXT 파일 불러오기 버튼 연결
        const btnExportAllTxt = document.getElementById('btn-export-all-presets-txt');
        if (btnExportAllTxt) {
            btnExportAllTxt.addEventListener('click', () => self.exportAllPresetsTxt());
        }

        const btnImportTxtFile = document.getElementById('btn-import-presets-txt-file');
        const presetFileInput = document.getElementById('preset-file-input');
        if (btnImportTxtFile && presetFileInput) {
            btnImportTxtFile.addEventListener('click', () => presetFileInput.click());
            presetFileInput.addEventListener('change', (e) => {
                if (e.target.files && e.target.files.length > 0) {
                    self.importPresetsFromTxtFile(e.target.files[0]);
                    e.target.value = ''; // 재선택 가능하도록 리셋
                }
            });
        }

        const btnClosePresetModal = document.getElementById('close-preset-modal');
        const btnCancelPreset = document.getElementById('btn-cancel-preset');
        if (btnClosePresetModal) btnClosePresetModal.addEventListener('click', () => self.closePresetModal());
        if (btnCancelPreset) btnCancelPreset.addEventListener('click', () => self.closePresetModal());

        const btnSavePreset = document.getElementById('btn-save-preset');
        if (btnSavePreset) btnSavePreset.addEventListener('click', () => self.saveEditingPreset());

        const btnAddItemToPreset = document.getElementById('btn-add-item-to-preset');
        if (btnAddItemToPreset) {
            btnAddItemToPreset.addEventListener('click', () => {
                isSelectingForPreset = true;
                self.displayItemsByCategory('All');
            });
        }

        // 🎯 PNG/JPG 템트리 내보내기
        const btnExportPng = document.getElementById('export-png-button');
        if (btnExportPng) {
            btnExportPng.addEventListener('click', () => {
                const captureContainer = document.getElementById('capture-container');
                if (captureContainer && captureContainer.children.length > 0) {
                    self.exportElementAsImage(captureContainer, 'lol_item_build_tree', 'png');
                } else {
                    alert('내보낼 섹터 기록이 없습니다. 먼저 [➕ 템트리 라인 추가] 버튼을 눌러주세요.');
                }
            });
        }

        const btnExportJpg = document.getElementById('export-jpg-button');
        if (btnExportJpg) {
            btnExportJpg.addEventListener('click', () => {
                const captureContainer = document.getElementById('capture-container');
                if (captureContainer && captureContainer.children.length > 0) {
                    self.exportElementAsImage(captureContainer, 'lol_item_build_tree', 'jpg');
                } else {
                    alert('내보낼 섹터 기록이 없습니다. 먼저 [➕ 템트리 라인 추가] 버튼을 눌러주세요.');
                }
            });
        }

        const btnExportAllSlots = document.getElementById('export-all-slots-png-button');
        if (btnExportAllSlots) {
            btnExportAllSlots.addEventListener('click', () => {
                const itemContainer = document.getElementById('item-container');
                if (itemContainer) {
                    self.exportElementAsImage(itemContainer, 'lol_items_slots', 'png');
                }
            });
        }
    },

    // 📦 프리셋 저장소 로드/저장/관리 함수들
    loadPresetsFromStorage: function() {
        try {
            const saved = localStorage.getItem('lol_item_presets');
            if (saved) {
                const parsedSaved = JSON.parse(saved);
                presets = (Array.isArray(parsedSaved) ? parsedSaved : []).map(p => {
                    if (!p || typeof p !== 'object') return null;
                    return {
                        id: sanitizeText(p.id, 60) || ('preset_' + Date.now() + '_' + Math.floor(Math.random() * 100000)),
                        name: sanitizeText(p.name, 60) || '무제 프리셋',
                        items: sanitizeItemIdList(p.items)
                    };
                }).filter(Boolean);
            } else {
                presets = [
                    {
                        id: 'preset_sample_1',
                        name: '🛡️ 브루저 핵심 아이템 세트',
                        items: ['3078', '3071', '6333', '3053', '3161', '3074']
                    }
                ];
                this.savePresetsToStorage();
            }
        } catch (e) {
            presets = [];
        }
        if (presets.length > 0 && !activePresetId) {
            activePresetId = presets[0].id;
        }
        this.renderPresetCards();
    },

    savePresetsToStorage: function() {
        localStorage.setItem('lol_item_presets', JSON.stringify(presets));
    },

    renderPresetCards: function() {
        const container = document.getElementById('preset-list-container');
        if (!container) return;
        container.innerHTML = '';
        const self = this;

        if (presets.length === 0) {
            const emptyMsg = document.createElement('div');
            emptyMsg.style.gridColumn = '1 / -1';
            emptyMsg.style.color = '#8b9ab5';
            emptyMsg.style.textAlign = 'center';
            emptyMsg.style.padding = '20px 0';
            emptyMsg.textContent = '등록된 프리셋이 없습니다. [➕ 새 프리셋 생성] 버튼을 눌러보세요.';
            container.appendChild(emptyMsg);
            return;
        }

        presets.forEach(p => {
            const card = document.createElement('div');
            card.classList.add('preset-card');
            if (p.id === activePresetId) {
                card.classList.add('active-preset');
            }

            const header = document.createElement('div');
            header.classList.add('preset-card-header');

            const title = document.createElement('div');
            title.classList.add('preset-card-title');
            title.textContent = p.name || '무제 프리셋';

            const activeBadge = document.createElement('span');
            if (p.id === activePresetId) {
                activeBadge.style.fontSize = '0.72rem';
                activeBadge.style.background = 'var(--gold-primary)';
                activeBadge.style.color = '#000';
                activeBadge.style.padding = '2px 8px';
                activeBadge.style.borderRadius = '10px';
                activeBadge.style.fontWeight = 'bold';
                activeBadge.textContent = '선택 적용됨';
            }
            header.appendChild(title);
            if (p.id === activePresetId) header.appendChild(activeBadge);

            const itemsPreview = document.createElement('div');
            itemsPreview.classList.add('preset-items-preview');

            if (p.items && p.items.length > 0) {
                p.items.forEach(itemId => {
                    const img = document.createElement('img');
                    img.src = `https://ddragon.leagueoflegends.com/cdn/${itemVersion}/img/item/${itemId}.png`;
                    const itemData = itemMap[itemId];
                    if (itemData) img.title = itemData.name;
                    itemsPreview.appendChild(img);
                });
            } else {
                itemsPreview.innerHTML = '<span style="font-size: 0.8rem; color: #8b9ab5;">(아이템 없음)</span>';
            }

            const actions = document.createElement('div');
            actions.classList.add('preset-card-actions');

            const btnApply = document.createElement('button');
            btnApply.type = 'button';
            btnApply.classList.add('btn', 'btn-primary');
            btnApply.style.padding = '4px 10px';
            btnApply.style.fontSize = '0.78rem';
            btnApply.textContent = (p.id === activePresetId) ? '✓ 사용 중' : '불러오기/적용';
            btnApply.addEventListener('click', () => {
                activePresetId = p.id;
                self.renderPresetCards();
            });

            const btnExportCode = document.createElement('button');
            btnExportCode.type = 'button';
            btnExportCode.classList.add('btn', 'btn-secondary');
            btnExportCode.style.padding = '4px 10px';
            btnExportCode.style.fontSize = '0.78rem';
            btnExportCode.textContent = '📤 코드 내보내기';
            btnExportCode.title = '다른 PC로 전달 가능한 Base64 코드로 내보내기';
            btnExportCode.addEventListener('click', () => self.exportPresetCode(p));

            const btnEdit = document.createElement('button');
            btnEdit.type = 'button';
            btnEdit.classList.add('btn', 'btn-secondary');
            btnEdit.style.padding = '4px 10px';
            btnEdit.style.fontSize = '0.78rem';
            btnEdit.textContent = '✏️ 수정';
            btnEdit.addEventListener('click', () => self.openPresetModal(p));

            const btnDel = document.createElement('button');
            btnDel.type = 'button';
            btnDel.classList.add('btn', 'btn-danger');
            btnDel.style.padding = '4px 10px';
            btnDel.style.fontSize = '0.78rem';
            btnDel.textContent = '🗑️';
            btnDel.addEventListener('click', () => {
                if (confirm(`'${p.name}' 프리셋을 삭제하시겠습니까?`)) {
                    presets = presets.filter(item => item.id !== p.id);
                    if (activePresetId === p.id) {
                        activePresetId = presets.length > 0 ? presets[0].id : null;
                    }
                    self.savePresetsToStorage();
                    self.renderPresetCards();
                }
            });

            actions.appendChild(btnApply);
            actions.appendChild(btnExportCode);
            actions.appendChild(btnEdit);
            actions.appendChild(btnDel);

            card.appendChild(header);
            card.appendChild(itemsPreview);
            card.appendChild(actions);

            container.appendChild(card);
        });
    },

    // 📤 단일 프리셋 Base64 코드 생성 내보내기
    exportPresetCode: function(preset) {
        if (!preset) return;
        const data = {
            name: preset.name,
            items: preset.items || []
        };
        const jsonStr = JSON.stringify(data);
        const code = toBase64(jsonStr);

        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(code).then(() => {
                alert(`'${preset.name}' 프리셋 코드가 클립보드에 복사되었습니다!\n\n다른 PC나 브라우저에서 [📥 코드 불러오기] 버튼을 눌러 붙여넣으세요.\n\n코드: ${code.substring(0, 40)}...`);
            }).catch(() => {
                prompt(`아래 프리셋 복사 코드를 복사(Ctrl+C)하세요:`, code);
            });
        } else {
            prompt(`아래 프리셋 복사 코드를 복사(Ctrl+C)하세요:`, code);
        }
    },

    // 📥 Base64 코드로 프리셋 불러오기
    importPresetCode: function() {
        const inputCode = prompt('다른 PC에서 내보낸 프리셋 Base64 코드를 붙여넣으세요:');
        if (!inputCode || !inputCode.trim()) return;

        const jsonStr = fromBase64(inputCode);
        if (!jsonStr) {
            alert('올바르지 않은 프리셋 코드입니다.');
            return;
        }

        try {
            const data = JSON.parse(jsonStr);
            if (!data || !data.name || !Array.isArray(data.items)) {
                throw new Error('Invalid format');
            }

            const newPreset = sanitizeImportedPreset(data, '불러온 프리셋');
            if (!newPreset) throw new Error('Invalid format');
            newPreset.id = 'preset_' + Date.now();

            presets.push(newPreset);
            activePresetId = newPreset.id;
            this.savePresetsToStorage();
            this.renderPresetCards();
            alert(`'${newPreset.name}' 프리셋을 성공적으로 불러왔습니다!`);
        } catch (e) {
            alert('프리셋 데이터를 파싱할 수 없습니다. 코드를 다시 확인해주세요.');
        }
    },

    // 💾 모든 프리셋 목록 통째로 TXT 파일로 다운로드 내보내기
    exportAllPresetsTxt: function() {
        if (!presets || presets.length === 0) {
            alert('저장된 프리셋이 없습니다.');
            return;
        }

        const backupData = {
            version: '1.0',
            exportedAt: new Date().toLocaleString(),
            count: presets.length,
            presets: presets
        };

        const jsonString = JSON.stringify(backupData, null, 2);
        const blob = new Blob([jsonString], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url;
        const now = new Date();
        const dateStr = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
        a.download = `lol_presets_all_backup_${dateStr}.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    },

    // 📂 TXT 파일로 전체 프리셋 불러오기
    importPresetsFromTxtFile: function(file) {
        if (!file) return;

        const reader = new FileReader();
        const self = this;

        reader.onload = function(e) {
            try {
                const content = e.target.result;
                if (!content || !content.trim()) {
                    alert('파일이 비어있습니다.');
                    return;
                }

                let parsed;
                try {
                    parsed = JSON.parse(content);
                } catch (err) {
                    const decoded = fromBase64(content);
                    if (decoded) parsed = JSON.parse(decoded);
                }

                let importedList = [];
                if (parsed) {
                    if (Array.isArray(parsed)) {
                        importedList = parsed;
                    } else if (parsed.presets && Array.isArray(parsed.presets)) {
                        importedList = parsed.presets;
                    } else if (parsed.name && Array.isArray(parsed.items)) {
                        importedList = [parsed];
                    }
                }

                if (importedList.length === 0) {
                    alert('유효한 프리셋 데이터를 찾을 수 없습니다.');
                    return;
                }

                const safeList = importedList.map(item => sanitizeImportedPreset(item, '불러온 프리셋')).filter(Boolean).slice(0, 200);
                if (safeList.length === 0) {
                    alert('유효한 프리셋 데이터를 찾을 수 없습니다.');
                    return;
                }
                importedList = safeList;

                const appendMode = confirm(`총 ${importedList.length}개의 프리셋을 발견했습니다.\n\n[확인]: 기존 프리셋에 추가하기 (추천)\n[취소]: 기존 목록을 지우고 파일 내용으로 완전히 덮어쓰기`);

                if (appendMode) {
                    importedList.forEach(item => {
                        presets.push(item);
                    });
                } else {
                    presets = importedList.slice();
                }

                if (presets.length > 0) {
                    activePresetId = presets[0].id;
                }

                self.savePresetsToStorage();
                self.renderPresetCards();
                alert(`프리셋 ${importedList.length}개가 정상적으로 동기화/불러와졌습니다!`);
            } catch (err) {
                console.error(err);
                alert('파일을 불러오는 도중 오류가 발생했습니다. TXT 파일 형식을 확인해주세요.');
            }
        };

        reader.readAsText(file, 'UTF-8');
    },

    openPresetModal: function(presetToEdit = null) {
        const modal = document.getElementById('preset-modal');
        const titleEl = document.getElementById('preset-modal-title');
        const nameInput = document.getElementById('preset-name-input');
        if (!modal || !nameInput) return;

        if (presetToEdit) {
            editingPreset = JSON.parse(JSON.stringify(presetToEdit));
            if (titleEl) titleEl.textContent = '✏️ 프리셋 수정';
            nameInput.value = editingPreset.name;
        } else {
            editingPreset = {
                id: 'preset_' + Date.now(),
                name: '',
                items: []
            };
            if (titleEl) titleEl.textContent = '📦 새 프리셋 생성';
            nameInput.value = '';
        }

        this.renderEditingPresetItems();
        modal.classList.remove('hidden');
    },

    closePresetModal: function() {
        const modal = document.getElementById('preset-modal');
        if (modal) modal.classList.add('hidden');
        editingPreset = null;
        isSelectingForPreset = false;
    },

    renderEditingPresetItems: function() {
        const container = document.getElementById('preset-item-collection');
        const countEl = document.getElementById('preset-item-count');
        if (!container || !editingPreset) return;

        container.innerHTML = '';
        if (countEl) countEl.textContent = editingPreset.items.length;

        if (editingPreset.items.length === 0) {
            container.innerHTML = '<span style="font-size: 0.82rem; color: #8b9ab5; margin: 0 auto;">아이템이 없습니다. 위 [➕ 아이템 검색 추가] 버튼을 눌러 담으세요.</span>';
            return;
        }

        const self = this;
        editingPreset.items.forEach((itemId, idx) => {
            const chip = document.createElement('div');
            chip.classList.add('preset-chip-item');

            const img = document.createElement('img');
            img.src = `https://ddragon.leagueoflegends.com/cdn/${itemVersion}/img/item/${itemId}.png`;
            const itemData = itemMap[itemId];
            if (itemData) img.title = itemData.name;

            const removeBtn = document.createElement('button');
            removeBtn.type = 'button';
            removeBtn.classList.add('chip-remove-btn');
            removeBtn.textContent = '✕';
            removeBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                editingPreset.items.splice(idx, 1);
                self.renderEditingPresetItems();
            });

            chip.appendChild(img);
            chip.appendChild(removeBtn);
            container.appendChild(chip);
        });
    },

    saveEditingPreset: function() {
        const nameInput = document.getElementById('preset-name-input');
        if (!editingPreset || !nameInput) return;

        const name = nameInput.value.trim();
        if (!name) {
            alert('프리셋 이름을 입력해주세요.');
            return;
        }

        editingPreset.name = name;

        const existingIndex = presets.findIndex(p => p.id === editingPreset.id);
        if (existingIndex !== -1) {
            presets[existingIndex] = editingPreset;
        } else {
            presets.push(editingPreset);
        }

        activePresetId = editingPreset.id;
        this.savePresetsToStorage();
        this.renderPresetCards();
        this.closePresetModal();
    },

    handleSlotClick: function() {
        if (!selectedItemSlot || !itemMap) return;
        const isWard = selectedItemSlot.classList.contains('ward-slot');
        const defaultCategory = isWard ? 'Trinket' : 'All';
        this.displayItemsByCategory(defaultCategory);
    },

    showCategoryPopup: function(categories) {
        // 더 이상 사용되지 않는 카테고리 중간 팝업
    },

    displayItemsByCategory: function(category) {
        currentCategory = category || 'All';
        const itemPopup = document.getElementById('item-popup');
        const searchInput = document.getElementById('item-search-input');

        if (searchInput) {
            searchInput.value = '';
        }

        this.renderCategoryTabs(currentCategory);
        this.renderItemList(currentCategory, '');

        if (itemPopup) {
            itemPopup.classList.remove('hidden');
            if (searchInput) searchInput.focus();
        }
    },

    renderCategoryTabs: function(activeCategory) {
        const tabsContainer = document.getElementById('item-category-tabs');
        if (!tabsContainer) return;
        tabsContainer.innerHTML = '';

        const categories = [
            { key: 'All', name: '전체' },
            { key: 'Damage', name: '공격력' },
            { key: 'SpellDamage', name: '주문력' },
            { key: 'Armor', name: '방어력' },
            { key: 'SpellBlock', name: '마법저항' },
            { key: 'Health', name: '체력' },
            { key: 'CriticalStrike', name: '치명타' },
            { key: 'AttackSpeed', name: '공격속도' },
            { key: 'Boots', name: '신발' },
            { key: 'Trinket', name: '장신구' }
        ];

        const self = this;
        categories.forEach(cat => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.classList.add('cat-tab-btn');
            if (cat.key === activeCategory) btn.classList.add('active');
            btn.textContent = cat.name;
            btn.addEventListener('click', () => {
                currentCategory = cat.key;
                tabsContainer.querySelectorAll('.cat-tab-btn').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                const searchInput = document.getElementById('item-search-input');
                const query = searchInput ? searchInput.value : '';
                self.renderItemList(currentCategory, query);
            });
            tabsContainer.appendChild(btn);
        });
    },

    renderItemList: function(category, query) {
        const itemsList = document.getElementById('items-list');
        if (!itemsList) return;

        itemsList.innerHTML = '';
        const self = this;
        let matchCount = 0;
        const hasQuery = query && query.trim().length > 0;
        const isAllAndNoQuery = (category === 'All' && !hasQuery);

        // 📦 사용자가 활성화한 프리셋이 있는 경우 '전체' 탭 상단에 프리셋 추천 구역 노출
        const activePreset = presets.find(p => p.id === activePresetId);
        if (activePreset && activePreset.items && activePreset.items.length > 0 && !hasQuery && !isSelectingForPreset) {
            const recommendSec = document.createElement('div');
            recommendSec.classList.add('preset-recommend-section');
            recommendSec.style.gridColumn = '1 / -1';

            const recTitle = document.createElement('div');
            recTitle.classList.add('preset-recommend-title');
            recTitle.textContent = `📦 [${activePreset.name}] 프리셋 아이템 목록`;

            const recGrid = document.createElement('div');
            recGrid.classList.add('preset-recommend-grid');

            activePreset.items.forEach(itemId => {
                const item = itemMap[itemId];
                if (item) {
                    const itemDiv = document.createElement('div');
                    itemDiv.classList.add('item-grid-item');

                    const img = document.createElement('img');
                    img.src = `https://ddragon.leagueoflegends.com/cdn/${itemVersion}/img/item/${itemId}.png`;
                    img.alt = item.name;
                    img.title = `[프리셋] ${item.name}`;

                    itemDiv.appendChild(img);
                    recGrid.appendChild(itemDiv);

                    itemDiv.addEventListener('click', () => {
                        self.selectItem(itemId, item.name);
                    });
                }
            });

            recommendSec.appendChild(recTitle);
            recommendSec.appendChild(recGrid);
            itemsList.appendChild(recommendSec);
        }

        // 검색어가 없고 '전체' 탭인 경우 안내 메시지
        if (isAllAndNoQuery) {
            const infoMsg = document.createElement('div');
            infoMsg.style.gridColumn = '1 / -1';
            infoMsg.style.textAlign = 'center';
            infoMsg.style.color = '#a0abbd';
            infoMsg.style.padding = '24px 0';
            infoMsg.style.fontSize = '0.9rem';
            infoMsg.innerHTML = `💡 <strong>초성(예: ㅁㅈㅇ, 몰왕) 또는 이름을 검색</strong>하거나<br>상단 <strong>카테고리(공격력, 주문력 등)</strong>를 선택하세요.`;
            itemsList.appendChild(infoMsg);
            return;
        }

        for (const id in itemMap) {
            const item = itemMap[id];
            if (item.inStore !== false) {
                const isCompletedOrMajor = (!item.into || item.into.length === 0) || (item.gold && item.gold.total >= 2100) || (item.tags && (item.tags.includes('Boots') || item.tags.includes('Trinket')));
                const defaultFilterPass = hasQuery || isCompletedOrMajor;
                const categoryMatch = (category === 'All' || hasQuery || (item.tags && item.tags.includes(category)));

                if (defaultFilterPass && categoryMatch && matchItem(item, query)) {
                    matchCount++;
                    const itemDiv = document.createElement('div');
                    itemDiv.classList.add('item-grid-item');
                    itemDiv.dataset.id = id;

                    const img = document.createElement('img');
                    img.src = `https://ddragon.leagueoflegends.com/cdn/${itemVersion}/img/item/${id}.png`;
                    img.alt = item.name;
                    img.title = `${item.name}${item.plaintext ? ' - ' + item.plaintext : ''}`;

                    itemDiv.appendChild(img);
                    itemsList.appendChild(itemDiv);

                    itemDiv.addEventListener('click', () => {
                        if (isSelectingForPreset) {
                            self.addItemToEditingPreset(id);
                        } else {
                            self.selectItem(id, item.name);
                        }
                    });
                }
            }
        }

        if (matchCount === 0) {
            const emptyMsg = document.createElement('div');
            emptyMsg.style.gridColumn = '1 / -1';
            emptyMsg.style.textAlign = 'center';
            emptyMsg.style.color = '#8b9ab5';
            emptyMsg.style.padding = '20px 0';
            emptyMsg.style.fontSize = '0.9rem';
            emptyMsg.textContent = `'${query}' 검색 결과가 없습니다.`;
            itemsList.appendChild(emptyMsg);
        }
    },

    addItemToEditingPreset: function(itemId) {
        if (!editingPreset) return;
        if (!editingPreset.items.includes(itemId)) {
            editingPreset.items.push(itemId);
            this.renderEditingPresetItems();
        }
    },

    selectItem: function(id, name) {
        if (!selectedItemSlot) return;
        selectedItemSlot.innerHTML = '';

        const img = document.createElement('img');
        img.src = `https://ddragon.leagueoflegends.com/cdn/${itemVersion}/img/item/${id}.png`;
        img.alt = name;
        img.title = name;
        img.classList.add('slot-item');
        selectedItemSlot.appendChild(img);

        // 🎯 현재 슬롯에 넣은 후, 다음 슬롯으로 포커스를 자동 이동하여 연속 입력 지원!
        const allSlots = Array.from(document.querySelectorAll('#item-container .item-slot'));
        const currentIndex = allSlots.indexOf(selectedItemSlot);
        if (currentIndex !== -1 && currentIndex < allSlots.length - 1) {
            const nextSlot = allSlots[currentIndex + 1];
            this.setActiveSlot(nextSlot);
            const isWard = nextSlot.classList.contains('ward-slot');
            const nextCategory = isWard ? 'Trinket' : (currentCategory === 'Trinket' ? 'All' : currentCategory);
            this.renderCategoryTabs(nextCategory);
            const searchInput = document.getElementById('item-search-input');
            const query = searchInput ? searchInput.value : '';
            this.renderItemList(nextCategory, query);
        }
    },

    // 🎯 선택된 템트리 섹터 하이라이트 지정
    setActiveSector: function(sector) {
        document.querySelectorAll('#capture-container .capture-sector').forEach(s => s.classList.remove('active-sector'));
        activeSectorEl = sector;
        if (sector) {
            sector.classList.add('active-sector');
        }
    },

    // 🎯 템트리 섹터의 아이템을 상단 메인 에디터 슬롯으로 불러오기
    loadSectorToMainSlots: function(sector) {
        if (!sector) return;
        const miniSlots = sector.querySelectorAll('.mini-slot');
        const mainSlots = document.querySelectorAll('#item-container .item-slot');

        mainSlots.forEach((slot, index) => {
            slot.innerHTML = '';
            const miniSlot = miniSlots[index];
            if (miniSlot) {
                const imgEl = miniSlot.querySelector('img');
                if (imgEl) {
                    const img = document.createElement('img');
                    img.src = imgEl.src;
                    img.alt = imgEl.alt;
                    img.title = imgEl.title || imgEl.alt;
                    img.classList.add('slot-item');
                    slot.appendChild(img);
                }
            }
        });

        if (mainSlots.length > 0) {
            this.setActiveSlot(mainSlots[0]);
        }
    },

    // 🎯 메인 에디터 슬롯의 아이템으로 지정 템트리 섹터 갱신 (Update)
    updateSectorGrid: function(sector) {
        let gridContainer = sector.querySelector('.mini-grid-container');
        if (!gridContainer) {
            gridContainer = document.createElement('div');
            gridContainer.classList.add('mini-grid-container');
            sector.appendChild(gridContainer);
        }
        gridContainer.innerHTML = '';

        document.querySelectorAll('#item-container .item-slot').forEach(slot => {
            const capturedSlot = document.createElement('div');
            capturedSlot.classList.add('mini-slot');
            if (slot.classList.contains('ward-slot')) {
                capturedSlot.classList.add('ward-slot');
            }

            const imgEl = slot.querySelector('img');
            if (imgEl) {
                const img = document.createElement('img');
                img.src = imgEl.src;
                img.alt = imgEl.alt;
                img.title = imgEl.title || imgEl.alt;
                capturedSlot.appendChild(img);
            }
            gridContainer.appendChild(capturedSlot);
        });
    },

    // ➕ 메인 화면 버튼: 무조건 신규 템트리 라인 추가
    addNewSector: function() {
        this.setActiveSector(null);
        this.captureSlots();
    },

    // ✏️ 모달 내부 버튼: 선택된 템트리 라인 수정 (없으면 새로 추가)
    updateSelectedSector: function() {
        const captureContainer = document.getElementById('capture-container');
        const rowContainer = captureContainer ? captureContainer.querySelector('.capture-row') : null;

        if (activeSectorEl && rowContainer && rowContainer.contains(activeSectorEl)) {
            this.updateSectorGrid(activeSectorEl);
            activeSectorEl.style.boxShadow = '0 0 24px #f0e6d2';
            setTimeout(() => {
                if (activeSectorEl) activeSectorEl.style.boxShadow = '';
            }, 300);
        } else {
            this.captureSlots();
        }
    },

    captureSlots: function() {
        const captureContainer = document.getElementById('capture-container');
        if (!captureContainer) return;

        let rowContainer = captureContainer.querySelector('.capture-row');
        if (!rowContainer) {
            rowContainer = document.createElement('div');
            rowContainer.classList.add('capture-row');
            captureContainer.appendChild(rowContainer);
        }

        const existingSectors = rowContainer.querySelectorAll('.capture-sector');
        if (existingSectors.length > 0) {
            const arrow = document.createElement('div');
            arrow.classList.add('arrow-connector');
            arrow.textContent = '➔';
            rowContainer.appendChild(arrow);
        }

        const captureSector = document.createElement('div');
        captureSector.classList.add('capture-sector');
        captureSector.title = '클릭하여 메인 슬롯으로 불러온 뒤 모달에서 [✏️ 템트리 라인 수정]을 눌러 수정할 수 있습니다';

        // ✖ 섹터 우측 상단 미니 삭제 버튼
        const btnDelete = document.createElement('button');
        btnDelete.type = 'button';
        btnDelete.classList.add('btn-sector-mini-delete');
        btnDelete.setAttribute('data-html2canvas-ignore', 'true');
        btnDelete.textContent = '✖';
        btnDelete.title = '이 템트리 삭제';
        captureSector.appendChild(btnDelete);

        // 현재 메인 슬롯으로 섹터 내용 채우기
        this.updateSectorGrid(captureSector);

        // 🎯 템트리 섹터 클릭 시: 선택 하이라이트 및 메인 슬롯으로 불러오기 (Load)
        captureSector.addEventListener('click', (e) => {
            this.setActiveSector(captureSector);
            this.loadSectorToMainSlots(captureSector);
        });

        // ✖ 삭제 이벤트
        btnDelete.addEventListener('click', (e) => {
            e.stopPropagation();
            if (activeSectorEl === captureSector) {
                this.setActiveSector(null);
            }
            let prevSibling = captureSector.previousElementSibling;
            let nextSibling = captureSector.nextElementSibling;
            if (prevSibling && prevSibling.classList.contains('arrow-connector')) {
                prevSibling.remove();
            } else if (nextSibling && nextSibling.classList.contains('arrow-connector')) {
                nextSibling.remove();
            }
            captureSector.remove();
        });

        rowContainer.appendChild(captureSector);
        this.setActiveSector(captureSector);
    },

    cancelLastSector: function() {
        const captureContainer = document.getElementById('capture-container');
        if (!captureContainer) return;

        const rowContainer = captureContainer.querySelector('.capture-row');
        if (!rowContainer) return;

        const sectors = rowContainer.querySelectorAll('.capture-sector');
        const arrows = rowContainer.querySelectorAll('.arrow-connector');

        if (sectors.length > 0) {
            const lastSector = sectors[sectors.length - 1];
            lastSector.remove();

            if (arrows.length > 0) {
                const lastArrow = arrows[arrows.length - 1];
                lastArrow.remove();
            }
        }
    },

    clearSlots: function() {
        document.querySelectorAll('#item-container .item-slot').forEach(slot => {
            slot.innerHTML = '';
        });
    },

    // 🎯 PNG일 경우 투명 배경(null), JPG일 경우 검정 다크 배경(#090c10) 적용
    exportElementAsImage: function(element, filename, format = 'png') {
        if (!element || typeof html2canvas === 'undefined') return;

        const isPng = (format === 'png');

        // 캡처 전 미니 ✖ 삭제 버튼 임시 숨김
        const deleteBtns = element.querySelectorAll('.btn-sector-mini-delete');
        deleteBtns.forEach(btn => btn.style.visibility = 'hidden');

        // 캡처 전 선택 슬롯(.active-slot) 및 섹터(.active-sector) 강조 하이라이트 임시 제거
        const activeSlots = document.querySelectorAll('.active-slot');
        const activeSectors = document.querySelectorAll('.active-sector');

        activeSlots.forEach(slot => slot.classList.remove('active-slot'));
        activeSectors.forEach(sec => sec.classList.remove('active-sector'));

        // 📐 캡처 시 딱 출력된 내용물 크기만큼만 맞춰주고 좌우 예쁜 패딩(16px 24px) 임시 부여
        const origDisplay = element.style.display;
        const origWidth = element.style.width;
        const origMaxWidth = element.style.maxWidth;
        const origPadding = element.style.padding;
        const origBoxSizing = element.style.boxSizing;

        element.style.display = 'inline-flex';
        element.style.flexDirection = 'column';
        element.style.width = 'fit-content';
        element.style.maxWidth = 'none';
        element.style.padding = '16px 24px';
        element.style.boxSizing = 'border-box';

        const restoreStyles = () => {
            deleteBtns.forEach(btn => btn.style.visibility = '');
            activeSlots.forEach(slot => slot.classList.add('active-slot'));
            activeSectors.forEach(sec => sec.classList.add('active-sector'));
            element.style.display = origDisplay;
            element.style.width = origWidth;
            element.style.maxWidth = origMaxWidth;
            element.style.padding = origPadding;
            element.style.boxSizing = origBoxSizing;
        };

        html2canvas(element, {
            backgroundColor: isPng ? null : '#090c10',
            useCORS: true,
            allowTaint: true,
            scale: 2,
            ignoreElements: (el) => el.classList && el.classList.contains('btn-sector-mini-delete')
        }).then(canvas => {
            restoreStyles();

            const link = document.createElement('a');
            if (format === 'jpg' || format === 'jpeg') {
                link.href = canvas.toDataURL('image/jpeg', 0.9);
                link.download = `${filename}.jpg`;
            } else {
                link.href = canvas.toDataURL('image/png');
                link.download = `${filename}.png`;
            }
            link.click();
        }).catch(error => {
            restoreStyles();
            console.error('이미지 내보내기 중 오류 발생:', error);
        });
    }
};
