// ==========================================
// 💾 LocalStorage 저장 & 복원 관리 모듈
// ==========================================

window.APP_STORAGE = {
    saveStateToLocalStorage: function(state) {
        try {
            const mainRuneSelections = [];
            document.querySelectorAll('#mainSecondaryRuneImages .rune-slot').forEach((slot, sIdx) => {
                const selectedImg = slot.querySelector('img.selected');
                if (selectedImg) {
                    mainRuneSelections.push({ slot: sIdx, alt: selectedImg.alt, src: selectedImg.src });
                }
            });

            const subRuneSelections = [];
            document.querySelectorAll('#subSecondaryRuneImages .rune-slot').forEach((slot, sIdx) => {
                slot.querySelectorAll('img.selected').forEach(img => {
                    subRuneSelections.push({ slot: sIdx, alt: img.alt, src: img.src });
                });
            });

            const shardSelections = [];
            ['runeShardSlot1', 'runeShardSlot2', 'runeShardSlot3'].forEach((slotId, sIdx) => {
                const container = document.getElementById(slotId);
                if (container) {
                    const selectedImg = container.querySelector('img.selected');
                    if (selectedImg) {
                        const idx = Array.from(container.querySelectorAll('img')).indexOf(selectedImg);
                        shardSelections.push({ slot: sIdx, index: idx });
                    }
                }
            });

            const settings = {
                mainTreeIndex: state.selectedMainTreeIndex,
                subTreeIndex: state.selectedSubTreeIndex,
                mainRuneSelections,
                subRuneSelections,
                shardSelections,
                textInput: document.getElementById('textInput').value,
                fontSize: document.getElementById('fontSizeRange').value,
                textColor: document.getElementById('textColor').value,
                opacity: document.getElementById('opacityRange').value,
                cornerRadius: document.getElementById('cornerRadiusRange').value,
                showLogo: document.getElementById('showLogoCheck').checked,
                layoutParams: state.layoutParams
            };

            localStorage.setItem(window.APP_CONFIG.LOCAL_STORAGE_KEY, JSON.stringify(settings));
        } catch (e) {
            console.warn('LocalStorage 저장 실패:', e);
        }
    },

    restoreStateFromLocalStorage: function(runesData, state, callbacks) {
        try {
            const saved = localStorage.getItem(window.APP_CONFIG.LOCAL_STORAGE_KEY);
            if (!saved) return;
            const settings = JSON.parse(saved);

            if (settings.textInput !== undefined) document.getElementById('textInput').value = settings.textInput;
            if (settings.fontSize !== undefined) document.getElementById('fontSizeRange').value = settings.fontSize;
            if (settings.textColor !== undefined) document.getElementById('textColor').value = settings.textColor;
            if (settings.opacity !== undefined) document.getElementById('opacityRange').value = settings.opacity;
            if (settings.cornerRadius !== undefined) document.getElementById('cornerRadiusRange').value = settings.cornerRadius;
            if (settings.showLogo !== undefined) document.getElementById('showLogoCheck').checked = settings.showLogo;

            if (settings.layoutParams) {
                state.layoutParams = { ...state.layoutParams, ...settings.layoutParams };
                if (callbacks.updateModalSliders) callbacks.updateModalSliders();
            }

            if (callbacks.updateUIPreview) callbacks.updateUIPreview();

            if (settings.mainTreeIndex !== null && runesData[settings.mainTreeIndex]) {
                state.selectedMainTreeIndex = settings.mainTreeIndex;
                const mainImgs = document.querySelectorAll('#mainRuneImages img');
                if (mainImgs[settings.mainTreeIndex]) {
                    mainImgs[settings.mainTreeIndex].click();
                }

                if (settings.mainRuneSelections) {
                    setTimeout(() => {
                        const slots = document.querySelectorAll('#mainSecondaryRuneImages .rune-slot');
                        settings.mainRuneSelections.forEach(sel => {
                            if (slots[sel.slot]) {
                                const img = Array.from(slots[sel.slot].querySelectorAll('img')).find(i => i.alt === sel.alt || i.src === sel.src);
                                if (img) img.click();
                            }
                        });
                    }, 50);
                }
            }

            if (settings.subTreeIndex !== null && runesData[settings.subTreeIndex]) {
                state.selectedSubTreeIndex = settings.subTreeIndex;
                const subImgs = document.querySelectorAll('#subRuneImages img');
                if (subImgs[settings.subTreeIndex]) {
                    subImgs[settings.subTreeIndex].click();
                }

                if (settings.subRuneSelections) {
                    setTimeout(() => {
                        const slots = document.querySelectorAll('#subSecondaryRuneImages .rune-slot');
                        settings.subRuneSelections.forEach(sel => {
                            if (slots[sel.slot]) {
                                const img = Array.from(slots[sel.slot].querySelectorAll('img')).find(i => i.alt === sel.alt || i.src === sel.src);
                                if (img) img.click();
                            }
                        });
                    }, 50);
                }
            }

            if (settings.shardSelections) {
                const shardSlotIds = ['runeShardSlot1', 'runeShardSlot2', 'runeShardSlot3'];
                settings.shardSelections.forEach(sel => {
                    const container = document.getElementById(shardSlotIds[sel.slot]);
                    if (container) {
                        const imgs = container.querySelectorAll('img');
                        if (imgs[sel.index]) {
                            imgs[sel.index].click();
                        }
                    }
                });
            }
        } catch (e) {
            console.warn('LocalStorage 복원 오류:', e);
        }
    }
};
