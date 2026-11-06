(function() {
    'use strict';

    // 1. 数据配置映射
    const DICTS = {
        houseType: { '1': '非住宿', '2': '宿舍', '3': '宾馆' },
        fgWithinContract: { '1': '合同内', '0': '合同外' },
        plan: { '1': '计划内', '2': '计划外' },
        role: { '1': '管理', '2': '销售', '3': '技术', '4': '工程', '5': '服务', '6': '其他', '7': '研发支持' },
        model: { '1': '现场', '2': '远程' },
        category: { '1': '会议', '2': '协调', '3': '上线', '4': '开发', '5': '实施', '6': '培训', '7': '验收', '8': '维护', '9': '其他' },
        result: { '0': '进行中', '1': '已完成' }
    };

    // 默认兜底配置
    let userConfig = {
        auto_run: true,
        workload_val: '8.0',
        fill_travel: true,
        init_delay: 1,
        target_houseType: '3', target_fgWithinContract: '1',
        target_plan: '1', target_role: '4',
        target_model: '1', target_category: '5', target_result: '0'
    };

    // ==========================================================================
    // 诊断日志：常驻内存滚动记录，出问题时一键导出，不用再远程抓静态资源
    // 只记录容器/字段/状态等技术信息，不采集任何业务或患者数据
    // ==========================================================================
    const DIAG_LIMIT = 500;
    const diagLines = [];
    const diagStart = Date.now();
    let lastMatrixSnapshot = [];

    function diag(tag, msg) {
        try {
            diagLines.push(`[${String(Date.now() - diagStart).padStart(7)}ms] ${tag.padEnd(10)} ${msg}`);
            if (diagLines.length > DIAG_LIMIT) diagLines.shift();
        } catch (e) {}
    }

    function buildDiagnosticReport() {
        const lines = [
            'Bsoft 日志自动填充工具 V2.3.1 — 诊断报告',
            `生成时间: ${new Date().toLocaleString()}`,
            `页面 URL: ${location.href}`,
            `浏览器: ${navigator.userAgent}`,
        ];
        try { lines.push(`容器: ${describeFormContainer()} | 可查询根 ${getDOMRoots(true).length} 个`); } catch (e) {}
        lines.push(`配置: ${JSON.stringify(userConfig)}`);
        lines.push(`最近一次矩阵: ${lastMatrixSnapshot.map(r => `${r.name}=${r.status}`).join(' / ') || '(无)'}`);
        lines.push(`写锁计数: ${_writeLocks}`);
        lines.push('---- 事件时间线 ----');
        lines.push(...diagLines);
        return lines.join('\n');
    }

    // 写权限用引用计数，自动填充与设置面板单字段操作各持一把锁，
    // 避免并发时一方提前释放掉另一方的写权限（原来共用布尔量会互相踩）。
    let _writeLocks = 0;
    let _workflowRunning = false;
    const acquireWriteLock = () => { _writeLocks++; diag('LOCK', `获取，当前 ${_writeLocks}`); return _writeLocks; };
    const releaseWriteLock = () => { _writeLocks = Math.max(0, _writeLocks - 1); diag('LOCK', `释放，剩余 ${_writeLocks}`); return _writeLocks; };
    const canWrite = () => _writeLocks > 0;
    // 不做排队互斥：设置改动立即执行。自动填充的补填轮读同一份 userConfig，
    // 两者最终收敛到用户最新选择；排队只会增加状态机和「永久卡住」的风险。

    // ==========================================================================
    // 【V2.2 核心】微前端(无界 wujie)适配层
    //
    // 新地址 /vueoffice/:path 是 Vue3 + Vite 外壳，通过 WujieVue 把旧的
    // vue-antd-pro 子应用(/office/#/:path)挂载到 <wujie-app> 的 Shadow DOM。
    // document.querySelectorAll 不会穿透 shadowRoot，所以 V2.1 的点击和状态
    // 扫描全部落空 -> 面板全提示「⚡ 差异」。
    // 这里统一收集所有可查询的文档根，表单操作只在含 ant 表单的根内进行。
    // 兼容：新微前端页 / 旧地址直连 / wujie 降级(iframe)模式。
    // ==========================================================================
    let _rootCache = null, _rootCacheTime = 0;
    let _formRootCache = null, _formRootCacheTime = 0;

    function getDOMRoots(force = false) {
        if (!force && _rootCache && Date.now() - _rootCacheTime < 200) return _rootCache;
        const roots = [];
        const seen = new Set();
        const push = (r) => { if (r && !seen.has(r)) { seen.add(r); roots.push(r); } };
        push(document);

        // 递归收集所有 open shadowRoot（wujie-app 及其它自定义元素）
        const scanHosts = (root, depth) => {
            if (depth > 3 || !root || !root.querySelectorAll) return;
            let nodes = [];
            try { nodes = root.querySelectorAll('*'); } catch (e) { return; }
            for (let i = 0; i < nodes.length; i++) {
                const sr = nodes[i].shadowRoot;
                if (sr) { push(sr); scanHosts(sr, depth + 1); }
            }
        };
        scanHosts(document, 0);

        // 同源 iframe（wujie 降级模式 / 其它 iframe 套壳）
        let frames = [];
        try { frames = document.querySelectorAll('iframe'); } catch (e) {}
        for (let i = 0; i < frames.length; i++) {
            try {
                const d = frames[i].contentDocument;
                if (d) { push(d); scanHosts(d, 1); }
            } catch (e) { /* 跨域 iframe，忽略 */ }
        }

        _rootCache = roots;
        _rootCacheTime = Date.now();
        return roots;
    }

    function queryAll(selector, roots) {
        const list = roots || getDOMRoots();
        const out = [];
        for (let i = 0; i < list.length; i++) {
            if (!list[i].querySelectorAll) continue;
            try {
                const nodes = list[i].querySelectorAll(selector);
                for (let j = 0; j < nodes.length; j++) out.push(nodes[j]);
            } catch (e) {}
        }
        return out;
    }

    // 只操作真正含表单的文档根，避免误点 Vue3 外壳上的菜单/按钮
    function getFormRoots(force = false) {
        if (!force && _formRootCache && Date.now() - _formRootCacheTime < 300) return _formRootCache;
        const all = getDOMRoots(force);
        const formRoots = all.filter(r => {
            try { return !!r.querySelector('.ant-form-item, .ant-radio-wrapper, input.ant-input-number-input'); }
            catch (e) { return false; }
        });
        const result = formRoots.length ? formRoots : all;
        _formRootCache = result;
        _formRootCacheTime = Date.now();
        return result;
    }

    // 探测真正含 ant 表单的文档根，供「等待就绪」与「容器说明」共用，
    // 覆盖主文档 / 所有 open Shadow DOM / 同源 iframe（wujie 降级模式）
    function detectFormRoots() {
        return getDOMRoots(true).filter(r => {
            try { return !!r.querySelector('.ant-form-item'); } catch (e) { return false; }
        });
    }

    function hasReadyForm() { return detectFormRoots().length > 0; }

    function waitForFormReady(callback) {
        const TIMEOUT_MS = 20000;
        const start = Date.now();
        const tick = () => {
            if (hasReadyForm()) { getFormRoots(true); callback(true); return; }
            if (Date.now() - start >= TIMEOUT_MS) { callback(false); return; }
            setTimeout(tick, 250);
        };
        tick();
    }

    // Shadow DOM 内的事件必须 composed 才能冒泡到子应用代理的 document
    function makeEvent(el, type) {
        let win = window;
        try { win = (el && el.ownerDocument && el.ownerDocument.defaultView) || window; } catch (e) {}
        try { return new win.Event(type, { bubbles: true, composed: true }); }
        catch (e2) { return new Event(type, { bubbles: true, composed: true }); }
    }

    // 直接点原生 input 最可靠：一定能触发 change，绕开 label 的事件委托
    // strategy 用于单字段重试逐步升级：0=原生 input.click，1=点 label，2=完整鼠标事件序列
    function fireOptionClick(opt, strategy = 0) {
        let input = null;
        try {
            input = (opt.matches && opt.matches('input'))
                ? opt
                : opt.querySelector('input[type="radio"], input[type="checkbox"]');
        } catch (e) {}
        try {
            if (strategy >= 2) {
                const win = (opt.ownerDocument && opt.ownerDocument.defaultView) || window;
                const mouse = (type) => new win.MouseEvent(type, { bubbles: true, composed: true, cancelable: true });
                opt.dispatchEvent(mouse('mousedown'));
                opt.dispatchEvent(mouse('mouseup'));
                opt.dispatchEvent(mouse('click'));
                if (input) input.dispatchEvent(makeEvent(input, 'change'));
                return;
            }
            if (strategy === 1) { opt.click(); return; }
            if (input && !input.disabled && !input.readOnly) input.click();
            else opt.click();
        } catch (e) { try { opt.click(); } catch (e2) {} }
    }

    // 多选一的选中态判定（兼容 ant-design / element / 原生）
    function isOptionChecked(opt) {
        if (!opt) return false;
        try {
            const cls = typeof opt.className === 'string' ? opt.className : '';
            if (/ant-radio-button-wrapper-checked|ant-radio-wrapper-checked|ant-btn-primary|is-checked|is-active|\bchecked\b|\bactive\b/.test(cls)) return true;
            if (opt.getAttribute && opt.getAttribute('aria-checked') === 'true') return true;
            if (opt.querySelector('.ant-radio-checked, .ant-checkbox-checked')) return true;
            // ant 组件必须认 Vue 渲染出来的 checked 类。原生 input.checked 在点击后会立刻变 true，
            // 用它判成功会造成「假同步」：界面看着对了、框架值没更新，还跳过了重试。
            const isAntControl = /ant-radio|ant-checkbox|ant-btn/.test(cls) || !!opt.querySelector('.ant-radio, .ant-checkbox');
            if (!isAntControl) {
                const inp = opt.querySelector('input[type="radio"], input[type="checkbox"]');
                if (inp) return !!inp.checked;
            }
        } catch (e) {}
        return false;
    }

    function isOptionDisabled(opt) {
        try {
            const cls = typeof opt.className === 'string' ? opt.className : '';
            if (/disabled|is-disabled/.test(cls)) return true;
            if (opt.disabled === true || opt.getAttribute('aria-disabled') === 'true') return true;
            const inp = opt.querySelector('input');
            if (inp && inp.disabled) return true;
        } catch (e) {}
        return false;
    }

    // 表单定位：标签 -> 表单项容器 -> 候选项。
    // 点击、状态扫描、可用性探测共用这一份实现，避免三份复制粘贴的 DOM 遍历。
    const FIELD_LABEL_SELECTOR = 'label, span, .ant-form-item-label label, .ant-col-6';
    const FIELD_OPTION_SELECTOR = '.ant-radio-button-wrapper, .ant-radio-wrapper, label.ant-checkbox-wrapper, .ant-btn, button';
    const normFieldLabel = (s) => (s || '').replace(/\s+/g, '').replace(/[*：:]/g, '');

    function findFieldOptions(labelTitle, targetText, mode) {
        const labels = queryAll(FIELD_LABEL_SELECTOR, getFormRoots());
        const cleanTitle = labelTitle.replace(/\s+/g, '');
        const out = [];
        for (const l of labels) {
            const t = normFieldLabel(l.innerText || l.textContent || '');
            const matched = mode === 'exact' ? (t === cleanTitle)
                : mode === 'fuzzy' ? (t.includes(cleanTitle) && t.length <= cleanTitle.length + 6)
                : (t === cleanTitle || t.includes(cleanTitle));
            if (!matched) continue;
            const container = l.closest('.ant-form-item') || l.closest('.ant-row') || (l.parentElement && l.parentElement.parentElement);
            if (!container || !container.querySelectorAll) continue;
            const options = container.querySelectorAll(FIELD_OPTION_SELECTOR);
            for (let i = 0; i < options.length; i++) {
                const opt = options[i];
                const text = (opt.innerText || opt.textContent || '').trim();
                if (text === targetText || text.includes(targetText)) out.push(opt);
            }
        }
        return out;
    }

    // 三态：ok=已同步 / retry=选项可点但没生效 / unavailable=项目本身没这个选项
    // 场景：部分项目没有「合同外」选项，或该 radio 被 disabled —— 这不是同步失败，
    // 不能当成差异反复点击并给红框。
    function fieldStatus(labelTitle, targetText) {
        try {
            const opts = findFieldOptions(labelTitle, targetText, 'any');
            const disabled = opts.filter(isOptionDisabled).length;
            const st = opts.some(isOptionChecked) ? 'ok' : ((!opts.length || disabled) ? 'unavailable' : 'retry');
            diag('FIELD', `${labelTitle} → ${targetText}: 命中 ${opts.length} 个选项, 禁用 ${disabled}, 状态=${st}`);
            return st;
        } catch (e) {
            diag('FIELD', `${labelTitle} → ${targetText}: 扫描异常 ${e.message}`);
            return 'unavailable';
        }
    }

    function showFieldHint(text) {
        const id = 'fill-field-hint';
        let el = document.getElementById(id);
        if (!el) {
            el = document.createElement('div');
            el.id = id;
            Object.assign(el.style, { position: 'fixed', top: '18px', left: '50%', transform: 'translateX(-50%)', backgroundColor: 'rgba(0,0,0,0.8)', color: '#fff', padding: '9px 14px', borderRadius: '8px', fontSize: '12px', zIndex: '2147483647', maxWidth: '80vw', lineHeight: '1.4' });
            document.body.appendChild(el);
        }
        el.textContent = text;
        clearTimeout(el._hideTimer);
        el._hideTimer = setTimeout(() => { if (el && el.parentNode) el.parentNode.removeChild(el); }, 2400);
    }

    function describeFormContainer() {
        const roots = detectFormRoots();
        if (!roots.length) return '🔍 容器：未检测到日志表单';
        if (roots.some(r => r !== document)) return '🔍 容器：微前端 Shadow DOM';
        return '🔍 容器：当前页面文档';
    }

    function showWaitingToast() {
        const id = 'fill-waiting-toast';
        let el = document.getElementById(id);
        if (!el) {
            el = document.createElement('div');
            el.id = id;
            Object.assign(el.style, { position: 'fixed', bottom: '140px', right: '30px', backgroundColor: 'rgba(0,0,0,0.78)', color: '#fff', padding: '8px 12px', borderRadius: '8px', fontSize: '12px', zIndex: '2147483646' });
            document.body.appendChild(el);
        }
        el.textContent = '⏳ 正在等待微前端日志表单加载…';
        return () => { if (el && el.parentNode) el.parentNode.removeChild(el); };
    }

    function saveConfig() {
        if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
            chrome.storage.local.set({ 'logFillConfig_v7': userConfig });
        }
    }

    // 2. 界面样式
    const style = document.createElement('style');
    style.innerHTML = `
        @keyframes fillFadeIn { from { opacity: 0; transform: translateY(15px); } to { opacity: 1; transform: translateY(0); } }
        @keyframes fillFadeOut { from { opacity: 1; transform: translateY(0); } to { opacity: 0; transform: translateY(-15px); } }
        .panel-in { animation: fillFadeIn 0.2s ease-out forwards; }
        .fill-btn-hover { transition: transform 0.2s cubic-bezier(0.2, 0, 0.2, 1), filter 0.2s; }
        .fill-btn-hover:hover { transform: scale(1.05); filter: brightness(1.1); }
        .fill-btn-active { transform: scale(0.9) !important; filter: brightness(0.9) !important; }
        .config-select { width: 100%; padding: 4px 6px; border-radius: 5px; border: 1px solid #ddd; font-size: 12px; background: #fff; cursor: pointer; outline: none; }
        .config-row { display: flex; align-items: center; justify-content: flex-start; margin-bottom: 8px; gap: 15px; }
        .config-label { font-size: 12px; color: #444; font-weight: 600; min-width: 65px; display: flex; align-items: center; gap: 4px; }
        .desc-text { font-size: 11px; color: #666; line-height: 1.4; margin-bottom: 10px; background: #f6f8fa; padding: 8px; border-radius: 6px; border-left: 3px solid #1890ff; }
        .delay-text-badge { background: #1890ff; color: #fff; padding: 1px 5px; border-radius: 4px; font-size: 12px; font-weight: bold; margin: 0 2px; }
        .range-container { width: 100%; padding: 0 4px; box-sizing: border-box; position: relative; }
        .range-input-style { width: 100%; cursor: pointer; accent-color: #1890ff; height: 6px; margin: 8px 0 2px 0; }
        .range-input-style:disabled { accent-color: #bfbfbf; cursor: not-allowed; }
        .matrix-item { display: flex; align-items: center; justify-content: space-between; padding: 4px 8px; border-radius: 4px; background: rgba(0,0,0,0.02); font-size: 11px; font-weight: 600; }
        .range-ticks { display: flex; justify-content: space-between; padding: 0 2px; margin-bottom: 12px; }
        .range-ticks span { font-size: 9px; color: #aaa; position: relative; display: flex; flex-direction: column; align-items: center; }
        .range-ticks span::before { content: ''; width: 1px; height: 4px; background: #ccc; margin-bottom: 2px; }
        .about-btn { background: none; border: none; color: #1890ff; font-size: 12px; font-weight: 600; cursor: pointer; padding: 2px 6px; border-radius: 4px; transition: background 0.2s; }
        .about-btn:hover { background: #e6f7ff; text-decoration: underline; }
    `;
    document.head.appendChild(style);

    function applyStrongFlash(el) { if (!el) return; el.style.transition = 'all 0.3s ease'; el.style.boxShadow = '0 0 12px #52c41a'; setTimeout(() => { el.style.boxShadow = ''; }, 600); }
    function addClickEffect(btn) { btn.addEventListener('mousedown', () => btn.classList.add('fill-btn-active')); const removeEffect = () => btn.classList.remove('fill-btn-active'); btn.addEventListener('mouseup', removeEffect); btn.addEventListener('mouseleave', removeEffect); }

    // 3. 基础组件控制与检测（全量走适配层，可穿透 Shadow DOM）
    function clickButtonByLabelText(labelTitle, targetText, showFlash = true, strategy = 0) {
        if (!canWrite()) return null;
        try {
            // 先精确匹配标签文本，找不到再退到包含匹配，减少误点
            let options = findFieldOptions(labelTitle, targetText, 'exact');
            if (!options.length) options = findFieldOptions(labelTitle, targetText, 'fuzzy');
            let clickedEl = null;
            for (const opt of options) {
                if (!isOptionChecked(opt) && !isOptionDisabled(opt)) fireOptionClick(opt, strategy);
                clickedEl = opt;
            }
            diag('CLICK', `${labelTitle} → ${targetText}: 命中 ${options.length} 个, 策略 ${strategy}`);
            if (clickedEl && showFlash) applyStrongFlash(clickedEl);
            return clickedEl;
        } catch(e) { diag('CLICK', `${labelTitle} → ${targetText}: 点击异常 ${e.message}`); return null; }
    }

    function getTravelInputElement() {
        const roots = getFormRoots();
        const labels = queryAll('.ant-form-item-label label, .ant-form-item-label, label, span[slot="label"], .justify-label, .ant-col-6', roots);
        for (const el of labels) {
            const txt = (el.textContent || '').replace(/[\s*：:]/g, '');
            if (txt !== '是否出差') continue;
            const container = el.closest('.ant-form-item') || el.parentElement;
            if (container && container.querySelector) {
                const cb = container.querySelector('input[type="checkbox"]');
                if (cb) return cb;
            }
        }
        // 仅当页面恰好只有一个候选复选框时才用兜底。多个时宁可报「未找到控件」，
        // 也不能默默点中「是否加班」之类的复选框，造成矩阵全绿但填错的假成功。
        const wrapped = queryAll('.ant-checkbox input[type="checkbox"], label.ant-checkbox-wrapper input[type="checkbox"]', roots);
        if (wrapped.length === 1) return wrapped[0];
        diag('FIELD', `未找到「是否出差」控件（备用候选 ${wrapped.length} 个，已放弃兜底）`);
        return null;
    }

    function clickTravelCheckbox(shouldCheck, showFlash = true) {
        if (!canWrite()) return false; 
        try {
            const inputEl = getTravelInputElement();
            if (!inputEl) return false;
            if (inputEl.checked !== shouldCheck) {
                inputEl.click(); // 原生点击会触发 change，让 ant-checkbox 同步 Vue 状态
                if (inputEl.checked !== shouldCheck) {
                    inputEl.checked = shouldCheck;
                    inputEl.dispatchEvent(makeEvent(inputEl, 'click'));
                    inputEl.dispatchEvent(makeEvent(inputEl, 'change'));
                }
            }
            if (showFlash && inputEl.parentElement) applyStrongFlash(inputEl.parentElement);
            return inputEl.checked === shouldCheck;
        } catch(e) { return false; }
    }

    function checkTravelStatus() {
        const inputEl = getTravelInputElement();
        return inputEl ? inputEl.checked : null;   // null = 控件未找到，区别于「未勾选」
    }

    // 4. 工时高兼容操作组件
    function getWorkloadInput() {
        const roots = getFormRoots();
        const labels = queryAll('label, span[slot="label"], .justify-label', roots);
        for (const l of labels) {
            const t = (l.textContent || '').replace(/[\s*：:]/g, '');
            if (t !== '工时') continue;
            const c = l.closest ? l.closest('.ant-form-item') : null;
            if (c) {
                const inp = c.querySelector('input.ant-input-number-input') || c.querySelector('input');
                if (inp) return inp;
            }
        }
        // 同理：页面有多个数字输入框时不再取第一个，避免把工时填进别的字段
        const numbered = queryAll('input.ant-input-number-input', roots);
        if (numbered.length === 1) return numbered[0];
        const labelled = queryAll('input[aria-label="工时"]', roots);
        if (labelled.length === 1) return labelled[0];
        diag('FIELD', `未找到「工时」输入框（备用候选 ${numbered.length} 个，已放弃兜底）`);
        return null;
    }

    function fillWorkloadViaButtons(targetVal, showFlash = true) {
        if (!canWrite()) return false; 
        try {
            const correctInput = getWorkloadInput();
            if (!correctInput || correctInput.readOnly || correctInput.disabled) return false;

            correctInput.focus();

            // 用原型上的原生 setter 赋值，兼容框架对 value 的代理，并直接覆盖原值
            let setOk = false;
            try {
                const desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(correctInput), 'value');
                if (desc && desc.set) { desc.set.call(correctInput, targetVal); setOk = true; }
            } catch (e) {}
            if (!setOk) correctInput.value = targetVal;

            correctInput.dispatchEvent(makeEvent(correctInput, 'input'));
            correctInput.dispatchEvent(makeEvent(correctInput, 'change'));
            correctInput.blur();
            
            if (showFlash) applyStrongFlash(correctInput.closest('.ant-input-number') || correctInput);
            return true;
        } catch(e) { return false; }
    }

    function checkRealWorkloadStatus() {
        const input = getWorkloadInput();
        if (!input) return null;   // null = 控件未找到，区别于「值不匹配」
        const match = (input.value || '').match(/[\d.]+/);
        return !!match && parseFloat(match[0]) === parseFloat(userConfig.workload_val);
    }

    // 5. 纯动作执行流
    function executePureFillAction(showFlash = true) {
        // 1. 同步出差和住宿
        clickTravelCheckbox(userConfig.fill_travel, showFlash);
        clickButtonByLabelText('住宿情况', DICTS.houseType[userConfig.target_houseType], showFlash);
        
        // 2. 点击「计划」「范围」对应选项；目标已选中或选项被禁用时会自动跳过
        clickButtonByLabelText('计划', DICTS.plan[userConfig.target_plan], showFlash);
        clickButtonByLabelText('范围', DICTS.fgWithinContract[userConfig.target_fgWithinContract], showFlash);

        // 3. 执行其余通用下拉或单选
        const tasks = [{ key: 'role', title: '角色' }, { key: 'model', title: '方式' }, { key: 'category', title: '类别' }, { key: 'result', title: '结果' }];
        tasks.forEach(task => { 
            clickButtonByLabelText(task.title, DICTS[task.key][userConfig[`target_${task.key}`]], showFlash);
        });
        
        // 4. 填充工时
        fillWorkloadViaButtons(userConfig.workload_val, showFlash);
    }

    // 6. 状态监控数据流
    function scanRealPageStatusMatrix() {
        const matrixResults = [];
        const push = (name, ok, okText = '✅ 匹配成功', failText = '⚡ 差异') => {
            matrixResults.push({ name, ok, status: ok ? okText : failText });
        };

        // 项目本身不提供该选项（如没有「合同外」）时显示中性状态，不报差异、不触发补填
        const pushField = (name, title, targetText) => {
            const st = fieldStatus(title, targetText);
            if (st === 'unavailable') matrixResults.push({ name, ok: true, status: '⏭ 项目无此选项' });
            else push(name, st === 'ok');
        };

        const travelState = checkTravelStatus();
        if (travelState === null) matrixResults.push({ name: '🚢 出差状态', ok: true, status: '⚠️ 未找到控件' });
        else push('🚢 出差状态', travelState === userConfig.fill_travel, '✅ 已同步');
        pushField('🏨 住宿安排', '住宿情况', DICTS.houseType[userConfig.target_houseType]);
        pushField('📅 计划类型', '计划', DICTS.plan[userConfig.target_plan]);
        pushField('📌 合同范围', '范围', DICTS.fgWithinContract[userConfig.target_fgWithinContract]);

        const tasks = [{ key: 'role', title: '角色', icon: '👤' }, { key: 'model', title: '方式', icon: '🌐' }, { key: 'category', title: '类别', icon: '📁' }, { key: 'result', title: '结果', icon: '🏁' }];
        tasks.forEach(task => { 
            pushField(`${task.icon} ${task.title}选择`, task.title, DICTS[task.key][userConfig[`target_${task.key}`]]);
        });
        
        const workloadState = checkRealWorkloadStatus();
        if (workloadState === null) matrixResults.push({ name: '⏳ 日志工时', ok: true, status: '⚠️ 未找到控件' });
        else push('⏳ 日志工时', workloadState, '✅ 匹配成功', '❌ 差异');
        return matrixResults;
    }

    // 7. 中央控制流：等子应用就绪 -> 填充 -> 多轮校验（微前端重渲染有延迟）
    function runUnifiedWorkflow() {
        if (_workflowRunning) { diag('WORKFLOW', '忽略重复触发'); return; }
        _workflowRunning = true;
        acquireWriteLock();
        diag('WORKFLOW', '开始自动填充');
        const stopToast = hasReadyForm() ? null : showWaitingToast();
        waitForFormReady((ready) => {
            let fillDone = ready;
            try {
                if (stopToast) stopToast();
                diag('WORKFLOW', `表单就绪=${ready}, 可查询根=${getDOMRoots().length}`);
                if (ready) executePureFillAction(true);
            } catch (e) {
                fillDone = false;   // 填充未完成，不做差异补填
                diag('WORKFLOW', `执行异常: ${e && e.message}`);
            }
            // 必须无条件进入校验流程：防重入标记和写锁只在 verifyAndRender 末轮复位
            verifyAndRender(0, fillDone);
        });
    }

    function verifyAndRender(attempt, allowRefill) {
        setTimeout(() => {
            const currentMatrix = scanRealPageStatusMatrix();
            lastMatrixSnapshot = currentMatrix;
            const allOk = currentMatrix.every(r => r.ok);
            const isFinal = allOk || attempt >= 2;
            diag('VERIFY', `第 ${attempt + 1} 轮: ${currentMatrix.filter(r => r.ok).length}/${currentMatrix.length} 通过${isFinal ? '（最终）' : ''}`);

            // 面板不再等全部校验跑完才出现：首帧 120ms 就亮出来，
            // 后续轮次只刷新面板里的行，不重建 DOM、不重置关闭倒计时。
            const displayMatrix = isFinal ? currentMatrix : currentMatrix.map(r =>
                (!r.ok && !r.status.includes('⏭') && !r.status.includes('⚠️')) ? Object.assign({}, r, { status: '⏳ 校验中' }) : r
            );
            // 首帧无条件渲染：旧版依赖 auto_run / 布尔锁，并发时锁被释放会静默丢掉整个面板
            if (attempt === 0) renderUnifiedFeedbackPanel(displayMatrix);
            else updateMatrixRows(displayMatrix);

            if (!isFinal) {
                // 第二次校验仍有差异时补一次填充（radio / 工时幂等，出差有状态判断）
                if (allowRefill && attempt >= 1) {
                    diag('WORKFLOW', '差异补填一次');
                    executePureFillAction(false);
                }
                verifyAndRender(attempt + 1, allowRefill);
                return;
            }
            _workflowRunning = false;
            releaseWriteLock();
        }, attempt === 0 ? 120 : 400);
    }

    // 8. 单字段联动：设置面板改选项时把改动同步到网页表单
    //    旧实现只点一次、50ms 就释放写权限锁，微前端里事件偶发丢失就永久不生效。
    //    现在：强制刷新容器 -> 点击 -> 严格校验 -> 失败换策略重试 -> 就地反馈，全程持锁。
    const _flashTimers = new WeakMap();
    function flashFieldResult(el, state) {
        if (!el) return;
        const prev = _flashTimers.get(el);
        if (prev) clearTimeout(prev);
        // 统一复位成空，避免连续操作时把上一次的红闪当成「原始样式」写回去（红框永久残留）
        el.style.boxShadow = '';
        const color = state === 'ok' ? '#52c41a' : (state === 'unavailable' ? '#faad14' : '#ff4d4f');
        el.style.transition = 'box-shadow 0.25s ease';
        el.style.boxShadow = `0 0 8px 1px ${color}`;
        const timer = setTimeout(() => {
            el.style.boxShadow = '';
            el.style.transition = '';
            _flashTimers.delete(el);
        }, state === 'unavailable' ? 1400 : 1000);
        _flashTimers.set(el, timer);
    }

    function runSingleFieldWithPrivilege(actionFn, verifyFn, srcEl, hintText) {
        // 不排队：设置改动立即执行。补填轮读同一份 userConfig，最终收敛到最新选择；
        // 极端时序下最多出现一次「⚡ 差异」，再点一次自动填充即可恢复。
        getFormRoots(true);              // 子应用可能刚重新挂载，别用旧缓存
        acquireWriteLock();              // 重试期间保持写权限，否则会被 guard 拦掉
        diag('SINGLE', '单字段联动开始');
        let attempt = 0;
        const MAX_ATTEMPTS = 4;
        const normalize = (v) => (v === true || v === 'ok') ? 'ok'
            : (v === 'unavailable') ? 'unavailable' : 'retry';
        const finish = (state) => {
            diag('SINGLE', `结束: ${state}, 尝试 ${attempt + 1} 次`);
            flashFieldResult(srcEl, state);
            if (state === 'unavailable' && hintText) {
                showFieldHint(hintText);
            } else {
                // 改成有效选项后别让上一条「不提供」提示继续挂着
                const oldHint = document.getElementById('fill-field-hint');
                if (oldHint && oldHint.parentNode) oldHint.parentNode.removeChild(oldHint);
            }
            releaseWriteLock();
        };

        // 预检：项目里压根没有这个选项（或选项被禁用）时一次都不点，直接中性提示，
        // 不再当同步失败反复重试、也不再给红框。配置值照常保留。
        const pre = normalize(verifyFn ? verifyFn() : 'ok');
        diag('SINGLE', `预检: ${pre}`);
        if (pre !== 'retry') { finish(pre); return; }

        const step = () => {
            // 点击抛错也要继续走校验与 finish，否则这把写锁不会释放
            try { actionFn(attempt); } catch (e) { diag('SINGLE', `点击异常: ${e && e.message}`); }
            setTimeout(() => {
                const state = normalize(verifyFn ? verifyFn() : 'ok');
                diag('SINGLE', `第 ${attempt + 1} 次校验: ${state}`);
                if (state === 'retry' && attempt < MAX_ATTEMPTS - 1) { attempt++; step(); return; }
                finish(state);
            }, attempt === 0 ? 220 : 260);
        };
        step();
    }

    // 9. 状态栏面板
    function buildRowsHTML(results) {
        let html = '';
        results.forEach(r => {
            let textColor = '#52c41a';
            if (r.status.includes('⏭')) textColor = '#8c8c8c';
            else if (r.status.includes('⚠️')) textColor = '#faad14';
            else if (r.status.includes('⏳')) textColor = '#1890ff';
            else if (r.status.includes('⚡') || r.status.includes('差异') || r.status.includes('❌')) textColor = '#faad14';
            html += `<div class="matrix-item" style="color: ${textColor};"><span>${r.name}</span><span>${r.status}</span></div>`;
        });
        return html;
    }

    // 校验轮次后续只刷新行内容：不重建面板、不重置关闭按钮与 3 秒倒计时
    function updateMatrixRows(results) {
        const rows = document.getElementById('fill-matrix-rows');
        if (rows) rows.innerHTML = buildRowsHTML(results);
    }

    function renderUnifiedFeedbackPanel(results) {
        const oldPanel = document.getElementById('fill-unified-matrix-panel'); 
        if (oldPanel && oldPanel.parentNode) oldPanel.parentNode.removeChild(oldPanel);

        const panel = document.createElement('div');
        panel.id = 'fill-unified-matrix-panel';
        Object.assign(panel.style, { position: 'fixed', bottom: '140px', right: '30px', backgroundColor: 'rgba(255, 255, 255, 0.98)', backdropFilter: 'blur(12px)', border: '1px solid rgba(0,0,0,0.08)', borderRadius: '12px', padding: '12px', boxShadow: '0 8px 24px rgba(0,0,0,0.15)', zIndex: '2147483646', width: '210px', display: 'flex', flexDirection: 'column', gap: '5px', transition: 'all 0.3s ease', animation: 'fillFadeIn 0.25s cubic-bezier(0.2, 0.8, 0.2, 1) forwards' });

        let innerHTML = `<div style="font-size:11px; color:#999; font-weight:bold; border-bottom:1px solid #eee; padding-bottom:4px; margin-bottom:4px; display:flex; justify-content:space-between;"><span>📊 集中监控矩阵</span><span>V2.3.1</span></div>`;
        innerHTML += `<div style="font-size:10px; color:#999; line-height:1.3; margin-bottom:4px;">${describeFormContainer()}</div>`;

        innerHTML += `<div id="fill-matrix-rows" style="display:flex; flex-direction:column; gap:5px;">${buildRowsHTML(results)}</div>`;

        // 关闭按钮：位于「⏳ 日志工时」行下方，独占一整排
        innerHTML += `<button id="fill-matrix-close-btn" class="fill-btn-hover" style="width:100%; box-sizing:border-box; margin-top:5px; padding:8px 0; border:none; border-radius:6px; background:#ff4d4f; color:#fff; font-size:12px; font-weight:bold; cursor:pointer; transition:all 0.2s ease;">✖ 关闭监控矩阵</button>`;

        panel.innerHTML = innerHTML;
        document.body.appendChild(panel);

        let autoHideTimer = null;
        let dismissed = false;
        let clicked = false;
        const fadeOutAndRemove = () => {
            if (dismissed) return;
            dismissed = true;
            clearTimeout(autoHideTimer);
            panel.style.animation = 'fillFadeOut 0.25s cubic-bezier(0.2, 0.8, 0.2, 1) forwards';
            setTimeout(() => { if (panel && panel.parentNode) panel.parentNode.removeChild(panel); }, 250);
        };

        const closeBtn = document.getElementById('fill-matrix-close-btn');
        if (closeBtn) {
            addClickEffect(closeBtn);
            closeBtn.onmouseenter = () => { if (!clicked) closeBtn.style.background = '#d9363e'; };
            closeBtn.onmouseleave = () => { if (!clicked) closeBtn.style.background = '#ff4d4f'; };
            closeBtn.onclick = () => {
                if (clicked) return;
                clicked = true;
                // 点击反馈：文字、颜色、缩放三重即时变化，再播放淡出
                closeBtn.textContent = '✅ 已关闭';
                closeBtn.style.background = '#8c8c8c';
                closeBtn.style.transform = 'scale(0.96)';
                clearTimeout(autoHideTimer);
                setTimeout(fadeOutAndRemove, 120);
            };
        }
        autoHideTimer = setTimeout(fadeOutAndRemove, 3000);
    }

    // 🌟 关于弹窗
    function showAboutModal() {
        const oldModal = document.getElementById('fill-about-modal');
        if (oldModal && oldModal.parentNode) {
            oldModal.parentNode.removeChild(oldModal);
        }

        const mask = document.createElement('div');
        mask.id = 'fill-about-modal';
        Object.assign(mask.style, { 
            position: 'fixed', 
            top: '0', 
            left: '0', 
            width: '100vw', 
            height: '100vh', 
            backgroundColor: 'rgba(0,0,0,0.3)', 
            backdropFilter: 'blur(4px)', 
            zIndex: '2147483648', 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'center', 
            animation: 'fillFadeIn 0.2s ease-out' 
        });

        const box = document.createElement('div');
        Object.assign(box.style, { 
            backgroundColor: '#fff', 
            padding: '20px', 
            borderRadius: '12px', 
            boxShadow: '0 10px 30px rgba(0,0,0,0.2)', 
            width: '280px', 
            textAlign: 'center', 
            position: 'relative' 
        });

        box.innerHTML = `
            <div style="font-size: 24px; margin-bottom: 8px;">⚙️</div>
            <h3 style="margin: 0 0 12px 0; font-size: 16px; color: #111;">Bsoft 日志自动填充工具</h3>
            <div style="text-align: left; background: #f5f5f5; padding: 12px; border-radius: 8px; font-size: 12px; margin-bottom: 15px; display:flex; flex-direction:column; gap:6px;">
                <div style="color:#666;">📌 <b>版本：</b><span style="color:#222; font-weight:600;">V2.3.1</span></div>
                <div style="color:#444;">✍️ <b>作者：</b><span style="color:#1890ff; font-weight:bold;">IHIYA</span></div>
                <div style="color:#444;">🔧 <b>更新：</b><span style="color:#222;">适配 /vueoffice 微前端页面</span></div>
                <div style="color:#444; display:flex; align-items:center; gap:2px; white-space:nowrap;">
                    <span>🌐 <b>开源地址：</b></span>
                    <a href="https://github.com/wubai67-debug/Bsoft_Log_Tool" target="_blank" style="color:#1296db; text-decoration:none; font-weight:600;">点击访问 GitHub 仓库</a>
                </div>
            </div>
            <button id="fill-modal-close-btn" style="width: 100%; padding: 8px; border: none; background: #1890ff; color: #fff; border-radius: 6px; cursor: pointer; font-size: 12px; font-weight: bold;">确 定</button>
        `;

        mask.appendChild(box);
        document.body.appendChild(mask);

        const closeModal = () => { if (mask && mask.parentNode) mask.parentNode.removeChild(mask); };
        
        mask.onclick = closeModal;
        document.getElementById('fill-modal-close-btn').onclick = closeModal;
        box.onclick = (e) => e.stopPropagation(); 
    }

    // 诊断导出：把常驻日志渲染成可复制文本，排障时直接发出来即可
    function showDiagnosticPanel() {
        const old = document.getElementById('fill-diag-modal');
        if (old && old.parentNode) old.parentNode.removeChild(old);

        const text = buildDiagnosticReport();
        diag('DIAG', '导出诊断日志');

        const mask = document.createElement('div');
        mask.id = 'fill-diag-modal';
        Object.assign(mask.style, { position: 'fixed', top: '0', left: '0', width: '100vw', height: '100vh', backgroundColor: 'rgba(0,0,0,0.35)', zIndex: '2147483648', display: 'flex', alignItems: 'center', justifyContent: 'center' });

        const box = document.createElement('div');
        Object.assign(box.style, { backgroundColor: '#fff', padding: '16px', borderRadius: '12px', width: 'min(680px, 90vw)', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: '10px', boxShadow: '0 10px 30px rgba(0,0,0,0.2)' });
        box.innerHTML = `<div style="font-size:14px; font-weight:bold; color:#111;">📋 诊断日志</div>
            <div style="font-size:12px; color:#666; line-height:1.5;">填充不对时把下面内容全选复制发出来即可。只含容器、字段命中与状态等技术信息，不含业务数据。</div>
            <textarea id="fill-diag-text" readonly style="width:100%; height:300px; box-sizing:border-box; font-family:monospace; font-size:11px; line-height:1.5; border:1px solid #ddd; border-radius:6px; padding:8px; resize:vertical;"></textarea>
            <div style="display:flex; gap:8px;">
                <button id="fill-diag-copy" style="flex:1; padding:8px; border:none; border-radius:6px; background:#1890ff; color:#fff; font-size:12px; font-weight:bold; cursor:pointer;">复制到剪贴板</button>
                <button id="fill-diag-download" style="flex:1; padding:8px; border:1px solid #ddd; border-radius:6px; background:#fff; color:#333; font-size:12px; cursor:pointer;">下载 .txt</button>
                <button id="fill-diag-close" style="flex:1; padding:8px; border:1px solid #ddd; border-radius:6px; background:#fff; color:#333; font-size:12px; cursor:pointer;">关闭</button>
            </div>`;
        mask.appendChild(box);
        document.body.appendChild(mask);

        const ta = document.getElementById('fill-diag-text');
        ta.value = text;
        const close = () => { if (mask.parentNode) mask.parentNode.removeChild(mask); };
        mask.onclick = (e) => { if (e.target === mask) close(); };
        box.onclick = (e) => e.stopPropagation();
        document.getElementById('fill-diag-close').onclick = close;

        document.getElementById('fill-diag-copy').onclick = () => {
            const btn = document.getElementById('fill-diag-copy');
            const done = (ok) => {
                btn.textContent = ok ? '✅ 已复制' : '请按 Ctrl+C 复制';
                btn.style.background = ok ? '#52c41a' : '#faad14';
            };
            ta.select();
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(text).then(() => done(true)).catch(() => done(false));
            } else { done(false); }
        };

        document.getElementById('fill-diag-download').onclick = () => {
            try {
                const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `bsoft-diag-${new Date().toISOString().replace(/[:.]/g, '-')}.txt`;
                document.body.appendChild(a);
                a.click();
                if (a.parentNode) a.parentNode.removeChild(a);
                setTimeout(() => URL.revokeObjectURL(url), 1000);
            } catch (e) { diag('DIAG', `下载失败 ${e.message}`); }
        };
    }

    // 10. 设置面板
    function toggleConfigPanel() {
        const panel = document.getElementById('fill-config-panel');
        if (panel) { 
            if (panel.parentNode) panel.parentNode.removeChild(panel); 
            return; 
        }
        const newPanel = document.createElement('div');
        newPanel.id = 'fill-config-panel';
        newPanel.className = 'panel-in';
        Object.assign(newPanel.style, { position: 'fixed', bottom: '130px', right: '30px', backgroundColor: '#fff', border: '1px solid #ddd', padding: '15px', borderRadius: '12px', zIndex: '2147483647', boxShadow: '0 10px 30px rgba(0,0,0,0.15)', width: '270px' });

        let html = `<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px; border-bottom:1px solid #eee; padding-bottom:8px;"><h4 style="margin:0; font-size:15px; color:#111;">日志填充设置</h4><span style="font-size:10px; color:#1890ff; font-weight:bold;">V2.3.1</span></div>`;

        const getDynamicLabel = (isOn, sec) => {
            return isOn 
                ? `⚡ 进入页面第<span class="delay-text-badge">${sec}s</span>自动运行`
                : `💤 已关闭进入页面自动运行`;
        };
        const rowBgColor = userConfig.auto_run ? '#e6f7ff' : '#f5f5f5';
        const rowBorderColor = userConfig.auto_run ? '#91d5ff' : '#d9d9d9';
        const labelTextColor = userConfig.auto_run ? '#0050b3' : '#8c8c8c';

        html += `<div id="auto_run_wrapper" style="margin-bottom:12px; background:${rowBgColor}; padding:10px; border-radius:8px; border:1px solid ${rowBorderColor}; transition: all 0.2s ease;">
                    <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px;">
                        <label id="lbl_auto_run_title" class="config-label" style="color:${labelTextColor}; flex: 1; min-width: 170px; display: inline-block;">
                            ${getDynamicLabel(userConfig.auto_run, userConfig.init_delay)}
                        </label>
                        <input type="checkbox" id="cfg_auto_run" ${userConfig.auto_run ? 'checked' : ''} style="width:20px; height:20px; cursor:pointer; accent-color:#1890ff;">
                    </div>
                    <div class="desc-text" style="border-left-color:#1890ff; margin-bottom:8px; background: rgba(255,255,255,0.6);">由于网页加载需要时间，建议设置 1-3 秒延迟，确保数据精准勾选。</div>
                    <div class="range-container">
                        <input type="range" id="cfg_init_delay" min="1" max="10" step="1" value="${userConfig.init_delay}" class="range-input-style" ${userConfig.auto_run ? '' : 'disabled'}>
                        <div class="range-ticks">
                            <span>1s</span><span>2s</span><span>3s</span><span>4s</span><span>5s</span><span>6s</span><span>7s</span><span>8s</span><span>9s</span><span>10s</span>
                        </div>
                    </div>
                 </div>`;

        html += `<div class="config-row" style="background:#f6ffed; padding:10px; border-radius:8px; border:1px solid #b7eb8f; margin-bottom:12px;"><label class="config-label">🚢 是否出差</label><input type="checkbox" id="cfg_fill_travel" ${userConfig.fill_travel ? 'checked' : ''} style="width:20px; height:20px; cursor:pointer; accent-color:#52c41a;"></div>`;

        const configKeys = [{ id: 'houseType', label: '🏨 住宿', title: '住宿情况' }, { id: 'fgWithinContract', label: '📌 范围', title: '范围' }, { id: 'plan', label: '📅 计划', title: '计划' }, { id: 'role', label: '👤 角色', title: '角色' }, { id: 'model', label: '🌐 方式', title: '方式' }, { id: 'category', label: '📁 类别', title: '类别' }, { id: 'result', label: '🏁 结果', title: '结果' }];
        configKeys.forEach(item => {
            html += `<div class="config-row"><label class="config-label">${item.label}</label><div style="flex:1;"><select class="auto-save-cfg config-select" data-id="${item.id}" data-title="${item.title}">`;
            for (let val in DICTS[item.id]) { html += `<option value="${val}" ${userConfig[`target_${item.id}`] === val ? 'selected' : ''}>${DICTS[item.id][val]}</option>`; }
            html += `</select></div></div>`;
        });

        html += `<div class="config-row" style="margin-top:10px; padding-top:10px; border-top:1px dashed #eee; justify-content: space-between;">
                    <div style="display:flex; align-items:center; gap: 8px;">
                        <label class="config-label" style="min-width:32px;">⏳ 工时</label>
                        <div style="display:flex; align-items:center; background:#f5f5f5; border-radius:6px; padding:3px;">
                            <button id="btn_wl_minus" style="width:28px; height:26px; border:none; background:none; cursor:pointer; font-weight:bold; font-size:18px; color:#666;">-</button>
                            <input type="text" id="cfg_workload_val" value="${userConfig.workload_val}" style="width:40px; border:none; background:none; text-align:center; font-size:14px; font-weight:900; color:#52c41a; outline:none;">
                            <button id="btn_wl_plus" style="width:28px; height:26px; border:none; background:none; cursor:pointer; font-weight:bold; font-size:18px; color:#666;">+</button>
                        </div>
                    </div>
                    <button id="btn_open_about" class="about-btn" style="padding-right:0;">关于我</button>
                 </div>`;

        html += `<button id="btn_open_diag" style="width:100%; margin-top:10px; padding:8px; border:1px solid #d9d9d9; border-radius:6px; background:#fafafa; color:#555; font-size:12px; cursor:pointer;">📋 导出诊断日志（排障用）</button>`;

        newPanel.innerHTML = html;
        document.body.appendChild(newPanel);

        document.getElementById('btn_open_about').onclick = showAboutModal;
        document.getElementById('btn_open_diag').onclick = showDiagnosticPanel;

        const chkAutoRun = document.getElementById('cfg_auto_run');
        const rangeDelay = document.getElementById('cfg_init_delay');
        const lblTitle = document.getElementById('lbl_auto_run_title');
        const wrapper = document.getElementById('auto_run_wrapper');

        const updateAutoRunUI = () => {
            const isChecked = chkAutoRun.checked;
            const delayVal = rangeDelay.value;
            
            userConfig.auto_run = isChecked;
            userConfig.init_delay = parseInt(delayVal);
            saveConfig();

            lblTitle.innerHTML = getDynamicLabel(isChecked, delayVal);
            if (isChecked) {
                rangeDelay.disabled = false;
                wrapper.style.background = '#e6f7ff';
                wrapper.style.borderColor = '#91d5ff';
                lblTitle.style.color = '#0050b3';
            } else {
                rangeDelay.disabled = true;
                wrapper.style.background = '#f5f5f5';
                wrapper.style.borderColor = '#d9d9d9';
                lblTitle.style.color = '#8c8c8c';
            }
        };

        chkAutoRun.onchange = updateAutoRunUI;
        rangeDelay.oninput = updateAutoRunUI;
        
        document.getElementById('cfg_fill_travel').onchange = (e) => { 
            userConfig.fill_travel = e.target.checked; 
            saveConfig(); 
            runSingleFieldWithPrivilege(
                () => clickTravelCheckbox(userConfig.fill_travel, true),
                () => checkTravelStatus() === userConfig.fill_travel,
                e.target
            );
        };
        
        newPanel.querySelectorAll('.auto-save-cfg').forEach(select => {
            select.onchange = (e) => { 
                const id = e.target.getAttribute('data-id'); 
                const title = e.target.getAttribute('data-title');
                userConfig[`target_${id}`] = e.target.value; 
                saveConfig(); 
                const targetText = DICTS[id][userConfig[`target_${id}`]];
                runSingleFieldWithPrivilege(
                    (attempt) => clickButtonByLabelText(title, targetText, attempt === 0, attempt),
                    () => fieldStatus(title, targetText),
                    e.target,
                    `📌 ${title}：当前项目不提供「${targetText}」选项，已跳过（配置已保留）`
                );
            };
        });

        const wlInput = document.getElementById('cfg_workload_val');
        wlInput.oninput = (e) => { userConfig.workload_val = e.target.value.replace(/[^\d.]/g, ""); saveConfig(); };
        wlInput.onblur = (e) => { 
            let num = parseFloat(e.target.value); 
            let formatted = (isNaN(num) ? 8.0 : num).toFixed(1); 
            e.target.value = formatted; userConfig.workload_val = formatted; saveConfig(); 
            runSingleFieldWithPrivilege(
                () => fillWorkloadViaButtons(formatted, true),
                () => checkRealWorkloadStatus(),
                e.target
            );
        };
        document.getElementById('btn_wl_minus').onclick = () => { 
            let res = (Math.max(0, parseFloat(userConfig.workload_val) - 1.0)).toFixed(1); 
            wlInput.value = res; userConfig.workload_val = res; saveConfig(); 
            runSingleFieldWithPrivilege(() => fillWorkloadViaButtons(res, true), () => checkRealWorkloadStatus(), wlInput);
        };
        document.getElementById('btn_wl_plus').onclick = () => { 
            let res = (parseFloat(userConfig.workload_val) + 1.0).toFixed(1); 
            wlInput.value = res; userConfig.workload_val = res; saveConfig(); 
            runSingleFieldWithPrivilege(() => fillWorkloadViaButtons(res, true), () => checkRealWorkloadStatus(), wlInput);
        };
    }

    // 11. 悬浮底座基础初始化
    function createButton() {
        if (document.getElementById('fill-btn-group')) return;
        const group = document.createElement('div');
        group.id = 'fill-btn-group';
        Object.assign(group.style, { position: 'fixed', bottom: '70px', right: '30px', zIndex: '2147483647', display: 'flex', backgroundColor: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(12px)', padding: '5px', borderRadius: '12px', boxShadow: '0 4px 20px rgba(0,0,0,0.3)' });
        const mainBtn = document.createElement('button');
        mainBtn.className = 'fill-btn-hover'; mainBtn.innerHTML = '🚀 自动填充';
        Object.assign(mainBtn.style, { padding: '10px 18px', backgroundColor: '#52c41a', color: '#fff', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold', fontSize: '13px' });
        const cfgBtn = document.createElement('button');
        cfgBtn.className = 'fill-btn-hover'; cfgBtn.innerHTML = '⚙️';
        Object.assign(cfgBtn.style, { padding: '0 12px', backgroundColor: 'transparent', color: '#fff', border: 'none', cursor: 'pointer', fontSize: '18px' });
        addClickEffect(mainBtn); addClickEffect(cfgBtn);
        
        mainBtn.onclick = () => { runUnifiedWorkflow(); };
        cfgBtn.onclick = toggleConfigPanel;
        group.appendChild(mainBtn); group.appendChild(cfgBtn);
        document.body.appendChild(group);
    }

    setInterval(createButton, 1000);

    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
        chrome.storage.local.get(['logFillConfig_v7'], function(result) {
            if (result && result.logFillConfig_v7) {
                // 合并默认值：旧版本存下来的配置可能缺新增字段，避免读到 undefined
                userConfig = Object.assign({}, userConfig, result.logFillConfig_v7);
            }
            if (userConfig.auto_run) {
                setTimeout(() => {
                    runUnifiedWorkflow();
                }, (userConfig.init_delay + 0.3) * 1000);
            }
        });
    }
})();
