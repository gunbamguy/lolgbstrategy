// ==========================================
// 🎨 캔버스 렌더링 엔진 (Canvas Engine Module)
// ==========================================

const imageCache = new Map();

window.CANVAS_ENGINE = {
    loadImage: function(src) {
        if (imageCache.has(src)) {
            return Promise.resolve(imageCache.get(src));
        }
        return new Promise((resolve) => {
            const img = new Image();
            img.crossOrigin = "anonymous";
            img.onload = () => {
                imageCache.set(src, img);
                resolve(img);
            };
            img.onerror = () => {
                console.warn(`이미지 로드 실패: ${src}`);
                resolve(null);
            };
            img.src = src;
        });
    },

    renderCanvasToTarget: async function(canvas, type = 'both', state) {
        if (!canvas) return;
        const ctx = canvas.getContext('2d');

        const text = document.getElementById('textInput').value.trim();
        const fontSize = parseInt(document.getElementById('fontSizeRange').value, 10);
        const textColor = document.getElementById('textColor').value;
        const opacity = parseFloat(document.getElementById('opacityRange').value);
        const cornerRadius = parseInt(document.getElementById('cornerRadiusRange').value, 10);
        const showLogo = document.getElementById('showLogoCheck').checked;

        const includeMain = (type === 'main' || type === 'both' || type === 'transparent');
        const includeSub = (type === 'sub' || type === 'both' || type === 'transparent');

        const layoutParams = state.layoutParams;
        const padding = layoutParams.padding;
        const colGap = layoutParams.colGap;
        const runeIconSize = layoutParams.runeIconSize;
        const shardIconSize = Math.round(runeIconSize * 0.875);
        const runeGapX = 18;
        const slotGapY = layoutParams.slotGapY;
        const logoOffsetY = layoutParams.logoOffsetY;

        const logoSize = layoutParams.logoSize || 44;
        const canvasScaleFactor = (layoutParams.canvasScale || 100) / 100;

        let logoHeight = 0;
        if (showLogo) {
            if (state.customLogoImg) {
                const aspect = state.customLogoImg.width / state.customLogoImg.height;
                const logoW = Math.min(aspect * logoSize, 320);
                logoHeight = Math.min(logoW / aspect, logoSize) + 12;
            } else {
                logoHeight = logoSize;
            }
        }

        let textHeight = 0;
        if (text) {
            textHeight = fontSize + 24;
        }

        let colWidth = runeIconSize * 3 + runeGapX * 2;
        let cardContentHeight = runeIconSize * 4 + slotGapY * 3 + 10;

        let unscaledWidth = padding * 2;
        if (includeMain && includeSub) {
            unscaledWidth += colWidth * 2 + colGap;
        } else {
            unscaledWidth += colWidth;
        }

        let unscaledHeight = padding * 2 + logoHeight + textHeight + cardContentHeight;

        canvas.width = Math.round(unscaledWidth * canvasScaleFactor);
        canvas.height = Math.round(unscaledHeight * canvasScaleFactor);

        ctx.save();
        ctx.scale(canvasScaleFactor, canvasScaleFactor);

        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';

        // 배경
        ctx.clearRect(0, 0, unscaledWidth, unscaledHeight);
        ctx.fillStyle = `rgba(0, 0, 0, ${opacity})`;

        if (cornerRadius > 0) {
            ctx.beginPath();
            ctx.roundRect(0, 0, unscaledWidth, unscaledHeight, cornerRadius);
            ctx.fill();
        } else {
            ctx.fillRect(0, 0, unscaledWidth, unscaledHeight);
        }

        let currentY = padding;

        // 상단 로고
        if (showLogo) {
            let logoDrawY = currentY + logoOffsetY;

            if (state.customLogoImg) {
                const aspect = state.customLogoImg.width / state.customLogoImg.height;
                const drawH = logoSize;
                const drawW = Math.min(aspect * drawH, 320);
                const drawX = (unscaledWidth - drawW) / 2;

                ctx.globalAlpha = 1.0;
                ctx.drawImage(state.customLogoImg, drawX, logoDrawY, drawW, drawH);
                currentY += drawH + 12;
            } else {
                const logoBadgeWidth = Math.round(logoSize * 2.5);
                const logoBadgeHeight = Math.round(logoSize * 0.65);
                const logoX = (unscaledWidth - logoBadgeWidth) / 2;

                ctx.fillStyle = '#c89b3c';
                ctx.beginPath();
                ctx.roundRect(logoX, logoDrawY, logoBadgeWidth, logoBadgeHeight, 6);
                ctx.fill();

                ctx.font = `bold ${Math.round(logoBadgeHeight * 0.48)}px 'Outfit', sans-serif`;
                ctx.fillStyle = '#000000';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillText('LoL RUNES', unscaledWidth / 2, logoDrawY + logoBadgeHeight / 2);

                currentY += logoBadgeHeight + 12;
            }
        }

        // 커스텀 텍스트
        if (text) {
            ctx.font = `bold ${fontSize}px 'Gothic A1', sans-serif`;
            ctx.fillStyle = textColor;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            ctx.fillText(text, unscaledWidth / 2, currentY);
            currentY += textHeight;
        }

        let startX = padding;

        // 주 빌드
        if (includeMain) {
            let drawY = currentY;
            const slots = document.querySelectorAll('#mainSecondaryRuneImages .rune-slot');

            for (let slot of slots) {
                const imgs = slot.querySelectorAll('img');
                const totalImgs = imgs.length;
                if (totalImgs === 0) continue;

                const slotRowWidth = totalImgs * runeIconSize + (totalImgs - 1) * runeGapX;
                let imgX = startX + (colWidth - slotRowWidth) / 2;

                for (let imgEl of imgs) {
                    const img = await this.loadImage(imgEl.src);
                    const isSelected = imgEl.classList.contains('selected');

                    if (type === 'transparent') {
                        ctx.globalAlpha = isSelected ? 1.0 : 0.0;
                    } else {
                        ctx.globalAlpha = isSelected ? 1.0 : 0.22;
                    }

                    if (img) {
                        ctx.drawImage(img, imgX, drawY, runeIconSize, runeIconSize);
                        
                        if (isSelected && type !== 'transparent') {
                            ctx.globalAlpha = 1.0;
                            ctx.strokeStyle = '#b2e6f8';
                            ctx.lineWidth = 3;
                            ctx.strokeRect(imgX, drawY, runeIconSize, runeIconSize);
                        }
                    }
                    imgX += runeIconSize + runeGapX;
                }
                drawY += runeIconSize + slotGapY;
            }

            if (includeMain && includeSub) {
                startX += colWidth + colGap;
            }
        }

        // 보조 빌드
        if (includeSub) {
            let drawY = currentY;
            const slots = document.querySelectorAll('#subSecondaryRuneImages .rune-slot');

            for (let slot of slots) {
                const imgs = slot.querySelectorAll('img');
                const totalImgs = imgs.length;
                if (totalImgs === 0) continue;

                const slotRowWidth = totalImgs * runeIconSize + (totalImgs - 1) * runeGapX;
                let imgX = startX + (colWidth - slotRowWidth) / 2;

                for (let imgEl of imgs) {
                    const img = await this.loadImage(imgEl.src);
                    const isSelected = imgEl.classList.contains('selected');

                    if (type === 'transparent') {
                        ctx.globalAlpha = isSelected ? 1.0 : 0.0;
                    } else {
                        ctx.globalAlpha = isSelected ? 1.0 : 0.22;
                    }

                    if (img) {
                        ctx.drawImage(img, imgX, drawY, runeIconSize, runeIconSize);
                        
                        if (isSelected && type !== 'transparent') {
                            ctx.globalAlpha = 1.0;
                            ctx.strokeStyle = '#b2e6f8';
                            ctx.lineWidth = 3;
                            ctx.strokeRect(imgX, drawY, runeIconSize, runeIconSize);
                        }
                    }
                    imgX += runeIconSize + runeGapX;
                }
                drawY += runeIconSize + slotGapY;
            }

            // 능력치 파편
            const shardSlotIds = ['runeShardSlot1', 'runeShardSlot2', 'runeShardSlot3'];
            const selectedShardImages = [];

            for (let slotId of shardSlotIds) {
                const slotEl = document.getElementById(slotId);
                if (!slotEl) continue;
                const imgs = slotEl.querySelectorAll('img.selected');
                if (imgs.length > 0) {
                    selectedShardImages.push(imgs[0]);
                }
            }

            if (selectedShardImages.length > 0) {
                const shardGap = 18;
                const totalShardRowWidth = selectedShardImages.length * shardIconSize + (selectedShardImages.length - 1) * shardGap;
                let shardX = startX + (colWidth - totalShardRowWidth) / 2;

                for (let imgEl of selectedShardImages) {
                    const img = await this.loadImage(imgEl.src);
                    if (img) {
                        ctx.globalAlpha = 1.0;
                        ctx.drawImage(img, shardX, drawY, shardIconSize, shardIconSize);
                        
                        if (type !== 'transparent') {
                            ctx.strokeStyle = '#b2e6f8';
                            ctx.lineWidth = 3;
                            ctx.strokeRect(shardX, drawY, shardIconSize, shardIconSize);
                        }
                    }
                    shardX += shardIconSize + shardGap;
                }
            }
        }

        ctx.restore();
    }
};
