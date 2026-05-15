(function() {
    'use strict';

    // --- 兼容层：模拟油猴的持久化存储 (适配原生扩展) ---
    const GM_getValue = (key, defaultVal) => {
        const saved = localStorage.getItem(key);
        return saved ? JSON.parse(saved) : defaultVal;
    };
    const GM_setValue = (key, val) => {
        localStorage.setItem(key, JSON.stringify(val));
    };

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

    // 读取配置
    let userConfig = GM_getValue('logFillConfig_v6', {
        fill_workload: true, workload_val: '8.0',
        fill_travel: true,
        init_delay: 1,
        target_houseType: '3', target_fgWithinContract: '1',
        target_plan: '1', target_role: '4',
        target_model: '1', target_category: '5', target_result: '0'
    });

    // 2. 样式注入
    const style = document.createElement('style');
    style.innerHTML = `
        @keyframes fillFadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
        .panel-in { animation: fillFadeIn 0.2s ease-out forwards; }
        .fill-btn-hover { transition: transform 0.2s cubic-bezier(0.2, 0, 0.2, 1), filter 0.2s; }
        .fill-btn-hover:hover { transform: scale(1.05); filter: brightness(1.1); }
        .fill-btn-active { transform: scale(0.9) !important; filter: brightness(0.9) !important; }
        .config-select { width: 100%; padding: 4px 6px; border-radius: 5px; border: 1px solid #ddd; font-size: 12px; background: #fff; cursor: pointer; outline: none; }
        .config-row { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
        .config-label { font-size: 12px; color: #444; font-weight: 600; min-width: 65px; display: flex; align-items: center; gap: 4px; }
        .desc-text { font-size: 11px; color: #888; line-height: 1.3; margin-bottom: 8px; background: #fdfdfd; padding: 6px; border-radius: 4px; border-left: 2px solid #52c41a; }
        .delay-badge { background: #1890ff; color: #fff; padding: 2px 10px; border-radius: 6px; font-size: 16px; font-weight: 900; box-shadow: 0 2px 4px rgba(24,144,255,0.3); }
        .range-container { width: 100%; padding: 0 4px; box-sizing: border-box; }
        .range-input-style { width: 100%; cursor: pointer; accent-color: #1890ff; height: 6px; margin: 15px 0 5px 0; }
        .range-ticks { display: flex; justify-content: space-between; padding: 0 10px; margin-top: 2px; }
        .range-ticks span { font-size: 9px; color: #999; text-align: center; width: 0; display: flex; justify-content: center; position: relative; }
        .range-ticks span::before { content: ""; width: 1px; height: 4px; background: #ccc; position: absolute; top: -6px; left: 50%; }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-thumb { background: rgba(0,0,0,0.1); border-radius: 10px; }
    `;
    document.head.appendChild(style);

    // 3. 表单填充核心逻辑
    function applyStrongFlash(el) { if (!el) return; el.style.transition = 'all 0.3s ease'; el.style.boxShadow = '0 0 12px #52c41a'; setTimeout(() => { el.style.boxShadow = ''; }, 600); }
    function addClickEffect(btn) { btn.addEventListener('mousedown', () => btn.classList.add('fill-btn-active')); const removeEffect = () => btn.classList.remove('fill-btn-active'); btn.addEventListener('mouseup', removeEffect); btn.addEventListener('mouseleave', removeEffect); }

    function findAllAndClickByLabel(labelTitle, targetText, showFlash = true) {
        const labels = Array.from(document.querySelectorAll('label, .ant-form-item-label label, .ant-form-item-no-colon'));
        const cleanTargetTitle = labelTitle.replace(/\s+/g, '');
        let matchCount = 0;
        labels.forEach(l => {
            const actualLabelText = l.innerText.replace(/\s+/g, '').replace(/[*：:]/g, '');
            if (actualLabelText === cleanTargetTitle || actualLabelText.includes(cleanTargetTitle)) {
                const container = l.closest('.ant-form-item') || l.parentElement.parentElement;
                if (container) {
                    const options = Array.from(container.querySelectorAll('.ant-radio-button-wrapper, .ant-radio-wrapper, span'));
                    options.forEach(opt => {
                        if (opt.innerText.trim() === targetText) {
                            const clickable = opt.closest('.ant-radio-button-wrapper') || opt.closest('.ant-radio-wrapper') || opt;
                            const isChecked = clickable.classList.contains('ant-radio-button-wrapper-checked') || clickable.classList.contains('ant-radio-wrapper-checked') || clickable.querySelector('.ant-radio-checked');
                            if (!isChecked) {
                                clickable.click();
                                if (cleanTargetTitle === '计划') {
                                    setTimeout(() => { findAllAndClickByLabel('范围', DICTS.fgWithinContract[userConfig.target_fgWithinContract], false); }, 150);
                                }
                            }
                            if (showFlash) applyStrongFlash(clickable);
                            matchCount++;
                        }
                    });
                }
            }
        });
        return matchCount > 0;
    }

    function handleTravelSync(shouldCheck, showFlash = true) {
        const travelCbs = document.querySelectorAll('.ant-checkbox-input');
        travelCbs.forEach(cb => { if (shouldCheck !== cb.checked) { cb.click(); } if (showFlash) applyStrongFlash(cb.closest('.ant-checkbox-wrapper')); });
        return travelCbs.length > 0;
    }

    function fillAllWorkloads(val, showFlash = true) {
        const inputs = document.querySelectorAll('input.ant-input-number-input, #workload input, input[aria-label="工时"]');
        if (inputs.length === 0) return false;
        inputs.forEach(input => {
            try {
                const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
                setter.call(input, val);
                ['input', 'change', 'blur'].forEach(etype => input.dispatchEvent(new Event(etype, { bubbles: true })));
            } catch (e) { input.value = val; input.dispatchEvent(new Event('change', { bubbles: true })); }
            if (showFlash) applyStrongFlash(input.parentElement || input);
        });
        return true;
    }

    function executeFillAll(showFlash = true) {
        const results = [];
        results.push({ name: '出差', status: handleTravelSync(userConfig.fill_travel, showFlash) ? '✅' : '❌' });
        results.push({ name: '住宿', status: findAllAndClickByLabel('住宿情况', DICTS.houseType[userConfig.target_houseType], showFlash) ? '✅' : '❌' });
        const tasks = [{ key: 'fgWithinContract', title: '范围' }, { key: 'plan', title: '计划' }, { key: 'role', title: '角色' }, { key: 'model', title: '方式' }, { key: 'category', title: '类别' }, { key: 'result', title: '结果' }];
        tasks.forEach(task => { results.push({ name: task.title, status: findAllAndClickByLabel(task.title, DICTS[task.key][userConfig[`target_${task.key}`]], showFlash) ? '✅' : '❌' }); });
        results.push({ name: '工时', status: fillAllWorkloads(userConfig.workload_val, showFlash) ? '✅' : '❌' });
        return results;
    }

    // 4. 反馈与配置面板
    function showFeedback(results) {
        const oldBox = document.getElementById('fill-feedback-list'); if (oldBox) oldBox.remove();
        const container = document.createElement('div');
        container.id = 'fill-feedback-list';
        Object.assign(container.style, { position: 'fixed', bottom: '140px', right: '30px', display: 'flex', flexDirection: 'column', gap: '6px', zIndex: '2147483646', pointerEvents: 'none' });
        document.body.appendChild(container);
        results.forEach((r, index) => {
            const item = document.createElement('div');
            Object.assign(item.style, { backgroundColor: 'rgba(255, 255, 255, 0.95)', backdropFilter: 'blur(10px)', border: '1px solid rgba(0,0,0,0.05)', color: r.status === '✅' ? '#333' : '#ff4d4f', padding: '6px 12px', borderRadius: '8px', fontSize: '11px', fontWeight: '600', boxShadow: '0 2px 10px rgba(0,0,0,0.1)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '115px', transition: 'all 0.4s cubic-bezier(0.18, 0.89, 0.32, 1.28)', opacity: '0', transform: 'translateY(10px)' });
            item.innerHTML = `<span>${r.name}</span> <span>${r.status}</span>`;
            container.appendChild(item);
            setTimeout(() => { item.style.opacity = '1'; item.style.transform = 'translateY(0)'; }, index * 40);
            setTimeout(() => { item.style.opacity = '0'; if (index === results.length - 1) setTimeout(() => container.remove(), 500); }, 3000 + (index * 40));
        });
    }

    function toggleConfigPanel() {
        const panel = document.getElementById('fill-config-panel');
        if (panel) { panel.remove(); return; }
        const newPanel = document.createElement('div');
        newPanel.id = 'fill-config-panel';
        newPanel.className = 'panel-in';
        Object.assign(newPanel.style, { position: 'fixed', bottom: '130px', right: '30px', backgroundColor: '#fff', border: '1px solid #ddd', padding: '15px', borderRadius: '12px', zIndex: '2147483647', boxShadow: '0 10px 30px rgba(0,0,0,0.15)', width: '260px' });

        let html = `<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:15px; border-bottom:1px solid #eee; padding-bottom:8px;"><h4 style="margin:0; font-size:15px; color:#111;">日志填充设置</h4><span style="font-size:10px; color:#1890ff; font-weight:bold;">V10.8 by IHIYA</span></div>`;
        html += `<div style="margin-bottom:20px;">
                    <label class="config-label" style="justify-content:space-between; margin-bottom:8px;">
                        <span>⏱️ 启动延迟</span> <span id="val_init_delay" class="delay-badge">${userConfig.init_delay}s</span>
                    </label>
                    <div class="desc-text">网页加载完成后等待执行的时间。</div>
                    <div class="range-container">
                        <input type="range" id="cfg_init_delay" min="1" max="10" step="1" value="${userConfig.init_delay}" class="range-input-style">
                        <div class="range-ticks"><span>1</span><span>2</span><span>3</span><span>4</span><span>5</span><span>6</span><span>7</span><span>8</span><span>9</span><span>10</span></div>
                    </div>
                 </div>`;
        html += `<div class="config-row" style="background:#f6ffed; padding:10px; border-radius:8px; border:1px solid #b7eb8f; margin-bottom:12px;"><label class="config-label">🚢 是否出差</label><input type="checkbox" id="cfg_fill_travel" ${userConfig.fill_travel ? 'checked' : ''} style="width:20px; height:20px; cursor:pointer; accent-color:#52c41a;"></div>`;

        const configKeys = [{ id: 'houseType', label: '🏨 住宿' }, { id: 'fgWithinContract', label: '📌 范围' }, { id: 'plan', label: '📅 计划' }, { id: 'role', label: '👤 角色' }, { id: 'model', label: '🌐 方式' }, { id: 'category', label: '📁 类别' }, { id: 'result', label: '🏁 结果' }];
        configKeys.forEach(item => {
            html += `<div class="config-row"><label class="config-label">${item.label}</label><div style="flex:1; margin-left:15px;"><select class="auto-save-cfg config-select" data-id="${item.id}" data-title="${item.label.split(' ')[1]}">`;
            for (let val in DICTS[item.id]) { html += `<option value="${val}" ${userConfig[`target_${item.id}`] === val ? 'selected' : ''}>${DICTS[item.id][val]}</option>`; }
            html += `</select></div></div>`;
        });
        html += `<div class="config-row" style="margin-top:10px; padding-top:10px; border-top:1px dashed #eee;"><label class="config-label">⏳ 工时</label><div style="display:flex; align-items:center; background:#f5f5f5; border-radius:6px; padding:3px; margin-left: auto;"><button id="btn_wl_minus" style="width:28px; height:26px; border:none; background:none; cursor:pointer; font-weight:bold; font-size:18px; color:#666;">-</button><input type="text" id="cfg_workload_val" value="${userConfig.workload_val}" style="width:40px; border:none; background:none; text-align:center; font-size:14px; font-weight:900; color:#52c41a; outline:none;"><button id="btn_wl_plus" style="width:28px; height:26px; border:none; background:none; cursor:pointer; font-weight:bold; font-size:18px; color:#666;">+</button></div></div>`;

        newPanel.innerHTML = html;
        document.body.appendChild(newPanel);

        document.getElementById('cfg_init_delay').oninput = (e) => {
            document.getElementById('val_init_delay').innerText = e.target.value + 's';
            userConfig.init_delay = parseInt(e.target.value); GM_setValue('logFillConfig_v6', userConfig);
        };
        document.getElementById('cfg_fill_travel').onchange = (e) => { userConfig.fill_travel = e.target.checked; GM_setValue('logFillConfig_v6', userConfig); handleTravelSync(userConfig.fill_travel, true); };
        newPanel.querySelectorAll('.auto-save-cfg').forEach(select => {
            select.onchange = (e) => { const id = e.target.getAttribute('data-id'); const title = e.target.getAttribute('data-title'); userConfig[`target_${id}`] = e.target.value; GM_setValue('logFillConfig_v6', userConfig); findAllAndClickByLabel(title, DICTS[id][e.target.value], true); };
        });

        const wlInput = document.getElementById('cfg_workload_val');
        const updateWLConfig = (val) => { userConfig.workload_val = val; GM_setValue('logFillConfig_v6', userConfig); fillAllWorkloads(val, true); };
        wlInput.oninput = (e) => updateWLConfig(e.target.value.replace(/[^\d.]/g, ""));
        wlInput.onblur = (e) => { let num = parseFloat(e.target.value); let formatted = (isNaN(num) ? 8.0 : num).toFixed(1); e.target.value = formatted; updateWLConfig(formatted); };
        document.getElementById('btn_wl_minus').onclick = () => { let res = (Math.max(0, parseFloat(userConfig.workload_val) - 1.0)).toFixed(1); wlInput.value = res; updateWLConfig(res); };
        document.getElementById('btn_wl_plus').onclick = () => { let res = (parseFloat(userConfig.workload_val) + 1.0).toFixed(1); wlInput.value = res; updateWLConfig(res); };
    }

    // 5. 悬浮按钮组
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
        mainBtn.onclick = () => { showFeedback(executeFillAll(true)); };
        cfgBtn.onclick = toggleConfigPanel;
        group.appendChild(mainBtn); group.appendChild(cfgBtn);
        document.body.appendChild(group);
    }

    setInterval(createButton, 1000);
    setTimeout(() => { showFeedback(executeFillAll(true)); }, (userConfig.init_delay + 0.3) * 1000);
})();