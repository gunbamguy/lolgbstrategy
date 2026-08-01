// ==========================================
// ⚙️ 애플리케이션 통합 설정 (Unified Config)
// ==========================================

window.APP_CONFIG = {
    VERSION_URL: 'https://ddragon.leagueoflegends.com/api/versions.json',
    STAT_MODS_BASE_URL: 'https://raw.communitydragon.org/latest/game/assets/perks/statmods/',
    LOCAL_STORAGE_KEY: 'lol_rune_exporter_settings',

    DEFAULT_LAYOUT_PARAMS: {
        colGap: 70,
        runeIconSize: 80,
        slotGapY: 22,
        padding: 64,
        logoOffsetY: -12,
        logoSize: 44,
        canvasScale: 100
    },

    getStatModsData: function() {
        const baseUrl = 'https://raw.communitydragon.org/latest/game/assets/perks/statmods/';
        return [
            [
                { name: "적응형 능력치 +9", icon: `${baseUrl}statmodsadaptiveforceicon.png` },
                { name: "공격 속도 +10%", icon: `${baseUrl}statmodsattackspeedicon.png` },
                { name: "스킬 가속 +8", icon: `${baseUrl}statmodscdrscalingicon.png` },
            ],
            [
                { name: "적응형 능력치 +9", icon: `${baseUrl}statmodsadaptiveforceicon.png` },
                { name: "이동 속도 +2%", icon: `${baseUrl}statmodsmovementspeedicon.png` },
                { name: "체력 +65", icon: `${baseUrl}statmodshealthplusicon.png` },
            ],
            [
                { name: "체력 +65", icon: `${baseUrl}statmodshealthscalingicon.png` },
                { name: "강인함 및 둔화 저항", icon: `${baseUrl}statmodstenacityicon.png` },
                { name: "체력 스케일링 +65", icon: `${baseUrl}statmodshealthplusicon.png` },
            ],
        ];
    }
};
