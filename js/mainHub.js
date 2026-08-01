/**
 * 🏠 GUDO 허브 메인 컨트롤러 (mainHub.js)
 * FOW 전적 HTML 소스 파싱 및 룬/아이템/전략도구 1:1 연동 관리
 */

document.addEventListener('DOMContentLoaded', function() {
    console.log("🚀 GUDO Main Hub Initialized");

    // UI 요소 참조
    const btnPasteFow = document.getElementById('btnPasteFow');
    const btnLoadSample = document.getElementById('btnLoadSample');
    const modalFowPaste = document.getElementById('modalFowPaste');
    const btnCloseModal = document.getElementById('btnCloseModal');
    const btnCancelModal = document.getElementById('btnCancelModal');
    const btnSubmitFow = document.getElementById('btnSubmitFow');
    const fowHtmlInput = document.getElementById('fowHtmlInput');

    const heroPreviewContainer = document.getElementById('heroPreviewContainer');
    const matchGridContainer = document.getElementById('matchGridContainer');
    const parsedCountBadge = document.getElementById('parsedCountBadge');

    let currentMatches = [];
    let selectedMatchIndex = 0; // 기본 첫번째 판 (또는 상세 열린 판)

    // 모달 열기/닫기
    if (btnPasteFow) {
        btnPasteFow.addEventListener('click', () => {
            if (modalFowPaste) modalFowPaste.classList.remove('hidden');
        });
    }
    if (btnCloseModal) {
        btnCloseModal.addEventListener('click', () => {
            if (modalFowPaste) modalFowPaste.classList.add('hidden');
        });
    }
    if (btnCancelModal) {
        btnCancelModal.addEventListener('click', () => {
            if (modalFowPaste) modalFowPaste.classList.add('hidden');
        });
    }

    // 전적 소스 제출 시 파싱
    if (btnSubmitFow) {
        btnSubmitFow.addEventListener('click', () => {
            const rawHtml = fowHtmlInput.value.trim();
            if (!rawHtml) {
                alert('FOW 전적 HTML 소스코드를 붙여넣어 주세요.');
                return;
            }
            processFowHtml(rawHtml);
            if (modalFowPaste) modalFowPaste.classList.add('hidden');
        });
    }


    // FOW HTML 파싱 및 화면 렌더링
    function processFowHtml(htmlText) {
        if (!window.FOWParser) {
            console.error('FOWParser 모듈을 찾을 수 없습니다.');
            return;
        }

        currentMatches = window.FOWParser.parseHTML(htmlText);
        if (parsedCountBadge) {
            parsedCountBadge.textContent = `${currentMatches.length}개 매칭 파싱완료`;
        }

        if (currentMatches.length === 0) {
            alert('유효한 FOW 전적 매칭 데이터를 찾지 못했습니다.');
            return;
        }

        // 상세페이지가 열린 판(또는 첫 번째 판)을 기본 선택 판으로 지정
        const openedIdx = currentMatches.findIndex(m => m.hasDetailOpened);
        selectedMatchIndex = openedIdx !== -1 ? openedIdx : 0;

        renderHeroPreviewCard(currentMatches[selectedMatchIndex]);
        renderMatchGrid(currentMatches);
    }

    // 🌟 선택된 판 대형 하이라이트 메인 프리뷰 카드 렌더링
    function renderHeroPreviewCard(match) {
        if (!heroPreviewContainer || !match) return;

        const isWin = match.isWin;
        const statusText = isWin ? '승리 (WIN)' : '패배 (LOSS)';
        const statusClass = isWin ? 'win-badge' : 'loss-badge';

        // 템트리 생성 (최대 6개 아이템 + 와드 1개)
        const itemsHtml = match.mainItems.map(it => `
            <div class="item-slot-preview" title="${it.name}">
                <img src="${it.src}" alt="${it.name}" onerror="this.src='https://ddragon.leagueoflegends.com/cdn/14.1.1/img/item/3637.png'" />
                <span class="item-name">${it.name}</span>
            </div>
        `).join('');

        const wardHtml = match.wardItem ? `
            <div class="item-slot-preview ward-slot" title="${match.wardItem.name} (와드)">
                <img src="${match.wardItem.src}" alt="${match.wardItem.name}" />
                <span class="item-name">${match.wardItem.name}</span>
            </div>
        ` : '';

        // 10명 챔피언 칩 생성
        const champsHtml = match.teamChamps.map((c, i) => `
            <span class="champ-chip ${c.isSelf ? 'self-champ' : ''}">
                ${i === 0 ? '👑 ' : ''}${c.name}
            </span>
        `).join('');

        heroPreviewContainer.innerHTML = `
            <div class="hero-card ${isWin ? 'hero-card-win' : 'hero-card-loss'}">
                <div class="hero-card-header">
                    <div class="hero-tag-group">
                        <span class="hero-match-no">판 #${match.index} (선택된 매치 상세)</span>
                        <span class="hero-status ${statusClass}">${statusText}</span>
                    </div>
                    <div class="hero-champ-title">
                        <span class="champ-icon">🛡️</span>
                        <h2>${match.mainChamp} <span>(${match.kdaStr} | ${match.csStr})</span></h2>
                    </div>
                </div>

                <div class="hero-card-body">
                    <!-- ⚡ 룬 세팅 섹션 -->
                    <div class="hero-section">
                        <h3>⚡ 룬 빌드 세팅</h3>
                        <div class="hero-rune-info">
                            <span class="rune-pill main-rune">주 룬 ID: ${match.mainRuneId} ${match.mainRuneName ? '(' + match.mainRuneName + ')' : ''}</span>
                            <span class="rune-pill sub-rune">보조 계열 ID: ${match.subTreeId} ${match.subTreeName ? '(' + match.subTreeName + ')' : ''}</span>
                            <span class="rune-pill shard-rune">능력치 파편 3개 자동 매핑</span>
                        </div>
                    </div>

                    <!-- ⚔️ 아이템 빌드 세팅 -->
                    <div class="hero-section">
                        <h3>⚔️ 아이템 빌드 (1~6단계 누적 템트리)</h3>
                        <div class="hero-items-grid">
                            ${itemsHtml}
                            ${wardHtml}
                        </div>
                    </div>

                    <!-- 🗺️ 10명 챔피언 라인업 -->
                    <div class="hero-section">
                        <h3>🗺️ 매치 챔피언 라인업 (전략 도구 10명)</h3>
                        <div class="hero-champs-list">
                            ${champsHtml}
                        </div>
                    </div>
                </div>

                <!-- 🚀 3대 도구 1:1 연동 내보내기 버튼들 -->
                <div class="hero-card-actions">
                    <button class="export-btn btn-export-rune" id="btnExportRune">
                        ⚡ 룬 익스포터로 내보내기
                    </button>
                    <button class="export-btn btn-export-item" id="btnExportItem">
                        ⚔️ 아이템 빌드로 내보내기
                    </button>
                    <button class="export-btn btn-export-strategy" id="btnExportStrategy">
                        🗺️ 전략 보드로 내보내기
                    </button>
                </div>
            </div>
        `;

        // 연동 버튼 이벤트 바인딩
        document.getElementById('btnExportRune')?.addEventListener('click', () => exportToRuneApp(match));
        document.getElementById('btnExportItem')?.addEventListener('click', () => exportToItemApp(match));
        document.getElementById('btnExportStrategy')?.addEventListener('click', () => exportToStrategyApp(match));
    }

    // 60개(30개) 매칭 그리드 카드 렌더링
    function renderMatchGrid(matches) {
        if (!matchGridContainer) return;

        matchGridContainer.innerHTML = matches.map((m, idx) => `
            <div class="match-item-card ${idx === selectedMatchIndex ? 'selected' : ''} ${m.isWin ? 'win' : 'loss'}" data-index="${idx}">
                <div class="match-card-header">
                    <span class="match-no">판 #${m.index}</span>
                    <span class="match-res ${m.isWin ? 'win' : 'loss'}">${m.isWin ? '승' : '패'}</span>
                </div>
                <div class="match-card-body">
                    <strong class="match-champ">${m.mainChamp}</strong>
                    <div class="match-kda">${m.kdaStr}</div>
                </div>
                <div class="match-card-footer">
                    <span class="rune-tag">⚡ ${m.mainRuneId}</span>
                    <span class="item-count">⚔️ ${m.mainItems.length}템</span>
                </div>
            </div>
        `).join('');

        // 카드 클릭 시 대형 프리뷰 카드로 승격
        document.querySelectorAll('.match-item-card').forEach(card => {
            card.addEventListener('click', function() {
                const idx = parseInt(this.getAttribute('data-index'), 10);
                selectedMatchIndex = idx;
                document.querySelectorAll('.match-item-card').forEach(c => c.classList.remove('selected'));
                this.classList.add('selected');
                renderHeroPreviewCard(currentMatches[selectedMatchIndex]);
                heroPreviewContainer.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            });
        });
    }

    // ----------------------------------------------------
    // 🔗 3대 도구 로컬스토리지 & 페이지 내보내기 함수들
    // ----------------------------------------------------

    // 1. ⚡ 룬 익스포터로 내보내기
    function exportToRuneApp(match) {
        try {
            const runeExportData = {
                mainRuneId: match.mainRuneId,
                subTreeId: match.subTreeId,
                mainChamp: match.mainChamp,
                timestamp: Date.now()
            };
            localStorage.setItem('gudo_imported_rune', JSON.stringify(runeExportData));
            alert(`[판 #${match.index} ${match.mainChamp}] 룬 세팅(주 룬 ID:${match.mainRuneId}, 보조 계열 ID:${match.subTreeId})이 룬 익스포터로 전달되었습니다.\n페이지로 이동합니다.`);
            window.location.href = 'rune/index.html';
        } catch (e) {
            console.error('룬 전달 오류:', e);
        }
    }

    // 2. ⚔️ 아이템 익스포터로 내보내기
    function exportToItemApp(match) {
        try {
            const itemExportData = {
                mainChamp: match.mainChamp,
                mainItems: match.mainItems,
                wardItem: match.wardItem,
                buildStages: match.buildStages,
                timestamp: Date.now()
            };
            localStorage.setItem('gudo_imported_items', JSON.stringify(itemExportData));
            alert(`[판 #${match.index} ${match.mainChamp}] 아이템 템트리(1~6단계 누적 빌드)가 아이템 익스포터로 전달되었습니다.\n페이지로 이동합니다.`);
            window.location.href = 'rune/index.html#item';
        } catch (e) {
            console.error('아이템 전달 오류:', e);
        }
    }

    // 3. 🗺️ 전략 보드로 내보내기
    function exportToStrategyApp(match) {
        try {
            const strategyExportData = {
                mainChamp: match.mainChamp,
                teamChamps: match.teamChamps,
                timestamp: Date.now()
            };
            localStorage.setItem('gudo_imported_champions', JSON.stringify(strategyExportData));
            alert(`[판 #${match.index}] 10명의 챔피언 라인업이 전략 보드로 전달되었습니다.\n페이지로 이동합니다.`);
            window.location.href = 'strategy/index.html';
        } catch (e) {
            console.error('전략 전달 오류:', e);
        }
    }
});

