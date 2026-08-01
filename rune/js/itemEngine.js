// ==========================================
// ⚔️ 아이템 익스포터 엔진 모듈 (Item Engine)
// ==========================================

let itemVersion = '';
let itemMap = {};
let selectedItemSlot = null;

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

    bindEvents: function() {
        const self = this;
        document.querySelectorAll('#item-container .item-slot').forEach(slot => {
            slot.addEventListener('click', (event) => {
                event.stopPropagation();
                selectedItemSlot = slot;
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
            });
        }

        const btnSelect = document.getElementById('select-button');
        if (btnSelect) btnSelect.addEventListener('click', () => self.captureSlots());

        const btnCancel = document.getElementById('cancel-last-button');
        if (btnCancel) btnCancel.addEventListener('click', () => self.cancelLastSector());

        const btnClear = document.getElementById('clear-button');
        if (btnClear) btnClear.addEventListener('click', () => self.clearSlots());

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
        const categories = new Set();

        if (selectedItemSlot.classList.contains('ward-slot')) {
            categories.add('Trinket');
        } else {
            for (const id in itemMap) {
                if (itemMap[id].tags) {
                    itemMap[id].tags.forEach(tag => categories.add(tag));
                }
            }
        }
        this.showCategoryPopup([...categories]);
    },

    showCategoryPopup: function(categories) {
        const categoryPopup = document.getElementById('category-popup');
        const categoryList = document.getElementById('category-list');
        if (!categoryPopup || !categoryList) return;

        categoryList.innerHTML = '';
        const self = this;

        categories.forEach(category => {
            const translatedCategory = tagTranslations[category] || category;
            const categoryDiv = document.createElement('div');
            categoryDiv.classList.add('category-item');
            categoryDiv.textContent = translatedCategory;
            categoryDiv.addEventListener('click', () => {
                self.displayItemsByCategory(category);
                categoryPopup.classList.add('hidden');
            });
            categoryList.appendChild(categoryDiv);
        });

        categoryPopup.classList.remove('hidden');
    },

    displayItemsByCategory: function(category) {
        const itemPopup = document.getElementById('item-popup');
        const itemsList = document.getElementById('items-list');
        if (!itemPopup || !itemsList) return;

        itemsList.innerHTML = '';
        const self = this;

        for (const id in itemMap) {
            const item = itemMap[id];
            if (item.inStore !== false && item.tags && item.tags.includes(category)) {
                const itemDiv = document.createElement('div');
                itemDiv.classList.add('item-grid-item');
                itemDiv.dataset.id = id;

                const img = document.createElement('img');
                img.src = `https://ddragon.leagueoflegends.com/cdn/${itemVersion}/img/item/${id}.png`;
                img.alt = item.name;
                img.title = item.name;

                itemDiv.appendChild(img);
                itemsList.appendChild(itemDiv);

                itemDiv.addEventListener('click', () => {
                    self.selectItem(id, item.name);
                    itemPopup.classList.add('hidden');
                });
            }
        }

        itemPopup.classList.remove('hidden');
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

        const captureGrid = document.createElement('div');
        captureGrid.classList.add('mini-grid-container');

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
                capturedSlot.appendChild(img);
            }
            captureGrid.appendChild(capturedSlot);
        });

        captureSector.appendChild(captureGrid);
        rowContainer.appendChild(captureSector);
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

        html2canvas(element, {
            backgroundColor: isPng ? null : '#090c10',
            useCORS: true,
            allowTaint: true,
            scale: 2
        }).then(canvas => {
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
            console.error('이미지 내보내기 중 오류 발생:', error);
        });
    }
};
