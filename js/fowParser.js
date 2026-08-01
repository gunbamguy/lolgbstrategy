const globalScope = typeof window !== 'undefined' ? window : (typeof global !== 'undefined' ? global : this);

const FOWParser = {

    parseHTML: function(htmlContent) {
        if (!htmlContent || typeof htmlContent !== 'string') {
            return [];
        }

        const matches = [];
        // FOW 전적 HTML에서 각 게임 블록 분할
        // class="game win" 또는 class="game loss" 또는 class="game replay" 등
        const gameBlockRegex = /<div class=["'](game (win|loss|replay|remake)[^"']*)["'][\s\S]*?(?=(?:<div class=["']game (?:win|loss|replay|remake)|<DIV class=['"]get_more_games['"]|<div id=['"]bottom_ad['"]|$))/gi;

        let matchExec;
        let index = 0;

        while ((matchExec = gameBlockRegex.exec(htmlContent)) !== null) {
            index++;
            const rawBlock = matchExec[0];
            const gameTypeClass = matchExec[1] || '';
            const isWin = gameTypeClass.includes('win');

            // 1. 소환사 챔피언 파싱
            // <IMG SRC='//z.fow.lol/champ/...' alt='챔피언명'> (width=51 또는 큰 챔피언 썸네일)
            let mainChamp = '알 수 없음';
            let mainChampImg = '';
            const mainChampMatch = rawBlock.match(/<IMG SRC=['"]([^'"]*\/champ\/(\d+)_64\.png)['"][^>]*alt=['"]([^'"]+)['"][^>]*width=['"]51['"]/i)
                || rawBlock.match(/alt=['"]([^'"]+)['"][^>]*width=['"]51['"]/i);
            
            if (mainChampMatch) {
                mainChamp = mainChampMatch[3] || mainChampMatch[1];
                if (mainChampMatch[2]) {
                    mainChampImg = `https://z.fow.lol/champ/${mainChampMatch[2]}_64.png`;
                }
            } else {
                // 대체 챔피언 추출
                const altMatch = rawBlock.match(/alt=['"]([^'"]+)['"]/);
                if (altMatch && altMatch[1] !== 'FOW LOGO' && altMatch[1] !== '빌드 보기') {
                    mainChamp = altMatch[1];
                }
            }

            // 2. 룬 정보 파싱 (perk ID)
            // 주 룬: //z.fow.lol/img/perk/8005.png
            // 보조 계열: //z.fow.lol/img/perk/8300.png (opacity: 0.3)
            let mainRuneId = null;
            let subTreeId = null;
            let mainRuneName = '';
            let subTreeName = '';

            const perkRegex = /<IMG[^>]*tipsy=["']< ([^>]+) >[^"']*["'][^>]*SRC=['"]([^'"]*\/perk\/(\d+)\.png)['"][^>]*\/?>/gi;
            let perkMatch;
            const perks = [];
            while ((perkMatch = perkRegex.exec(rawBlock)) !== null) {
                perks.push({
                    name: perkMatch[1],
                    src: perkMatch[2],
                    id: perkMatch[3],
                    isSub: perkMatch[0].includes('opacity')
                });
            }

            // 만약 정규식으로 다 못 잡은 경우 단순 perk/id.png 탐색
            if (perks.length === 0) {
                const simplePerkRegex = /\/perk\/(\d+)\.png/g;
                let sMatch;
                while ((sMatch = simplePerkRegex.exec(rawBlock)) !== null) {
                    const pId = parseInt(sMatch[1], 10);
                    if (pId >= 8000 && pId < 9000) {
                        if (!mainRuneId) mainRuneId = pId;
                        else if (!subTreeId && pId !== mainRuneId) subTreeId = pId;
                    }
                }
            } else {
                const mainPerk = perks.find(p => !p.isSub) || perks[0];
                const subPerk = perks.find(p => p.isSub) || perks[1];
                if (mainPerk) {
                    mainRuneId = parseInt(mainPerk.id, 10);
                    mainRuneName = mainPerk.name;
                }
                if (subPerk) {
                    subTreeId = parseInt(subPerk.id, 10);
                    subTreeName = subPerk.name;
                }
            }

            // 기본값 보정 (전적 원본에 룬 ID가 지정된 경우)
            if (!mainRuneId) mainRuneId = 8005; // 집중 공격 기본
            if (!subTreeId) subTreeId = 8300; // 영감 기본

            // 3. 아이템 파싱
            // //z.fow.lol/items3/6672.png alt='크라켄 학살자'
            const itemRegex = /<IMG[^>]*SRC=['"]([^'"]*\/items3\/(\d+)\.png)['"][^>]*alt=['"]([^'"]+)['"]/gi;
            let itemMatch;
            const items = [];
            while ((itemMatch = itemRegex.exec(rawBlock)) !== null) {
                const itemSrc = itemMatch[1];
                const itemId = itemMatch[2];
                const itemName = itemMatch[3];
                // 중복 및 와드 파악
                if (!items.some(it => it.id === itemId && it.name === itemName)) {
                    items.push({
                        id: itemId,
                        name: itemName,
                        src: itemSrc.startsWith('//') ? `https:${itemSrc}` : itemSrc,
                        isWard: itemId === '3364' || itemId === '3340' || itemId === '3363' || itemName.includes('와드') || itemName.includes('렌즈')
                    });
                }
            }

            // 와드 분리 및 일반 아이템 최대 6개 분리
            const wardItem = items.find(it => it.isWard) || null;
            const mainItems = items.filter(it => !it.isWard).slice(0, 6);

            // 1~6단계 시간 누적 아이템 빌드 트리 생성
            const buildStages = [];
            for (let step = 1; step <= mainItems.length; step++) {
                buildStages.push(mainItems.slice(0, step));
            }

            // 4. 참가자 10명 챔피언 파싱
            const teamChamps = [];
            const champRegex = /<IMG[^>]*SRC=['"]([^'"]*\/champ\/(\d+)_64\.png)['"][^>]*alt=['"]([^'"]+)['"]/gi;
            let cMatch;
            while ((cMatch = champRegex.exec(rawBlock)) !== null) {
                const cSrc = cMatch[1];
                const cId = cMatch[2];
                const cName = cMatch[3];
                if (cName !== 'FOW LOGO' && cName !== mainChamp) {
                    if (!teamChamps.some(tc => tc.name === cName)) {
                        teamChamps.push({
                            id: cId,
                            name: cName,
                            src: cSrc.startsWith('//') ? `https:${cSrc}` : cSrc
                        });
                    }
                }
            }
            // 소환사 본인 포함 최대 10명
            const all10Champs = [
                { name: mainChamp, isSelf: true },
                ...teamChamps
            ].slice(0, 10);

            // 5. KDA, CS, 시간 파싱
            const kdaMatch = rawBlock.match(/<b[^>]*>(\d+)\s*\/\s*(\d+)\s*\/\s*(\d+)<\/b>/i);
            const kdaStr = kdaMatch ? `${kdaMatch[1]} / ${kdaMatch[2]} / ${kdaMatch[3]}` : '전적 파싱완료';

            const csMatch = rawBlock.match(/CS\s*(\d+)/i);
            const csStr = csMatch ? `CS ${csMatch[1]}` : '';

            const gameIdMatch = rawBlock.match(/data-game-id=['"](\d+)['"]/);
            const gameId = gameIdMatch ? gameIdMatch[1] : `game_${index}`;

            // 상세페이지가 열려 있거나 데이터가 완비된 판 판단
            const detailMatch = rawBlock.match(/<div class=["']gameDetail[^"']*["'][^>]*>([\s\S]*?)<\/div>/i);
            const hasDetailOpened = detailMatch ? detailMatch[1].trim().length > 50 : false;

            matches.push({
                index: index, // 원본 FOW 순서 (판 #1, 판 #2...)
                gameId: gameId,
                isWin: isWin,
                mainChamp: mainChamp,
                mainChampImg: mainChampImg,
                kdaStr: kdaStr,
                csStr: csStr,
                mainRuneId: mainRuneId,
                mainRuneName: mainRuneName,
                subTreeId: subTreeId,
                subTreeName: subTreeName,
                mainItems: mainItems,
                wardItem: wardItem,
                buildStages: buildStages,
                teamChamps: all10Champs,
                hasDetailOpened: hasDetailOpened,
                rawBlockSnippet: rawBlock.substring(0, 150)
            });
        }

        return matches;
    }
};

globalScope.FOWParser = FOWParser;

if (typeof module !== 'undefined' && module.exports) {
    module.exports = FOWParser;
}


