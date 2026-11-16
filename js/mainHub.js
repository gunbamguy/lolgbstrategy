/**
 * 🏠 GUDO 허브 메인 컨트롤러 (mainHub.js)
 * 3대 핵심 도구(룬 · 아이템 · 전략 보드) 네비게이션 관리
 */

function showHubToast(message) {
    let toast = document.getElementById('hubToast');
    if (!toast) {
        toast = document.createElement('div');
        toast.id = 'hubToast';
        toast.className = 'hub-toast';
        document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.add('show');
    clearTimeout(toast._hideTimer);
    toast._hideTimer = setTimeout(() => {
        toast.classList.remove('show');
    }, 2200);
}

function copyHubPageLink() {
    const url = window.location.href.split('#')[0];
    const fallbackCopy = () => {
        const ta = document.createElement('textarea');
        ta.value = url;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        ta.setSelectionRange(0, url.length);
        let ok = false;
        try {
            ok = document.execCommand('copy');
        } catch (e) {
            ok = false;
        } finally {
            ta.remove();
        }
        return ok;
    };

    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(() => {
            showHubToast('🔗 메인 허브 페이지 링크가 복사되었습니다.');
        }).catch(() => {
            showHubToast(fallbackCopy() ? '🔗 메인 허브 페이지 링크가 복사되었습니다.' : '⚠️ 링크 복사에 실패했습니다.');
        });
    } else {
        showHubToast(fallbackCopy() ? '🔗 메인 허브 페이지 링크가 복사되었습니다.' : '⚠️ 링크 복사에 실패했습니다.');
    }
}

document.addEventListener('DOMContentLoaded', function() {
    console.log("🚀 GUDO Main Hub Initialized");
    const btnCopyHubLink = document.getElementById('btnCopyHubLink');
    if (btnCopyHubLink) {
        btnCopyHubLink.addEventListener('click', copyHubPageLink);
    }
});
