// --- 고정 구조물 좌표 ---
const structures = [
  { "type": "tower", "team": "blue", "x": 50, "y": 580 },
  { "type": "tower", "team": "blue", "x": 81, "y": 603 },
  { "type": "inhib", "team": "blue", "x": 32, "y": 514 },
  { "type": "inhib", "team": "blue", "x": 146, "y": 538 },
  { "type": "inhib", "team": "blue", "x": 156, "y": 643 },
  { "type": "tower", "team": "blue", "x": 32, "y": 471 },
  { "type": "tower", "team": "blue", "x": 178, "y": 509 },
  { "type": "tower", "team": "blue", "x": 206, "y": 645 },
  { "type": "tower", "team": "blue", "x": 74, "y": 360 },
  { "type": "tower", "team": "blue", "x": 255, "y": 445 },
  { "type": "tower", "team": "blue", "x": 370, "y": 627 },
  { "type": "tower", "team": "blue", "x": 70, "y": 205 },
  { "type": "tower", "team": "blue", "x": 305, "y": 366 },
  { "type": "tower", "team": "blue", "x": 590, "y": 650 },
  { "type": "tower", "team": "red", "x": 645, "y": 133 },
  { "type": "tower", "team": "red", "x": 626, "y": 119 },
  { "type": "inhib", "team": "red", "x": 566, "y": 105 },
  { "type": "inhib", "team": "red", "x": 586, "y": 166 },
  { "type": "inhib", "team": "red", "x": 683, "y": 179 },
  { "type": "tower", "team": "red", "x": 519, "y": 100 },
  { "type": "tower", "team": "red", "x": 561, "y": 186 },
  { "type": "tower", "team": "red", "x": 692, "y": 210 },
  { "type": "tower", "team": "red", "x": 400, "y": 106 },
  { "type": "tower", "team": "red", "x": 505, "y": 215 },
  { "type": "tower", "team": "red", "x": 700, "y": 290 },
  { "type": "tower", "team": "red", "x": 238, "y": 83 },
  { "type": "tower", "team": "red", "x": 464, "y": 274 },
  { "type": "tower", "team": "red", "x": 766, "y": 455 }
];

// --- 핑 & 오브젝트 데이터 ---
const tacticsData = [
    { id: 'ping-retreat', name: '위험/후퇴', src: 'https://raw.communitydragon.org/latest/game/assets/ux/minimap/pings/retreat.png' },
    { id: 'ping-missing', name: '사라짐 (미아)', src: 'https://raw.communitydragon.org/latest/game/assets/ux/minimap/pings/mia_new.png' },
    { id: 'ping-omw', name: '가는중', src: 'https://raw.communitydragon.org/latest/game/assets/ux/minimap/pings/on_my_way_new.png' },
    { id: 'ping-assist', name: '지원 요청', src: 'https://raw.communitydragon.org/latest/game/assets/ux/minimap/pings/assist.png' },
    { id: 'ping-caution', name: '주의', src: 'https://raw.communitydragon.org/latest/game/assets/ux/minimap/pings/caution.png' },
    { id: 'ping-target', name: '공격/타겟', src: 'https://raw.communitydragon.org/latest/game/assets/ux/minimap/pings/target.png' },
    { id: 'ping-hold', name: '방어/대기', src: 'https://raw.communitydragon.org/latest/game/assets/ux/minimap/pings/hold.png' },
    { id: 'ping-warded', name: '와드 경고', src: 'https://raw.communitydragon.org/latest/game/assets/ux/minimap/pings/area_is_warded_small_red_new.png' },
    { id: 'ping-push', name: '라인 밀기', src: 'https://raw.communitydragon.org/latest/game/assets/ux/minimap/pings/push.png' },
    { id: 'ping-allin', name: '올인 (All-In)', src: 'https://raw.communitydragon.org/latest/game/assets/ux/minimap/pings/all_in.png' },
    { id: 'ping-bait', name: '유인 (Bait)', src: 'https://raw.communitydragon.org/latest/game/assets/ux/minimap/pings/bait.png' }
];

const epicMonstersData = [
    { id: 'monster-baron', name: '내셔 남작 (바론)', src: 'https://raw.communitydragon.org/latest/game/assets/ux/minimap/icons/baron.png' },
    { id: 'monster-dragon', name: '드래곤 (용)', src: 'https://raw.communitydragon.org/latest/game/assets/ux/minimap/icons/dragon.png' },
    { id: 'monster-herald', name: '협곡의 전령', src: 'https://raw.communitydragon.org/latest/game/assets/ux/minimap/icons/riftherald.png' },
    { id: 'monster-grub', name: '공허 유충', src: 'https://raw.communitydragon.org/latest/game/assets/ux/minimap/icons/grub.png' }
];

const buffsData = [
    { id: 'buff-blue', name: '파란 파수꾼 (블루 버프)', src: 'https://raw.communitydragon.org/latest/game/assets/characters/sru_blue/hud/bluesentinel_circle.png' },
    { id: 'buff-red', name: '붉은 덩굴정령 (레드 버프)', src: 'https://raw.communitydragon.org/latest/game/assets/characters/sru_red/hud/brambleback_circle.png' },
    { id: 'monster-gromp', name: '심술두꺼비 (두꺼비)', src: 'images/Gromp_Render.png' },
    { id: 'monster-wolf', name: '큰 어스름 늑대 (늑대)', src: 'images/Greater_Murk_Wolf_Render.png' },
    { id: 'monster-raptor', name: '핏빛 칼날부리 (칼날부리)', src: 'images/Crimson_Raptor_Render.png' },
    { id: 'monster-krug', name: '고대 돌거북 (돌거북)', src: 'images/Ancient_Krug_Render.png' },
    { id: 'monster-scuttler', name: '바위게 (협곡 바위게)', src: 'images/Rift_Scuttler_Render.png' }
];

const minionsData = [
    { id: 'minion-blue', name: '아군 미니언 (블루)', src: 'images/Order_Minion_Melee_Render.png' },
    { id: 'minion-red', name: '적군 미니언 (레드)', src: 'images/Chaos_Minion_Melee_Render.png' }
];

const objectsData = [
    { id: 'ward-yellow', name: '와드 (노랑)', src: 'https://raw.communitydragon.org/latest/game/assets/items/icons2d/3340_class_t1_wardingtotem.png' },
    { id: 'ward-blue', name: '망원형 개조 (파랑)', src: 'https://raw.communitydragon.org/latest/game/assets/items/icons2d/3363_class_t1_farsightalteration.png' },
    { id: 'ward-control', name: '제어 와드 (핑)', src: 'https://raw.communitydragon.org/latest/game/assets/items/icons2d/2055_class_t1_controlward.png' },
    { id: 'oracle-lens', name: '예언자의 렌즈 (빨강)', src: 'https://raw.communitydragon.org/latest/game/assets/items/icons2d/3364_class_t1_oracleslens.png' },
    { id: 'teleport', name: '텔레포트', src: 'https://raw.communitydragon.org/latest/game/assets/items/icons2d/teleporthome.png' }
];
