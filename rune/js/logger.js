/**
 * 📋 GUDO 전역 디버그 로거 (Logger) System
 * 모든 브라우저 조작, 파서 추출, 룬 선택, 에러를 localStorage 및 텍스트 파일 덤프로 누적 저장합니다.
 */

window.GUDO_LOGGER = {
    logs: [],
    maxLogs: 200,

    init: function() {
        try {
            const saved = localStorage.getItem('gudo_app_debug_log');
            if (saved) {
                this.logs = JSON.parse(saved);
            }
        } catch (e) {
            this.logs = [];
        }
        this.log('SYSTEM', 'GUDO_LOGGER 시스템 초기화 완료');
    },

    _addLog: function(type, tag, msg, extra = null) {
        const timestamp = new Date().toISOString().substring(11, 19);
        const logEntry = {
            time: timestamp,
            type: type,
            tag: tag,
            msg: msg,
            extra: extra ? (typeof extra === 'object' ? JSON.stringify(extra) : String(extra)) : ''
        };

        this.logs.push(logEntry);
        if (this.logs.length > this.maxLogs) {
            this.logs.shift();
        }

        try {
            localStorage.setItem('gudo_app_debug_log', JSON.stringify(this.logs));
        } catch (e) {
            // localStorage 용량 초과 예외 방지
        }

        const formatted = `[${timestamp}] [${type}] [${tag}] ${msg} ${logEntry.extra}`;
        if (type === 'ERROR') {
            console.error(formatted);
        } else if (type === 'WARN') {
            console.warn(formatted);
        } else {
            console.log(formatted);
        }
    },

    log: function(tag, msg, extra) {
        this._addLog('INFO', tag, msg, extra);
    },

    warn: function(tag, msg, extra) {
        this._addLog('WARN', tag, msg, extra);
    },

    error: function(tag, msg, extra) {
        this._addLog('ERROR', tag, msg, extra);
    },

    getLogText: function() {
        return this.logs.map(l => `[${l.time}] [${l.type}] [${l.tag}] ${l.msg} ${l.extra}`).join('\n');
    },

    downloadLogFile: function() {
        const text = this.getLogText();
        const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `gudo_debug_log_${Date.now()}.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    },

    clearLog: function() {
        this.logs = [];
        localStorage.removeItem('gudo_app_debug_log');
        console.log('📋 디버그 로그가 초기화되었습니다.');
    }
};

window.GUDO_LOGGER.init();
