// server.js
require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const http = require('http');
const WebSocket = require('ws');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// WebSocket 연결 및 브로드캐스팅 처리
wss.on('connection', (ws) => {
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            // 수신한 데이터를 연결된 다른 모든 클라이언트들에게 브로드캐스트
            wss.clients.forEach((client) => {
                if (client !== ws && client.readyState === WebSocket.OPEN) {
                    client.send(JSON.stringify(data));
                }
            });
        } catch (e) {
            console.error("웹소켓 메시지 파싱 에러:", e);
        }
    });
});

// --- 설정 구간 ---
app.use(cors()); // 모든 도메인 허용
app.use(express.json({limit: '20mb'})); // base64 이미지 용량 대응
app.use(express.static(path.join(__dirname, '..'))); // 상위 폴더(lolst)의 정적 파일 서빙
const PORT = 3000;

app.post('/save-image', (req, res) => {
    const { base64Data } = req.body;
    if (!base64Data) {
        return res.status(400).json({ error: "데이터가 없습니다." });
    }
    try {
        const buffer = Buffer.from(base64Data, 'base64');
        fs.writeFileSync(path.join(__dirname, '..', 'images', 'Summoner\'s_Rift_map_s14.png'), buffer);
        console.log("[성공] 맵 이미지를 로컬에 저장 완료");
        return res.json({ success: true });
    } catch (e) {
        console.error(e);
        return res.status(500).json({ error: e.message });
    }
});

// 환경 변수에서 Riot API 키를 불러옵니다 (로컬은 .env 파일 참조)
const RIOT_API_KEY = process.env.RIOT_API_KEY; 

// 지역 라우팅 (한국 서버 기준)
const REGION_ROUTING = "asia"; // Account-v1, Match-v5용
// ----------------

app.get('/get-match', async (req, res) => {
    const { gameName, tagLine } = req.query;

    if (!gameName || !tagLine) {
        return res.status(400).json({ error: "닉네임과 태그라인이 필요합니다." });
    }

    try {
        console.log(`[요청] ${gameName} #${tagLine} 검색 중...`);

        // 1. PUUID 조회 (Riot ID 기준)
        const accountUrl = `https://${REGION_ROUTING}.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}?api_key=${RIOT_API_KEY}`;
        const accountRes = await axios.get(accountUrl);
        const puuid = accountRes.data.puuid;

        // 2. 최근 매치 ID 조회 (1게임)
        const matchesUrl = `https://${REGION_ROUTING}.api.riotgames.com/lol/match/v5/matches/by-puuid/${puuid}/ids?start=0&count=1&api_key=${RIOT_API_KEY}`;
        const matchesRes = await axios.get(matchesUrl);
        
        if (!matchesRes.data || matchesRes.data.length === 0) {
            return res.status(404).json({ error: "최근 경기 기록이 없습니다." });
        }
        const matchId = matchesRes.data[0];

        // 3. 매치 상세 정보 조회
        const matchDetailUrl = `https://${REGION_ROUTING}.api.riotgames.com/lol/match/v5/matches/${matchId}?api_key=${RIOT_API_KEY}`;
        const detailRes = await axios.get(matchDetailUrl);
        
        // 4. 참가자 데이터 추출
        const participants = detailRes.data.info.participants;
        const blueTeam = participants.filter(p => p.teamId === 100).map(p => p.championName);
        const redTeam = participants.filter(p => p.teamId === 200).map(p => p.championName);

        console.log(`[성공] 데이터 반환 완료`);
        res.json({ blue: blueTeam, red: redTeam });

    } catch (error) {
        console.error("API Error:", error.response?.status, error.response?.data || error.message);
        
        if (error.response?.status === 403) {
            return res.status(403).json({ error: "API 키가 만료되었거나 잘못되었습니다." });
        }
        if (error.response?.status === 404) {
            return res.status(404).json({ error: "존재하지 않는 사용자입니다." });
        }
        res.status(500).json({ error: "서버 내부 오류", details: error.message });
    }
});

server.listen(PORT, () => {
    console.log(`서버가 http://localhost:${PORT} 에서 실행 중입니다.`);
});