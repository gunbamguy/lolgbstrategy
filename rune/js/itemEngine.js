// ==========================================
// ⚔️ 아이템 익스포터 엔진 모듈 (Item Engine)
// ==========================================

let itemVersion = '';
let itemMap = {};
let selectedItemSlot = null;
let currentCategory = null;
let activeSectorEl = null;

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

        // 모달 드래그 이동 연결
        const itemPopup = document.getElementById('item-popup');
        const itemPopupHeader = itemPopup ? itemPopup.querySelector('h3') : null;
        if (itemPopup && itemPopupHeader) {
            makeModalDraggable(itemPopup, itemPopupHeader);
        }
        document.querySelectorAll('#item-container .item-slot').forEach(slot => {
            slot.addEventListener('click', (event) => {
                event.stopPropagation();
                self.setActiveSlot(slot);
                self.handleSlotClick();
            });
        });

        const closeCategory = document.getElementById('close-popup');
        if (closeCategory) {
            closeCategory.addEventListener('click', () => {
                document.getElementById('category-popup').classList.add('hidden');
            });
        }

        const closeItem = document.getElementById('close-item-popup');
        if (closeItem) {
            closeItem.addEventListener('click', () => {
                document.getElementById('item-popup').classList.add('hidden');
                document.querySelectorAll('#item-container .item-slot').forEach(s => s.classList.remove('active-slot'));
            });
        }

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

        // 🎯 PNG 템트리 내보내기 (투명 배경)
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

    handleSlotClick: function() {
        if (!selectedItemSlot || !itemMap) return;
        const isWard = selectedItemSlot.classList.contains('ward-slot');
        const defaultCategory = isWard ? 'Trinket' : 'All';
        this.displayItemsByCategory(defaultCategory);
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

        // 검색어가 없고 '전체' 탭인 경우, 아래에 모든 아이템이 쏟아져 나오지 않고 깔끔하게 안내
        if (isAllAndNoQuery) {
            const infoMsg = document.createElement('div');
            infoMsg.style.gridColumn = '1 / -1';
            infoMsg.style.textAlign = 'center';
            infoMsg.style.color = '#a0abbd';
            infoMsg.style.padding = '32px 0';
            infoMsg.style.fontSize = '0.95rem';
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
                        self.selectItem(id, item.name);
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
            // 선택된 섹터가 없으면 신규 추가
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

        // 캡처 전 미니 ✖ 삭제 버튼 임시 숨김 (이중 안전장치)
        const deleteBtns = element.querySelectorAll('.btn-sector-mini-delete');
        deleteBtns.forEach(btn => btn.style.visibility = 'hidden');

        html2canvas(element, {
            backgroundColor: isPng ? null : '#090c10',
            useCORS: true,
            allowTaint: true,
            scale: 2,
            ignoreElements: (el) => el.classList && el.classList.contains('btn-sector-mini-delete')
        }).then(canvas => {
            deleteBtns.forEach(btn => btn.style.visibility = '');
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
            deleteBtns.forEach(btn => btn.style.visibility = '');
            console.error('이미지 내보내기 중 오류 발생:', error);
        });
    }
};
